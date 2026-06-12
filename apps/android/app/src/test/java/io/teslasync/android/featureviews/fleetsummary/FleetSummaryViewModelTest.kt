package io.teslasync.android.featureviews.fleetsummary

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
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
 * Drives [FleetSummaryViewModel] over a controllable fake [FleetSummarySource], covering the full
 * cache-then-network state matrix the web component renders (loading / content / empty-as-zeros / hard
 * error + retry / stale-offline via the enrolled list OR a per-vehicle state + retry / refresh re-fetch)
 * across the COMBINED `useVehicles` + per-vehicle `useVehicleState` fan-out, plus the PII-safe
 * `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FleetSummaryViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : FleetSummarySource {
        var vehicleEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())
        val stateEmissions: MutableMap<Long, List<Resource<VehicleStateEnvelope>>> = mutableMapOf()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehicleEmissions.forEach { emit(it) } }

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
            flow { (stateEmissions[vehicleId] ?: listOf(loadingState())).forEach { emit(it) } }
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
    fun loadingWhileVehiclesLoad() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenVehiclesAndStatesPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehicleEmissions = listOf(Resource.Success(listOf(vehicle(1), vehicle(2)), 100L, false))
            src.stateEmissions[1] = listOf(Resource.Success(envelope(80, 300_000.0, charging = true), 100L, false))
            src.stateEmissions[2] = listOf(Resource.Success(envelope(60, 200_000.0, charging = false), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            val data = state.data!!
            assertEquals(2, data.vehicleCount)
            assertEquals(70.0, data.avgBatteryPercent, 1e-9)
            assertEquals(500_000.0, data.totalRangeMeters, 1e-9)
            assertEquals(1, data.chargingCount)
            assertEquals(2, data.onlineCount)
            assertFalse(state.stale)
        }

    @Test
    fun emptyFleetRendersZerosAsContent() =
        runTest(UnconfinedTestDispatcher()) {
            // No enrolled vehicles: the web `?? 0` fall-through renders the four labelled cards with zeros —
            // a friendly Content surface, never a blank box and never a spinner.
            val src = FakeSource()
            src.vehicleEmissions = listOf(Resource.Success(emptyList(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(FleetSummaryData.EMPTY, state.data)
        }

    @Test
    fun hardErrorWithRetryWhenVehiclesFailWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehicleEmissions = listOf(loadingVehicles(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedVehiclesWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehicleEmissions = listOf(Resource.Success(listOf(vehicle(1)), 100L, false))
            src.stateEmissions[1] = listOf(Resource.Success(envelope(50, 100_000.0, charging = false), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            // The enrolled-list refresh fails but the cached list is still served (offline / last known).
            src.vehicleEmissions = listOf(Resource.Error(listOf(vehicle(1)), 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
            assertEquals(1, state.data!!.vehicleCount)
        }

    @Test
    fun staleOfflineWhenAPerVehicleStateGoesOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehicleEmissions = listOf(Resource.Success(listOf(vehicle(1)), 100L, false))
            src.stateEmissions[1] = listOf(Resource.Success(envelope(50, 100_000.0, charging = false), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            // The list is fresh but a vehicle's state refresh fails — the cards stay, flagged offline.
            src.stateEmissions[1] = listOf(Resource.Error(envelope(50, 100_000.0, charging = false), 100L, true, ApiError.Network()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Network, state.errorKind)
            // The cached state still drives the figures (web keeps prior data during a failed refetch).
            assertEquals(50.0, state.data!!.avgBatteryPercent, 1e-9)
        }

    @Test
    fun refreshReFetchesUpdatedStates() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehicleEmissions = listOf(Resource.Success(listOf(vehicle(1)), 100L, false))
            src.stateEmissions[1] = listOf(Resource.Success(envelope(40, 100_000.0, charging = false), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(
                40.0,
                vm.state.value.data!!
                    .avgBatteryPercent,
                1e-9,
            )

            src.stateEmissions[1] = listOf(Resource.Success(envelope(90, 100_000.0, charging = true), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            val refreshed = vm.state.value.data!!
            assertEquals(90.0, refreshed.avgBatteryPercent, 1e-9)
            assertEquals(1, refreshed.chargingCount)
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
            assertEquals(mapOf("surface" to "FleetSummary"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutFleetPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "fleetSummary.refresh" })
            assertTrue(logger.events.none { it.second.containsKey("vehicleCount") })
            assertTrue(logger.events.none { it.second.containsKey("battery") })
            assertTrue(logger.events.flatMap { it.second.values }.none { it.any(Char::isDigit) })
        }

    private fun TestScope.viewModel(
        source: FleetSummarySource,
        logger: Logger = NoopLogger,
    ): FleetSummaryViewModel = FleetSummaryViewModel(source, logger, backgroundScope)

    private companion object {
        private val EPOCH = Instant.fromEpochMilliseconds(0)

        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingState(): Resource<VehicleStateEnvelope> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun envelope(
            battery: Long,
            rangeMeters: Double,
            charging: Boolean,
        ): VehicleStateEnvelope = VehicleStateEnvelope(state = vehicleState(battery, rangeMeters, charging), live = false)

        fun vehicleState(
            battery: Long,
            rangeMeters: Double,
            charging: Boolean,
        ): VehicleState =
            VehicleState(
                batteryLevel = battery,
                chargeRate = 0.0,
                chargerPower = 0.0,
                idealRange = 0.0,
                insideTemp = 0.0,
                isCharging = charging,
                isClimateOn = false,
                isLocked = true,
                latitude = 0.0,
                longitude = 0.0,
                odometer = 0.0,
                outsideTemp = 0.0,
                power = 0.0,
                ratedRange = rangeMeters,
                sentryMode = false,
                softwareVersion = "",
                speed = 0.0,
                state = "online",
                timeToFullCharge = 0.0,
                vehicleId = 1,
            )

        fun vehicle(id: Long): Vehicle =
            Vehicle(
                createdAt = EPOCH,
                displayName = "Vehicle $id",
                enrolledAt = EPOCH,
                id = id,
                teslaId = id,
                timezone = "UTC",
                updatedAt = EPOCH,
                vin = "VIN$id",
            )
    }
}
