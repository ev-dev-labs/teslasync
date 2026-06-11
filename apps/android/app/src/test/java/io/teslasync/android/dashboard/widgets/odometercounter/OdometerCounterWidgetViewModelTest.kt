package io.teslasync.android.dashboard.widgets.odometercounter

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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [OdometerCounterWidgetViewModel] over a controllable fake [OdometerCounterSource], covering the
 * full cache-then-network state matrix the web component renders (loading / content / empty / hard error +
 * retry / stale-offline + retry / refresh re-fetch / stats-error tolerance), the default-vehicle resolution
 * from the vehicles list (web `vehicles?.[0]?.id`), the explicit-vehicle override, and the PII-safe
 * `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OdometerCounterWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : OdometerCounterSource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())
        val stateEmissions = mutableMapOf<Long, List<Resource<VehicleStateEnvelope>>>()
        val statsEmissions = mutableMapOf<String, List<Resource<JsonElement>>>()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
            flow { (stateEmissions[vehicleId] ?: listOf(loadingState())).forEach { emit(it) } }

        override fun drivingStats(vehicleId: String): Flow<Resource<JsonElement>> =
            flow { (statsEmissions[vehicleId] ?: listOf(successStats())).forEach { emit(it) } }
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
    fun loadingWhileVehiclesListLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenFirstVehicleHasOdometer() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState(odometer = 402_336.0)), 100L, false))
            src.statsEmissions["5"] = listOf(Resource.Success(statsJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            val data = requireNotNull(state.data)
            assertEquals(402_336.0, requireNotNull(data.odometerMeters), 1e-6)
            assertEquals(80_467.2, requireNotNull(data.totalDistanceKm), 1e-6)
        }

    @Test
    fun emptyWhenNoVehiclesEnrolled() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(emptyList(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyWhenStateHasNoDecodableVehicleState() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(null), 100L, false))
            src.statsEmissions["5"] = listOf(Resource.Success(statsJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun explicitVehicleIdBypassesVehiclesList() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            // Vehicles list never resolves; the explicit id must still drive the odometer feed.
            src.stateEmissions[9] = listOf(Resource.Success(envelope(vehicleState()), 100L, false))
            src.statsEmissions["9"] = listOf(Resource.Success(statsJson(), 100L, false))
            val vm = viewModel(src, vehicleId = 9)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenStateFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(loadingState(), Resource.Error(null, null, false, ApiError.Network()))
            src.statsEmissions["5"] = listOf(Resource.Success(statsJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun statsErrorDoesNotBlankTheWidget() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState()), 100L, false))
            src.statsEmissions["5"] = listOf(Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertFalse(state.hasError)
            assertNull(state.data?.totalDistanceKm)
        }

    @Test
    fun staleOfflineKeepsCachedStateWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState()), 100L, false))
            src.statsEmissions["5"] = listOf(Resource.Success(statsJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.stateEmissions[5] = listOf(Resource.Error(envelope(vehicleState()), 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedOdometer() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState(odometer = 100_000.0)), 100L, false))
            src.statsEmissions["5"] = listOf(Resource.Success(statsJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = vm.state.value
            assertEquals(100_000.0, requireNotNull(before.data?.odometerMeters), 1e-6)

            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState(odometer = 250_000.0)), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            val after = vm.state.value
            assertEquals(250_000.0, requireNotNull(after.data?.odometerMeters), 1e-6)
            assertEquals(200L, after.fetchedAt)
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
            assertEquals(mapOf("surface" to "OdometerCounterWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "odometerCounter.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("odometer") })
        }

    private fun TestScope.viewModel(
        source: OdometerCounterSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): OdometerCounterWidgetViewModel = OdometerCounterWidgetViewModel(source, logger, vehicleId, backgroundScope)

    private companion object {
        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingState(): Resource<VehicleStateEnvelope> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun successStats(): Resource<JsonElement> = Resource.Success(statsJson(), 100L, false)

        fun statsJson(totalDistanceKm: Double = 80_467.2): JsonElement = buildJsonObject { put("total_distance_km", totalDistanceKm) }

        fun envelope(state: VehicleState?): VehicleStateEnvelope = VehicleStateEnvelope(state = state, live = false)

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

        fun vehicleState(odometer: Double = 402_336.0): VehicleState =
            VehicleState(
                batteryLevel = 72,
                chargeRate = 0.0,
                chargerPower = 0.0,
                idealRange = 0.0,
                insideTemp = 0.0,
                isCharging = false,
                isClimateOn = false,
                isLocked = true,
                latitude = 0.0,
                longitude = 0.0,
                odometer = odometer,
                outsideTemp = 0.0,
                power = 0.0,
                ratedRange = 0.0,
                sentryMode = false,
                softwareVersion = "2025.1.0",
                speed = 0.0,
                state = "online",
                timeToFullCharge = 0.0,
                vehicleId = 5,
            )
    }
}
