package io.teslasync.android.dashboard.widgets.chargingtelemetry

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
 * Drives [ChargingTelemetryWidgetViewModel] over a controllable fake [ChargingTelemetrySource],
 * covering the full cache-then-network state matrix the web component renders (loading / content
 * while charging / empty while not-charging / empty with no telemetry / hard error + retry /
 * stale-offline + retry / refresh re-fetch), the rolling power-history fold (web `powerHistoryRef`),
 * and the PII-safe `view.opened` + refresh diagnostics — end to end through the real projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargingTelemetryWidgetViewModelTest {
    private val charging = charging(power = 8.0, ts = "t1")
    private val notCharging =
        ChargingTelemetrySnapshot(
            chargingState = "Stopped",
            chargerVoltage = 0.0,
            chargerActualCurrent = 0.0,
            chargerPowerW = 0.0,
            chargerPhases = 0,
            chargerPilotCurrent = 0.0,
            ts = "t1",
        )

    private class FakeSource(
        var emissions: List<Resource<ChargingTelemetrySnapshot?>>,
    ) : ChargingTelemetrySource {
        override fun stream(): Flow<Resource<ChargingTelemetrySnapshot?>> = flow { emissions.forEach { emit(it) } }
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
    fun contentWhenCharging() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(charging, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(charging, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNotCharging() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(notCharging, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            // A resolved-but-not-charging snapshot is the web "Not currently charging" empty surface.
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyWhenNullSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success<ChargingTelemetrySnapshot?>(null, 100L, false))))
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
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(charging, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(charging, vm.state.value.data)

            src.emissions = listOf(Resource.Error(charging, 100L, true, ApiError.Timeout()))
            vm.retry()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(charging, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun retryReFetchesUpdatedSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val updated = charging(power = 11.0, ts = "t2")
            val src = FakeSource(listOf(Resource.Success(charging, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(charging, vm.state.value.data)

            src.emissions = listOf(Resource.Success(updated, 200L, false))
            vm.retry()
            advanceUntilIdle()

            assertEquals(updated, vm.state.value.data)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun powerHistoryAccumulatesDistinctTimestamps() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    listOf(
                        Resource.Success(charging(power = 5.0, ts = "t1"), 100L, false),
                        Resource.Success(charging(power = 9.0, ts = "t2"), 200L, false),
                    ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            backgroundScope.launch { vm.powerHistory.collect {} }
            advanceUntilIdle()

            assertEquals(listOf(5.0, 9.0), vm.powerHistory.value)
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
            assertEquals(mapOf("surface" to "ChargingTelemetryWidget"), opened.single().second)
        }

    @Test
    fun retryEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.retry()

            assertTrue(logger.events.any { it.first == "chargingTelemetry.retry" })
        }

    private fun TestScope.viewModel(
        source: ChargingTelemetrySource,
        logger: Logger = NoopLogger,
    ): ChargingTelemetryWidgetViewModel = ChargingTelemetryWidgetViewModel(source, logger, backgroundScope)

    private fun charging(
        power: Double,
        ts: String,
    ): ChargingTelemetrySnapshot =
        ChargingTelemetrySnapshot(
            chargingState = "Charging",
            chargerVoltage = 240.0,
            chargerActualCurrent = 32.0,
            chargerPowerW = power,
            chargerPhases = 1,
            chargerPilotCurrent = 40.0,
            ts = ts,
        )
}
