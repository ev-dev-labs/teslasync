package io.teslasync.android.dashboard.widgets.tirepressurehistory

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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [TirePressureHistoryWidgetViewModel] over a controllable fake [TirePressureHistorySource],
 * covering the full cache-then-network state matrix the web component renders — loading / content / empty
 * (no rows) / hard error + retry / stale-offline + retry / refresh re-fetch — plus the PII-safe
 * `view.opened` diagnostic and the refresh event, end to end through the real
 * [io.teslasync.android.data.UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TirePressureHistoryWidgetViewModelTest {
    private fun rows(vararg pressuresPa: Double): Resource<TirePressureHistorySnapshot> {
        val points =
            pressuresPa.mapIndexed { index, pa ->
                TirePressurePoint("2024-06-11T0$index:00:00Z", frontLeftPa = pa, frontRightPa = pa, rearLeftPa = pa, rearRightPa = pa)
            }
        return Resource.Success(TirePressureHistorySnapshot.of(points), FETCHED_AT, false)
    }

    private class FakeSource(
        var emissions: List<Resource<TirePressureHistorySnapshot>>,
    ) : TirePressureHistorySource {
        override fun stream(): Flow<Resource<TirePressureHistorySnapshot>> = flow { emissions.forEach { emit(it) } }
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
    fun contentWhenRowsResolve() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(rows(230000.0, 240000.0))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            val data = state.data!!
            assertTrue(data.hasData)
            assertEquals(2, data.points.size)
            assertEquals(FETCHED_AT, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoRows() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(TirePressureHistorySnapshot.EMPTY, FETCHED_AT, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Empty, state.phase)
            assertNotNull(state.data)
            assertFalse(state.data!!.hasData)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Error(null, null, false, ApiError.Network()))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedChartWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(rows(240000.0)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val initial = vm.state.value.data!!
            assertEquals(1, initial.points.size)

            val cached = TirePressureHistorySnapshot.of(listOf(TirePressurePoint("2024-06-11T00:00:00Z", 240000.0, null, null, null)))
            src.emissions = listOf(Resource.Error(cached, FETCHED_AT, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(1, state.data!!.points.size)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedHistory() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(rows(240000.0)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val initial = vm.state.value.data!!
            assertEquals(1, initial.points.size)

            src.emissions = listOf(rows(240000.0, 250000.0, 260000.0))
            vm.refresh()
            advanceUntilIdle()

            val updated = vm.state.value.data!!
            assertEquals(3, updated.points.size)
        }

    @Test
    fun recordViewOpenedEmitsSurfaceExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "TirePressureHistoryWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "tirePressureHistory.refresh" })
        }

    private fun TestScope.viewModel(
        source: TirePressureHistorySource,
        logger: Logger = NoopLogger,
    ): TirePressureHistoryWidgetViewModel = TirePressureHistoryWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        const val FETCHED_AT = 100L
    }
}
