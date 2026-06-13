// Tests [AchievementUnlockedToastViewModel] against the unlock-queue + wire-health seam — covering the
// contract the view depends on: each snapshot folds onto the [AchievementToastFeed] the stack renders, the
// per-toast auto-dismiss re-acks the unlock after `durationMs` (the web `setTimeout(onDismiss, …)`), a manual
// dismiss cancels that timer + re-acks once, "View" dismisses then hands the id to the host deep link, retry
// reconnects, and the one-shot `view.opened` fires exactly once with the surface slug (never an achievement
// id/name). The framework-free projection is covered by AchievementUnlockedToastProjectionTest. Runs in
// :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.achievementunlockedtoast

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.achievementunlocks.AchievementUnlockedEvent
import io.teslasync.shared.core.presentation.achievementunlocks.LifetimeAchievement
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AchievementUnlockedToastViewModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private class FakeSource(
        initial: AchievementFeedSnapshot,
    ) : AchievementUnlockedToastSource {
        val snapshots = MutableStateFlow(initial)
        val dismissed = mutableListOf<String>()
        var reconnects = 0

        override fun feed(): Flow<AchievementFeedSnapshot> = snapshots

        override fun dismiss(achievementId: String) {
            dismissed += achievementId
            snapshots.update { snap ->
                snap.copy(unlocks = snap.unlocks.filterNot { it.achievement.id == achievementId })
            }
        }

        override fun reconnect() {
            reconnects += 1
        }
    }

    private fun event(id: String): AchievementUnlockedEvent =
        AchievementUnlockedEvent(
            vehicleId = 0,
            unlockedAt = "2026-01-01T00:00:00Z",
            achievement =
                LifetimeAchievement(
                    id = id,
                    name = "First Drive",
                    description = "Complete your first recorded drive",
                    icon = "\uD83C\uDFC1",
                    unlocked = true,
                    unlockedAt = "2026-01-01T00:00:00Z",
                    progress = 1.0,
                ),
        )

    private fun snapshot(
        unlocks: List<AchievementUnlockedEvent> = emptyList(),
        connection: LiveConnectionStatus = LiveConnectionStatus.Connected,
        stale: Boolean = false,
    ) = AchievementFeedSnapshot(unlocks, connection, stale, lastMessageAtMillis = 0L)

    @Test
    fun stateReflectsAContentSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(snapshot(unlocks = listOf(event("a"))))
            val model = AchievementUnlockedToastViewModel(source, RecordingLogger(), durationMs = 0L, scope = backgroundScope)
            runCurrent()

            assertEquals(AchievementToastPhase.Content, model.state.value.phase)
            assertEquals(1, model.state.value.toasts.size)
            assertEquals(
                "a",
                model.state.value.toasts
                    .first()
                    .id,
            )
        }

    @Test
    fun stateReflectsAnEmptyLiveWire() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(snapshot(connection = LiveConnectionStatus.Connected))
            val model = AchievementUnlockedToastViewModel(source, RecordingLogger(), durationMs = 0L, scope = backgroundScope)
            runCurrent()

            assertEquals(AchievementToastPhase.Empty, model.state.value.phase)
        }

    @Test
    fun stateReflectsADownWireAsError() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(snapshot(connection = LiveConnectionStatus.Disconnected))
            val model = AchievementUnlockedToastViewModel(source, RecordingLogger(), durationMs = 0L, scope = backgroundScope)
            runCurrent()

            assertEquals(AchievementToastPhase.Error, model.state.value.phase)
        }

    @Test
    fun autoDismissesEachToastAfterTheConfiguredDuration() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(snapshot(unlocks = listOf(event("a"))))
            val model = AchievementUnlockedToastViewModel(source, RecordingLogger(), durationMs = 1_000L, scope = backgroundScope)
            runCurrent()

            advanceTimeBy(999L)
            runCurrent()
            assertTrue("must not dismiss before the duration elapses", source.dismissed.isEmpty())

            advanceTimeBy(2L)
            runCurrent()
            assertEquals(listOf("a"), source.dismissed)
        }

    @Test
    fun manualDismissReAcksOnceAndCancelsTheAutoDismissTimer() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(snapshot(unlocks = listOf(event("a"))))
            val model = AchievementUnlockedToastViewModel(source, RecordingLogger(), durationMs = 1_000L, scope = backgroundScope)
            runCurrent()

            model.dismiss("a")
            advanceUntilIdle()

            assertEquals("the auto-dismiss timer must not fire a second dismiss", listOf("a"), source.dismissed)
        }

    @Test
    fun viewDismissesThenHandsTheIdToTheHostDeepLink() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(snapshot(unlocks = listOf(event("a"))))
            val model = AchievementUnlockedToastViewModel(source, RecordingLogger(), durationMs = 0L, scope = backgroundScope)
            runCurrent()
            val opened = mutableListOf<String>()

            model.view("a") { opened += it }

            assertEquals(listOf("a"), source.dismissed)
            assertEquals(listOf("a"), opened)
        }

    @Test
    fun retryReconnectsTheLiveWire() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(snapshot(connection = LiveConnectionStatus.Disconnected))
            val model = AchievementUnlockedToastViewModel(source, RecordingLogger(), durationMs = 0L, scope = backgroundScope)

            model.retry()

            assertEquals(1, source.reconnects)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(snapshot())
            val model = AchievementUnlockedToastViewModel(source, logger, durationMs = 0L, scope = backgroundScope)

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("AchievementUnlockedToast", opened.first().fields["surface"])
            assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
        }

    @Test
    fun feedCollectionIsActiveSoTheStackStaysLive() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(snapshot(connection = LiveConnectionStatus.Connected))
            val model = AchievementUnlockedToastViewModel(source, RecordingLogger(), durationMs = 0L, scope = backgroundScope)
            val phases = mutableListOf<AchievementToastPhase>()
            backgroundScope.launch { model.state.collect { phases += it.phase } }
            runCurrent()

            source.snapshots.value = snapshot(unlocks = listOf(event("a")))
            runCurrent()

            assertEquals(AchievementToastPhase.Content, model.state.value.phase)
            assertTrue(phases.contains(AchievementToastPhase.Content))
        }
}
