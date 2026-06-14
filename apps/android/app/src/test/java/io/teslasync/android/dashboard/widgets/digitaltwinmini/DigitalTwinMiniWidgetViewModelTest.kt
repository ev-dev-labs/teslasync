package io.teslasync.android.dashboard.widgets.digitaltwinmini

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
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [DigitalTwinMiniWidgetViewModel] over a controllable fake [DigitalTwinMiniSource], covering the
 * full cache-then-network state matrix the web component renders: the loading skeleton gated by EITHER
 * the security OR the state feed (web `secLoading || stateLoading`), content once the vehicle + feeds
 * resolve, the no-vehicle empty state, the hard fleet error + retry, the soft state-error that keeps the
 * twin visible (web never blanks while a vehicle is enrolled), the stale/offline cached twin + retry, the
 * refresh re-fetch, the default + explicit vehicle resolution, and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DigitalTwinMiniWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : DigitalTwinMiniSource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())
        val stateEmissions = mutableMapOf<Long, List<Resource<VehicleStateEnvelope>>>()
        val securityEmissions = mutableMapOf<Long, List<Resource<JsonElement>>>()
        val chargingEmissions = mutableMapOf<Long, List<Resource<JsonElement>>>()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
            flow { (stateEmissions[vehicleId] ?: listOf(loadingState())).forEach { emit(it) } }

        override fun security(vehicleId: Long): Flow<Resource<JsonElement>> =
            flow { (securityEmissions[vehicleId] ?: listOf(successJson(JsonNull))).forEach { emit(it) } }

        override fun charging(vehicleId: Long): Flow<Resource<JsonElement>> =
            flow { (chargingEmissions[vehicleId] ?: listOf(successJson(JsonNull))).forEach { emit(it) } }
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
    fun contentWhenVehicleAndFeedsResolve() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState(isLocked = true)), 100L, false))
            src.securityEmissions[5] = listOf(successJson(buildJsonObject { put("sentry_mode", true) }))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertEquals(5L, state.data?.vehicle?.id)
            assertNotNull(state.data?.vehicleState)
            assertNotNull(state.data?.security)
        }

    @Test
    fun loadingWhileStateFirstLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(loadingState())
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun loadingWhileSecurityFirstLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState()), 100L, false))
            src.securityEmissions[5] = listOf(loadingJson())
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            // web `isLoading = secLoading || stateLoading` — a first security load also gates the skeleton.
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun emptyWhenNoVehiclesEnrolled() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(emptyList(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val state = vm.state.value
            assertEquals(UiPhase.Empty, state.phase)
            assertNull(state.data?.vehicle)
        }

    @Test
    fun explicitVehicleIdSelectsFromList() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5), vehicle(9)), 50L, false))
            src.stateEmissions[9] = listOf(Resource.Success(envelope(vehicleState()), 100L, false))
            val vm = viewModel(src, vehicleId = 9)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals(
                9L,
                vm.state.value.data
                    ?.vehicle
                    ?.id,
            )
        }

    @Test
    fun explicitVehicleIdFallsBackToFirstWhenAbsent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState()), 100L, false))
            val vm = viewModel(src, vehicleId = 9)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(
                5L,
                vm.state.value.data
                    ?.vehicle
                    ?.id,
            )
        }

    @Test
    fun hardErrorWhenVehiclesListFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(loadingVehicles(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
            assertTrue(vm.state.value.canRetry)
        }

    @Test
    fun stateErrorKeepsTwinVisibleNeverHardError() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(loadingState(), Resource.Error(null, null, false, ApiError.Network()))
            src.securityEmissions[5] = listOf(successJson(buildJsonObject { put("locked", true) }))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            // A failed state fetch (no cache) must NOT blank the twin: the resolved vehicle keeps the
            // surface in Content with a freshness error chip (web never passes WidgetShell's `error`).
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(5L, state.data?.vehicle?.id)
            assertNull(state.data?.vehicleState)
            assertNotNull(state.data?.security)
            assertTrue(state.stale)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedTwinWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState(isLocked = true)), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.stateEmissions[5] =
                listOf(Resource.Error(envelope(vehicleState(isLocked = true)), 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertEquals(ErrorKind.Timeout, state.errorKind)
            assertEquals(true, state.data?.vehicleState?.isLocked)
        }

    @Test
    fun refreshReFetchesUpdatedState() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState(isLocked = false)), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(
                false,
                vm.state.value.data
                    ?.vehicleState
                    ?.isLocked,
            )

            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState(isLocked = true)), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(
                true,
                vm.state.value.data
                    ?.vehicleState
                    ?.isLocked,
            )
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun onViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "DigitalTwinMiniWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsPiiFreeDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "digitalTwinMini.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("locked") || it.second.containsKey("vin") })
        }

    private fun TestScope.viewModel(
        source: DigitalTwinMiniSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): DigitalTwinMiniWidgetViewModel = DigitalTwinMiniWidgetViewModel(source, logger, vehicleId, backgroundScope)

    private companion object {
        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingState(): Resource<VehicleStateEnvelope> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingJson(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun successJson(value: JsonElement): Resource<JsonElement> = Resource.Success(value, 100L, false)

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
                color = "PearlWhite",
                model = "Model 3",
            )

        fun vehicleState(isLocked: Boolean = false): VehicleState =
            VehicleState(
                batteryLevel = 60,
                chargeRate = 0.0,
                chargerPower = 0.0,
                idealRange = 300_000.0,
                insideTemp = 20.0,
                isCharging = false,
                isClimateOn = false,
                isLocked = isLocked,
                latitude = 0.0,
                longitude = 0.0,
                odometer = 0.0,
                outsideTemp = 10.0,
                power = 0.0,
                ratedRange = 300_000.0,
                sentryMode = false,
                softwareVersion = "2025.1.0",
                speed = 0.0,
                state = "online",
                timeToFullCharge = 0.0,
                vehicleId = 5,
            )
    }
}
