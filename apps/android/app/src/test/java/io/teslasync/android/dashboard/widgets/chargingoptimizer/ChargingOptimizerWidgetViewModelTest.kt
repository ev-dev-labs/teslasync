package io.teslasync.android.dashboard.widgets.chargingoptimizer

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
 * Drives [ChargingOptimizerWidgetViewModel] over a controllable fake [ChargingOptimizerSource], covering
 * the full cache-then-network state matrix the web component renders (loading / content / empty / hard
 * error + retry / stale-offline + retry / refresh re-fetch) plus the PII-safe `view.opened` diagnostic and
 * the refresh event — end to end through the real `Resource → UiState` projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargingOptimizerWidgetViewModelTest {
    private val reportA = report(optimalStartHour = 8, savings = 45.0, peak = 25.0)
    private val reportB = report(optimalStartHour = 23, savings = 12.0, peak = 70.0)
    private val emptyReport = ChargingOptimizerReport.Empty

    private class FakeOptimizerSource(
        var emissions: List<Resource<ChargingOptimizerReport>>,
    ) : ChargingOptimizerSource {
        override fun optimizer(): Flow<Resource<ChargingOptimizerReport>> = flow { emissions.forEach { emit(it) } }
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
            val vm = viewModel(FakeOptimizerSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeOptimizerSource(listOf(Resource.Loading(null, null, false), Resource.Success(reportA, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(reportA, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoOptimizerBody() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeOptimizerSource(listOf(Resource.Success(emptyReport, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeOptimizerSource(
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
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeOptimizerSource(listOf(Resource.Success(reportA, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(reportA, vm.state.value.data)

            src.emissions = listOf(Resource.Error(reportA, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(reportA, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedOptimizer() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeOptimizerSource(listOf(Resource.Success(reportA, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(reportA, vm.state.value.data)

            src.emissions = listOf(Resource.Success(reportB, 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(reportB, vm.state.value.data)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeOptimizerSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "ChargingOptimizerWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeOptimizerSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "chargingOptimizer.refresh" })
        }

    private fun TestScope.viewModel(
        source: ChargingOptimizerSource,
        logger: Logger = NoopLogger,
    ): ChargingOptimizerWidgetViewModel = ChargingOptimizerWidgetViewModel(source, logger, backgroundScope)

    private fun report(
        optimalStartHour: Int,
        savings: Double,
        peak: Double,
    ): ChargingOptimizerReport =
        ChargingOptimizerReport.Empty.copy(
            hasData = true,
            optimalStartHour = optimalStartHour,
            targetSocPct = 80.0,
            monthlySavings = savings,
            peakPct = peak,
        )
}
