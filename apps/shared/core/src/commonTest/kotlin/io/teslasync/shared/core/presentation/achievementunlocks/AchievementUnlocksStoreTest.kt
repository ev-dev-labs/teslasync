package io.teslasync.shared.core.presentation.achievementunlocks

import io.teslasync.shared.core.net.sse.FakeSseTransport
import io.teslasync.shared.core.net.sse.SseClient
import io.teslasync.shared.core.net.sse.SseStep
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class AchievementUnlocksStoreTest {
    private fun unlockFrame(
        id: String,
        vehicleId: Long = 1,
    ): String =
        "event: achievement_unlocked\n" +
            "data: {\"vehicle_id\":$vehicleId,\"unlocked_at\":\"2026-01-01T00:00:00Z\"," +
            "\"achievement\":{\"id\":\"$id\",\"name\":\"A-$id\",\"unlocked\":true," +
            "\"unlocked_at\":\"2026-01-01T00:00:00Z\",\"progress\":1.0,\"target\":1.0,\"current\":1.0}}\n\n"

    private fun clientEmitting(vararg steps: SseStep): Pair<SseClient, FakeSseTransport> {
        val transport =
            FakeSseTransport { attempt, _ ->
                if (attempt == 0) steps.toList() + SseStep.Hang else listOf(SseStep.Hang)
            }
        val client = SseClient(transport) { nowMillis = { 0L } }
        return client to transport
    }

    @Test
    fun enqueuesDecodedUnlocksNewestFirst() =
        runTest {
            val (client, _) = clientEmitting(SseStep.Emit(unlockFrame("a")), SseStep.Emit(unlockFrame("b")))
            val store = AchievementUnlocksStore(client, backgroundScope)
            store.start()
            runCurrent()

            assertEquals(listOf("b", "a"), store.recent.value.map { it.achievement.id })
            assertEquals(
                1L,
                store.recent.value
                    .first()
                    .vehicleId,
            )
        }

    @Test
    fun deDupesByAchievementId() =
        runTest {
            val (client, _) = clientEmitting(SseStep.Emit(unlockFrame("a")), SseStep.Emit(unlockFrame("a")))
            val store = AchievementUnlocksStore(client, backgroundScope)
            store.start()
            runCurrent()

            assertEquals(listOf("a"), store.recent.value.map { it.achievement.id })
        }

    @Test
    fun dropsMalformedAndIdlessFrames() =
        runTest {
            val idless = "event: achievement_unlocked\ndata: {\"vehicle_id\":1,\"achievement\":{\"name\":\"x\"}}\n\n"
            val notObject = "event: achievement_unlocked\ndata: 42\n\n"
            val (client, _) =
                clientEmitting(
                    SseStep.Emit(idless),
                    SseStep.Emit(notObject),
                    SseStep.Emit(unlockFrame("a")),
                )
            val store = AchievementUnlocksStore(client, backgroundScope)
            store.start()
            runCurrent()

            assertEquals(listOf("a"), store.recent.value.map { it.achievement.id })
        }

    @Test
    fun ignoresNonAchievementEvents() =
        runTest {
            val heartbeat = "event: heartbeat\ndata: {\"time\":\"t\"}\n\n"
            val (client, _) = clientEmitting(SseStep.Emit(heartbeat), SseStep.Emit(unlockFrame("a")))
            val store = AchievementUnlocksStore(client, backgroundScope)
            store.start()
            runCurrent()

            assertEquals(listOf("a"), store.recent.value.map { it.achievement.id })
        }

    @Test
    fun boundsToMaxRecentDroppingOldest() =
        runTest {
            val (client, _) =
                clientEmitting(
                    SseStep.Emit(unlockFrame("a")),
                    SseStep.Emit(unlockFrame("b")),
                    SseStep.Emit(unlockFrame("c")),
                )
            val store = AchievementUnlocksStore(client, backgroundScope, maxRecent = 2)
            store.start()
            runCurrent()

            assertEquals(listOf("c", "b"), store.recent.value.map { it.achievement.id })
        }

    @Test
    fun dismissRemovesEntry() =
        runTest {
            val (client, _) =
                clientEmitting(
                    SseStep.Emit(unlockFrame("a")),
                    SseStep.Emit(unlockFrame("b")),
                    SseStep.Emit(unlockFrame("c")),
                )
            val store = AchievementUnlocksStore(client, backgroundScope)
            store.start()
            runCurrent()
            store.dismiss("b")

            assertEquals(listOf("c", "a"), store.recent.value.map { it.achievement.id })
        }

    @Test
    fun stopClosesSubscription() =
        runTest {
            val (client, transport) = clientEmitting(SseStep.Emit(unlockFrame("a")))
            val store = AchievementUnlocksStore(client, backgroundScope)
            store.start()
            runCurrent()
            assertEquals(1, transport.activeConnections)

            store.stop()
            runCurrent()
            assertEquals(0, transport.activeConnections)
            // Retained queue survives a stop, matching the web hook's in-memory list.
            assertTrue(store.recent.value.isNotEmpty())
        }
}
