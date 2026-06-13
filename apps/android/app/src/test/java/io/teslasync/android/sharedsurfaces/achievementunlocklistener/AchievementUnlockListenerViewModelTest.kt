// Off-device unit tests for the AchievementUnlockListener state holder: the live-prefs binding (web
// `useAchievementCelebrationPrefs`), the realtime unlock stream folded onto the de-dup/bound queue (web
// `useAchievementUnlocks`), the opt-in chime ticket (web's `recent.length`-keyed chime effect), the dismiss
// action, and the one-shot PII-safe `view.opened` diagnostic. Driven over a fake source; run by the offline
// :android:testReleaseUnitTest gate.

package io.teslasync.android.sharedsurfaces.achievementunlocklistener

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AchievementUnlockListenerViewModelTest {
    // ── prefs binding ───────────────────────────────────────────────────────────────
    @Test
    fun prefsStreamUpdatesState() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = AchievementUnlockListenerViewModel(source, RecordingLogger(), backgroundScope)
            advanceUntilIdle()
            assertTrue(vm.state.value.prefs.showToasts)

            source.prefs.value = AchievementCelebrationPrefs(showToasts = false)
            advanceUntilIdle()
            assertFalse(vm.state.value.prefs.showToasts)
        }

    // ── unlock stream → queue ────────────────────────────────────────────────────────
    @Test
    fun unlocksEnqueueNewestFirst() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = AchievementUnlockListenerViewModel(source, RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            source.unlocks.emit(unlock("a"))
            source.unlocks.emit(unlock("b"))
            advanceUntilIdle()

            val queue = vm.state.value.queue
            assertEquals(listOf("b", "a"), queue.map { it.achievement.id })
        }

    @Test
    fun duplicateUnlocksAreIgnored() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = AchievementUnlockListenerViewModel(source, RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            source.unlocks.emit(unlock("a"))
            source.unlocks.emit(unlock("a"))
            advanceUntilIdle()

            assertEquals(1, vm.state.value.queue.size)
        }

    // ── chime ticket ─────────────────────────────────────────────────────────────────
    @Test
    fun chimeTicksForEachNewUnlockWhenSoundOn() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(prefs = MutableStateFlow(AchievementCelebrationPrefs(playSound = true)))
            val vm = AchievementUnlockListenerViewModel(source, RecordingLogger(), backgroundScope)
            advanceUntilIdle()
            assertEquals(0L, vm.chimeNonce.value)

            source.unlocks.emit(unlock("a"))
            advanceUntilIdle()
            assertEquals(1L, vm.chimeNonce.value)

            // De-duped re-broadcast must not re-chime (no queue growth).
            source.unlocks.emit(unlock("a"))
            advanceUntilIdle()
            assertEquals(1L, vm.chimeNonce.value)

            source.unlocks.emit(unlock("b"))
            advanceUntilIdle()
            assertEquals(2L, vm.chimeNonce.value)
        }

    @Test
    fun chimeStaysSilentWhenSoundOff() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(prefs = MutableStateFlow(AchievementCelebrationPrefs(playSound = false)))
            val vm = AchievementUnlockListenerViewModel(source, RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            source.unlocks.emit(unlock("a"))
            advanceUntilIdle()

            assertEquals(0L, vm.chimeNonce.value)
        }

    // ── dismiss ──────────────────────────────────────────────────────────────────────
    @Test
    fun dismissRemovesAndLogsWithoutLeakingPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource()
            val vm = AchievementUnlockListenerViewModel(source, logger, backgroundScope)
            advanceUntilIdle()
            source.unlocks.emit(unlock("a", name = "Road Warrior"))
            source.unlocks.emit(unlock("b"))
            advanceUntilIdle()

            vm.dismiss("a")
            advanceUntilIdle()

            val queue = vm.state.value.queue
            assertEquals(listOf("b"), queue.map { it.achievement.id })
            val dismissed = logger.records.filter { it.event == "achievementUnlockListener.dismiss" }
            assertEquals(1, dismissed.size)
            assertEquals(ACHIEVEMENT_UNLOCK_LISTENER_SLUG, dismissed.first().fields["slug"])
            assertTrue(
                logger.records.none { record ->
                    record.fields.values.any { it == "a" || it == "Road Warrior" }
                },
            )
        }

    // ── diagnostics ───────────────────────────────────────────────────────────────────
    @Test
    fun viewOpenedEmitsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AchievementUnlockListenerViewModel(FakeSource(), logger, backgroundScope)
            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(ACHIEVEMENT_UNLOCK_LISTENER_SLUG, opened.first().fields["slug"])
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────────
    private fun unlock(
        id: String,
        name: String = "Name",
        description: String = "Description",
        icon: String = "🏆",
    ): AchievementUnlock =
        AchievementUnlock(
            vehicleId = 1L,
            unlockedAt = "2026-01-01T00:00:00Z",
            achievement = Achievement(id = id, name = name, description = description, icon = icon),
        )

    private class FakeSource(
        val prefs: MutableStateFlow<AchievementCelebrationPrefs> = MutableStateFlow(AchievementCelebrationPrefs()),
        val unlocks: MutableSharedFlow<AchievementUnlock> = MutableSharedFlow(extraBufferCapacity = 16),
    ) : AchievementUnlockListenerSource {
        override fun unlocks(): Flow<AchievementUnlock> = unlocks

        override fun celebrationPrefs(): Flow<AchievementCelebrationPrefs> = prefs
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }
}
