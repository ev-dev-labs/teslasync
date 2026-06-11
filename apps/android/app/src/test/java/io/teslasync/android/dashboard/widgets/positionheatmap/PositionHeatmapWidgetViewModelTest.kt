package io.teslasync.android.dashboard.widgets.positionheatmap

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [PositionHeatmapWidgetViewModel] over a controllable fake [PositionHeatmapSource], covering
 * the full cache-then-network state matrix the web component renders (loading / content with a real
 * fix / empty with no positions / empty with only `0,0` readings / hard error + retry / stale-offline +
 * retry / refresh re-fetch) and the PII-safe `view.opened` + refresh diagnostics. The web
 * `clusters.length === 0` empty gate is exercised both ways: an empty list AND an all-`0,0` list both
 * map to empty, while a list with ≥1 real fix maps to content.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PositionHeatmapWidgetViewModelTest {
    private val realFix = listOf(HeatPosition(37.5, -122.25), HeatPosition(37.51, -122.26))
    private val zeroOnly = listOf(HeatPosition(0.0, 0.0), HeatPosition(0.0, 0.0))

    private class FakeSource(
        var emissions: List<Resource<List<HeatPosition>>>,
    ) : PositionHeatmapSource {
        override fun stream(): Flow<Resource<List<HeatPosition>>> = flow { emissions.forEach { emit(it) } }
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
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenPositionsResolved() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(realFix, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(realFix, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoPositions() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptyList<HeatPosition>(), 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyWhenOnlyZeroZeroReadings() =
        runTest(UnconfinedTestDispatcher()) {
            // A present-but-all-0,0 response is the web `clusters.length === 0` empty map, NOT content.
            val vm = viewModel(FakeSource(listOf(Resource.Success(zeroOnly, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedFixWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(realFix, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(realFix, vm.state.value.data)

            src.emissions = listOf(Resource.Error(realFix, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(realFix, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedPositions() =
        runTest(UnconfinedTestDispatcher()) {
            val updated = listOf(HeatPosition(40.0, -74.0))
            val src = FakeSource(listOf(Resource.Success(realFix, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(realFix, vm.state.value.data)

            src.emissions = listOf(Resource.Success(updated, 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(updated, vm.state.value.data)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "PositionHeatmapWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "positionHeatmap.refresh" })
        }

    @Test
    fun recordViewOpenedCarriesNoLocationFields() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()

            val fields = logger.events.single { it.first == "view.opened" }.second
            // PII-safe: only the surface slug, never coordinates / vehicle id.
            assertEquals(mapOf("surface" to "PositionHeatmapWidget"), fields)
        }

    private fun TestScope.viewModel(
        source: PositionHeatmapSource,
        logger: Logger = NoopLogger,
    ): PositionHeatmapWidgetViewModel = PositionHeatmapWidgetViewModel(source, logger, backgroundScope)
}
