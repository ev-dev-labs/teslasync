package io.teslasync.android.dashboard.widgets.signallog

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SignalObservationsParams
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.VehicleTelemetry
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
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [SignalLogWidgetViewModel] over a controllable fake [SignalLogSource], covering the full
 * cache-then-network state matrix the web component renders: the no-vehicle empty branch (web id≤0 ⇒
 * disabled query), the default-vehicle resolution (web `vehicles?.[0]?.id`), the explicit-vehicle override,
 * the observation feed's loading / content / empty / hard-error + retry / stale-offline + retry / refresh
 * re-fetch, the MQTT-driven signals/sec [SignalLogWidgetViewModel.rate], and the PII-safe `view.opened`
 * diagnostic — end to end through the real projection pipeline.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignalLogWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : SignalLogSource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())
        val observationEmissions = mutableMapOf<Long, List<Resource<List<SignalObservation>>>>()
        var mqttEmissions: List<Resource<TelemetryStatus>> = emptyList()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun signalObservations(params: SignalObservationsParams): Flow<Resource<List<SignalObservation>>> =
            flow { (observationEmissions[params.vehicleId] ?: listOf(loadingObservations())).forEach { emit(it) } }

        override fun mqttStatus(): Flow<Resource<TelemetryStatus>> = flow { mqttEmissions.forEach { emit(it) } }
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
    fun emptyWhenNoVehicleResolves() =
        runTest(UnconfinedTestDispatcher()) {
            // Vehicles list never resolves (web id≤0 ⇒ disabled query) → friendly empty feed, not a spinner.
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun contentWhenFirstVehicleHasObservations() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.observationEmissions[5] = listOf(Resource.Success(listOf(observation("VehicleSpeed")), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(1, state.data?.size)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun explicitVehicleIdBypassesVehiclesList() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            // Vehicles list never resolves; the explicit id must still drive the observation feed.
            src.observationEmissions[9] = listOf(Resource.Success(listOf(observation("Gear")), 100L, false))
            val vm = viewModel(src, vehicleId = 9)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun emptyWhenVehicleHasNoObservations() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.observationEmissions[5] = listOf(Resource.Success(emptyList(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun loadingWhenObservationsLoadWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.observationEmissions[5] = listOf(loadingObservations())
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.observationEmissions[5] = listOf(loadingObservations(), Resource.Error(null, null, false, ApiError.Network()))
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
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.observationEmissions[5] =
                listOf(Resource.Error(listOf(observation("VehicleSpeed")), 100L, true, ApiError.Timeout()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(1, state.data?.size)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesObservations() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.observationEmissions[5] = listOf(Resource.Success(listOf(observation("Gear")), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(100L, vm.state.value.fetchedAt)

            src.observationEmissions[5] = listOf(Resource.Success(listOf(observation("Gear"), observation("Speed")), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            val refreshed = vm.state.value
            assertEquals(2, refreshed.data?.size)
            assertEquals(200L, refreshed.fetchedAt)
        }

    @Test
    fun rateAggregatesPerVehicleSignalsPerSecondFromMqtt() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.mqttEmissions = listOf(Resource.Success(status(streaming(2.5), streaming(1.0)), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.rate.collect {} }
            advanceUntilIdle()
            assertEquals(3.5, vm.rate.value, 0.0001)
        }

    @Test
    fun rateDefaultsToZeroBeforeMqttStatusArrives() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.rate.collect {} }
            advanceUntilIdle()
            assertEquals(0.0, vm.rate.value, 0.0001)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "SignalLogWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutSignalPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "signalLog.refresh" })
            // Never leak what the vehicle reported through a diagnostics line.
            assertFalse(logger.events.any { it.second.containsKey("signal") || it.second.containsKey("value") })
        }

    private fun TestScope.viewModel(
        source: SignalLogSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): SignalLogWidgetViewModel = SignalLogWidgetViewModel(source, logger, vehicleId, backgroundScope)

    private companion object {
        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingObservations(): Resource<List<SignalObservation>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun observation(signalName: String): SignalObservation =
            SignalObservation(
                vehicleId = 1L,
                ts = "2026-01-01T00:00:00Z",
                signalName = signalName,
                valueNumeric = 1.0,
                valueText = null,
                valueBool = null,
                source = "fleet_telemetry",
            )

        fun status(vararg vehicles: VehicleTelemetry): TelemetryStatus =
            TelemetryStatus(
                connected = true,
                broker = "tcp://mosquitto:1883",
                uptimeSeconds = 1.0,
                vehicles = vehicles.toList(),
                topics = emptyList(),
            )

        fun streaming(signalsPerSecond: Double): VehicleTelemetry =
            VehicleTelemetry(
                vin = "5YJ3E1EA1KF000001",
                vehicleId = 1L,
                state = "streaming",
                signalCount = 1L,
                batchCount = 0L,
                signalsPerSecond = signalsPerSecond,
                lastReceived = null,
                isStreaming = true,
                dataSource = "fleet_telemetry",
                latencyMs = null,
            )

        fun vehicle(id: Long): Vehicle =
            Vehicle(
                createdAt = Instant.fromEpochSeconds(0),
                displayName = "Car $id",
                enrolledAt = Instant.fromEpochSeconds(0),
                id = id,
                teslaId = id,
                timezone = "UTC",
                updatedAt = Instant.fromEpochSeconds(0),
                vin = "VIN$id",
            )
    }
}
