package io.teslasync.android.sharedsurfaces.playbackcontrols

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [PlaybackControlsViewModel] over a controllable fake [ReplayTimelineSource], covering the full
 * lifecycle the web bar renders: the cache-then-network states (loading / content / empty / offline /
 * error), the virtual replay clock (play advances and stops at the end, pause/stop, speed, seek, frame
 * step), the keyboard shortcut path with its auto-clearing toast, the stale-on-new-drive reset, and the
 * PII-safe `view.opened` diagnostic — end to end through the real projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PlaybackControlsViewModelTest {
    private class FakeSource(
        val flow: MutableStateFlow<Resource<ReplayTimeline>>,
    ) : ReplayTimelineSource {
        override fun timeline(): Flow<Resource<ReplayTimeline>> = flow
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    // ── Cache-then-network lifecycle ─────────────────────────────────────────────

    @Test
    fun loadingWithoutCacheRendersLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(loading())))
            advanceUntilIdle()
            assertTrue(vm.state.value.isLoading)
        }

    @Test
    fun successExposesTheBuiltTimeline() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(success(longTimeline()))))
            advanceUntilIdle()
            assertTrue(vm.state.value.isContent)
            assertEquals(60_000L, vm.state.value.timeline.totalMs)
        }

    @Test
    fun successWithNoPositionsRendersEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(success(ReplayTimeline.EMPTY))))
            advanceUntilIdle()
            assertTrue(vm.state.value.isEmpty)
        }

    @Test
    fun errorWithNoCacheRendersError() =
        runTest(UnconfinedTestDispatcher()) {
            val source = MutableStateFlow<Resource<ReplayTimeline>>(error(cache = null))
            val vm = viewModel(FakeSource(source))
            advanceUntilIdle()
            assertTrue(vm.state.value.isError)
            assertTrue(vm.state.value.canRetry)
        }

    @Test
    fun errorWithCacheStaysOfflineOverTheCachedTrack() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(error(cache = longTimeline()))))
            advanceUntilIdle()
            assertTrue(vm.state.value.isContent)
            assertTrue(vm.state.value.isOffline)
            assertTrue(vm.state.value.canRetry)
        }

    @Test
    fun retryReCollectsAndRecovers() =
        runTest(UnconfinedTestDispatcher()) {
            val source = MutableStateFlow<Resource<ReplayTimeline>>(error(cache = null))
            val vm = viewModel(FakeSource(source))
            advanceUntilIdle()
            assertTrue(vm.state.value.isError)

            source.value = success(longTimeline())
            vm.retry()
            advanceUntilIdle()
            assertTrue(vm.state.value.isContent)
        }

    // ── Replay clock (web useTripReplay) ─────────────────────────────────────────

    @Test
    fun playAdvancesAndStopsAtTheEnd() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(success(ReplayTimeline(listOf(0L, 100L))))))
            advanceUntilIdle()

            vm.play()
            advanceTimeBy(300L)
            runCurrent()

            assertFalse(vm.state.value.isPlaying)
            assertEquals(100L, vm.state.value.clock.elapsedMs)
            assertEquals(1.0, vm.state.value.progress, 1e-9)
        }

    @Test
    fun pauseFreezesTheClock() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(success(longTimeline()))))
            advanceUntilIdle()

            vm.play()
            advanceTimeBy(300L)
            runCurrent()
            vm.pause()
            val frozen = vm.state.value.clock.elapsedMs
            advanceTimeBy(2_000L)
            runCurrent()

            assertFalse(vm.state.value.isPlaying)
            assertEquals(frozen, vm.state.value.clock.elapsedMs)
            assertTrue(frozen in 1L..59_999L)
        }

    @Test
    fun stopRewindsToTheStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(success(longTimeline()))))
            advanceUntilIdle()

            vm.seekToProgress(0.5)
            vm.stop()

            assertFalse(vm.state.value.isPlaying)
            assertEquals(0L, vm.state.value.clock.elapsedMs)
            assertEquals(0, vm.state.value.clock.currentIndex)
        }

    @Test
    fun speedControlsCycleAndStep() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(success(longTimeline()))))
            advanceUntilIdle()

            vm.setSpeed(50)
            assertEquals(50, vm.state.value.clock.speed)
            vm.cycleSpeed()
            assertEquals(100, vm.state.value.clock.speed)
            vm.speedRelative(-1)
            assertEquals(50, vm.state.value.clock.speed)
        }

    @Test
    fun seekAndFrameStepMoveThePlayhead() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(success(longTimeline()))))
            advanceUntilIdle()

            vm.seekToProgress(0.5)
            assertEquals(30_000L, vm.state.value.clock.elapsedMs)
            vm.seekBySeconds(-10)
            assertEquals(20_000L, vm.state.value.clock.elapsedMs)
            vm.stepFrame(1)
            assertEquals(21_000L, vm.state.value.clock.elapsedMs)
        }

    // ── Keyboard shortcut path + toast ───────────────────────────────────────────

    @Test
    fun shortcutAppliesEffectAndAutoClearsToast() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(success(longTimeline()))))
            advanceUntilIdle()

            val action = PlaybackControlsProjection.actionForKey(ShortcutKey.ArrowRight, shift = false, wasPlaying = false)!!
            vm.onShortcut(action)
            assertEquals(5_000L, vm.state.value.clock.elapsedMs)
            assertEquals(ShortcutToast.Skip(5), vm.state.value.toast)

            advanceTimeBy(1_000L)
            assertNull(vm.state.value.toast)
        }

    @Test
    fun helpToggleFlipsVisibility() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(MutableStateFlow(success(longTimeline()))))
            advanceUntilIdle()

            assertFalse(vm.state.value.helpVisible)
            vm.setHelpVisible(true)
            assertTrue(vm.state.value.helpVisible)
        }

    // ── Drive change + diagnostics ───────────────────────────────────────────────

    @Test
    fun aNewDriveTimelineResetsTheClock() =
        runTest(UnconfinedTestDispatcher()) {
            val source = MutableStateFlow(success(longTimeline()))
            val vm = viewModel(FakeSource(source))
            advanceUntilIdle()

            vm.play()
            advanceTimeBy(300L)
            runCurrent()
            assertTrue(vm.state.value.clock.elapsedMs > 0L)

            source.value = success(ReplayTimeline((0..30).map { it * 1_000L }))
            advanceUntilIdle()

            assertEquals(0L, vm.state.value.clock.elapsedMs)
            assertFalse(vm.state.value.isPlaying)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(MutableStateFlow(loading())), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "PlaybackControls"), opened.single().second)
        }

    // ── Fixtures ─────────────────────────────────────────────────────────────────

    private fun loading(): Resource<ReplayTimeline> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

    private fun success(timeline: ReplayTimeline): Resource<ReplayTimeline> =
        Resource.Success(data = timeline, fetchedAt = 1L, stale = false)

    private fun error(cache: ReplayTimeline?): Resource<ReplayTimeline> =
        Resource.Error(cached = cache, fetchedAt = cache?.let { 1L }, stale = true, error = RuntimeException("boom"))

    private fun longTimeline(): ReplayTimeline = ReplayTimeline((0..60).map { it * 1_000L })

    private fun TestScope.viewModel(
        source: ReplayTimelineSource,
        logger: Logger = NoopLogger,
    ): PlaybackControlsViewModel = PlaybackControlsViewModel(source, logger, shortcutsEnabled = true, scope = backgroundScope)
}
