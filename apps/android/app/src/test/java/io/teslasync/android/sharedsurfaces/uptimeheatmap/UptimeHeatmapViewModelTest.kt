package io.teslasync.android.sharedsurfaces.uptimeheatmap

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [UptimeHeatmapViewModel] over a controllable fake [UptimeHeatmapSource], covering the full lifecycle
 * the web component's `days` prop renders: a first load → loading, a fed window → content, an empty window →
 * the empty phase, a hard failure → error, a cached window after a failed refresh → the offline (stale +
 * cached) surface, a retry re-requesting the source, and the PII-safe `view.opened` + `uptimeHeatmap.refresh`
 * diagnostics — end to end through the real `toUiState` projection. The VM's feed is `WhileSubscribed`, so
 * each case keeps an active collector alive on the background scope.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UptimeHeatmapViewModelTest {
    private class FakeUptimeHeatmapSource(
        initial: Resource<UptimeWindow> = Resource.Loading(cached = null, fetchedAt = null, stale = false),
    ) : UptimeHeatmapSource {
        val feed = MutableStateFlow(initial)
        var refreshCalls: Int = 0

        override fun window(): Flow<Resource<UptimeWindow>> = feed

        override fun refresh() {
            refreshCalls++
        }
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

    @Test
    fun loadingResolvesToContentWhenWindowArrives() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeUptimeHeatmapSource()
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)

            source.feed.value = Resource.Success(window(5), fetchedAt = STAMP, stale = false)
            advanceUntilIdle()
            val resolved = vm.state.value
            assertEquals(UiPhase.Content, resolved.phase)
            assertEquals(5, resolved.data?.days?.size)
        }

    @Test
    fun emptyWindowMapsToEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeUptimeHeatmapSource(Resource.Success(window(0), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeUptimeHeatmapSource(
                    Resource.Error(cached = null, fetchedAt = null, stale = false, error = IllegalStateException("x")),
                )
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)
            assertNotNull(vm.state.value.errorKind)
        }

    @Test
    fun errorWithCachedWindowKeepsItAndFlagsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeUptimeHeatmapSource(
                    Resource.Error(
                        cached = window(4),
                        fetchedAt = STAMP,
                        stale = true,
                        error = IllegalStateException("net"),
                    ),
                )
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertNotNull(state.errorKind)
            assertEquals(UptimeHeatmapFreshness.Offline, UptimeHeatmapProjection.freshness(state))
        }

    @Test
    fun retryRequestsTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeUptimeHeatmapSource(Resource.Success(window(3), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(0, source.refreshCalls)

            vm.retry()
            advanceUntilIdle()
            assertEquals(1, source.refreshCalls)
        }

    @Test
    fun retryEmitsRefreshDiagnosticWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeUptimeHeatmapSource(Resource.Success(window(3), fetchedAt = STAMP, stale = false)), logger)
            observe(vm)
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            val refresh = logger.events.single { it.first == "uptimeHeatmap.refresh" }
            assertEquals(mapOf("surface" to "UptimeHeatmap"), refresh.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeUptimeHeatmapSource(Resource.Success(window(3), fetchedAt = STAMP, stale = false)), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "UptimeHeatmap"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: UptimeHeatmapSource,
        logger: Logger = NoopLogger,
    ): UptimeHeatmapViewModel = UptimeHeatmapViewModel(source, logger, backgroundScope)

    private fun TestScope.observe(vm: UptimeHeatmapViewModel) {
        backgroundScope.launch { vm.state.collect {} }
    }

    private fun window(days: Int): UptimeWindow =
        UptimeWindow(days = (0 until days).map { UptimeDay(date = "2026-05-%02d".format(it + 1), status = UptimeStatus.Healthy) })

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
