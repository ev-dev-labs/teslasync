package io.teslasync.android.dashboard.widgets.vehiclehero

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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [VehicleHeroWidgetViewModel] over a controllable fake [VehicleHeroWidgetSource], covering the full
 * cache-then-network state matrix the web widget renders (loading / content / empty / hard error + retry /
 * soft state-error keeping the hero / stale-offline + retry / refresh re-fetch), the default-vehicle
 * resolution from the vehicles list (web `vehicles?.[0]`), the explicit-vehicle override (incl. the
 * fall-back-to-first when the id is absent), the firmware fallback chain folded from the live signals (web
 * `live.version || live.swUpdateVersion || state.software_version || '\u2014'`), and the PII-safe
 * `view.opened` diagnostic with the widget slug.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleHeroWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : VehicleHeroWidgetSource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())
        val stateEmissions = mutableMapOf<Long, List<Resource<VehicleStateEnvelope>>>()
        val liveEmissions = mutableMapOf<Long, List<LiveFirmware>>()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
            flow { (stateEmissions[vehicleId] ?: listOf(loadingState())).forEach { emit(it) } }

        override fun liveFirmware(vehicleId: Long): Flow<LiveFirmware> =
            flow { (liveEmissions[vehicleId] ?: listOf(LiveFirmware.Empty)).forEach { emit(it) } }
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
    fun contentWhenFirstVehicleResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState(batteryLevel = 72)), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertEquals(5L, state.data?.vehicle?.id)
            assertEquals(72L, state.data?.state?.batteryLevel)
        }

    @Test
    fun loadingWhileFirstVehicleStateLoads() =
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
            src.stateEmissions[9] = listOf(Resource.Success(envelope(vehicleState(batteryLevel = 33)), 100L, false))
            val vm = viewModel(src, vehicleId = 9)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(9L, state.data?.vehicle?.id)
            assertEquals(33L, state.data?.state?.batteryLevel)
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
            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(5L, state.data?.vehicle?.id)
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
    fun stateErrorKeepsHeroVisibleNeverHardError() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(loadingState(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            // A failed state fetch (no cache) must NOT blank the hero to a hard error: the resolved vehicle
            // keeps the surface in Content (asleep header + freshness error chip), exactly as the web widget
            // passes `isError` to the freshness header but never the blocking `error` chrome.
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(5L, state.data?.vehicle?.id)
            assertNull(state.data?.state)
            assertTrue(state.stale)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedStateWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState(batteryLevel = 64)), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.stateEmissions[5] = listOf(Resource.Error(envelope(vehicleState(batteryLevel = 64)), 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertEquals(ErrorKind.Timeout, state.errorKind)
            assertEquals(64L, state.data?.state?.batteryLevel)
        }

    @Test
    fun refreshReFetchesUpdatedState() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState(batteryLevel = 40)), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = vm.state.value
            assertEquals(40L, before.data?.state?.batteryLevel)

            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState(batteryLevel = 88)), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            val after = vm.state.value
            assertEquals(88L, after.data?.state?.batteryLevel)
            assertEquals(200L, after.fetchedAt)
        }

    @Test
    fun firmwareUsesStateSoftwareVersionWhenLiveBlank() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState(softwareVersion = "2025.1.0")), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val state = vm.state.value
            assertEquals("2025.1.0", state.data?.firmwareVersion)
        }

    @Test
    fun liveFirmwareOverridesStateSoftwareVersion() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.stateEmissions[5] = listOf(Resource.Success(envelope(vehicleState(softwareVersion = "2025.1.0")), 100L, false))
            src.liveEmissions[5] = listOf(LiveFirmware(version = "2025.20.5", swUpdateVersion = ""))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val state = vm.state.value
            assertEquals("2025.20.5", state.data?.firmwareVersion)
        }

    @Test
    fun recordViewOpenedEmitsWidgetSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "VehicleHeroWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsPiiFreeDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "vehicleHeroWidget.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("battery") })
            assertFalse(logger.events.any { it.second.containsKey("firmware") })
        }

    private fun TestScope.viewModel(
        source: VehicleHeroWidgetSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): VehicleHeroWidgetViewModel = VehicleHeroWidgetViewModel(source, logger, vehicleId, backgroundScope)

    private companion object {
        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingState(): Resource<VehicleStateEnvelope> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

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
                model = "Model 3",
                trimLevel = "Long Range",
            )

        fun vehicleState(
            batteryLevel: Long = 72,
            softwareVersion: String = "2025.1.0",
        ): VehicleState =
            VehicleState(
                batteryLevel = batteryLevel,
                chargeRate = 0.0,
                chargerPower = 11.0,
                idealRange = 402_336.0,
                insideTemp = 21.0,
                isCharging = false,
                isClimateOn = false,
                isLocked = true,
                latitude = 0.0,
                longitude = 0.0,
                odometer = 0.0,
                outsideTemp = 9.0,
                power = 0.0,
                ratedRange = 402_336.0,
                sentryMode = false,
                softwareVersion = softwareVersion,
                speed = 0.0,
                state = "online",
                timeToFullCharge = 0.0,
                vehicleId = 5,
            )
    }
}
