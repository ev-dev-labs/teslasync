package io.teslasync.android.featureviews.autopilotsection

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [AutopilotSectionViewModel] over a fake [AutopilotSectionSource], plus the
 * [autopilotSnapshotResource] cache-then-network adapter directly — covering every state the surface renders
 * (loading / content / empty / hard error / offline-cached), the active-vehicle resolution (preferred id vs.
 * first enrolled), the refresh + retry re-fetch, and the one-shot `view.opened` diagnostic. Run by the offline
 * `:app:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AutopilotSectionViewModelTest {
    // ── ViewModel: state projection ───────────────────────────────────────────────
    @Test
    fun loadsContentFromVehicleStateSpeed() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(successVehicles(listOf(vehicle(1)))),
                    state = listOf(loadingState(), successState(env(10.0))),
                )
            val vm = AutopilotSectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(10.0, ui.data!!.speedMps!!, 1e-9)
        }

    @Test
    fun noReadingsIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(successVehicles(listOf(vehicle(1)))),
                    state = listOf(successState(env(null))),
                )
            val vm = AutopilotSectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun stateLoadingWithNoCacheIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(successVehicles(listOf(vehicle(1)))),
                    state = listOf(loadingState()),
                )
            val vm = AutopilotSectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(successVehicles(listOf(vehicle(1)))),
                    state = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val vm = AutopilotSectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedSnapshotWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(successVehicles(listOf(vehicle(1)))),
                    state =
                        listOf(
                            Resource.Error(cached = env(10.0), fetchedAt = 100L, stale = true, error = ApiError.Network()),
                        ),
                )
            val vm = AutopilotSectionViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(10.0, ui.data!!.speedMps!!, 1e-9)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    @Test
    fun preferredVehicleIdBypassesFleet() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(successVehicles(emptyList())),
                    state = listOf(successState(env(10.0))),
                )
            val vm = AutopilotSectionViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    // ── ViewModel: refresh / retry / telemetry ───────────────────────────────────
    @Test
    fun refreshReCollectsStateAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(vehicles = emptyList(), state = listOf(successState(env(10.0))))
            val vm = AutopilotSectionViewModel(source, logger, backgroundScope, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.stateCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.stateCalls > before)
            assertTrue(logger.records.any { it.event == "autopilotSection.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = emptyList(), state = listOf(successState(env(10.0))))
            val vm = AutopilotSectionViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 4L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.stateCalls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.stateCalls > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSurfaceSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = AutopilotSectionViewModel(FakeSource(emptyList(), emptyList()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("AutopilotSection", opened.first().fields["surface"])
        }

    // ── adapter: cache-then-network composition ──────────────────────────────────
    @Test
    fun adapterPreferredIdStreamsFeedsDirectly() =
        runTest {
            val result =
                autopilotSnapshotResource(
                    vehicles = flowOf(successVehicles(emptyList())),
                    preferredVehicleId = 2L,
                    stateFor = { flowOf(successState(env(10.0))) },
                    cruiseFor = { flowOf(emptyObs()) },
                    followFor = { flowOf(emptyObs()) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(10.0, result.cached!!.speedMps!!, 1e-9)
        }

    @Test
    fun adapterResolvesFirstVehicle() =
        runTest {
            val result =
                autopilotSnapshotResource(
                    vehicles = flowOf(successVehicles(listOf(vehicle(7)))),
                    preferredVehicleId = null,
                    stateFor = { flowOf(successState(env(20.0))) },
                    cruiseFor = { flowOf(emptyObs()) },
                    followFor = { flowOf(emptyObs()) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(20.0, result.cached!!.speedMps!!, 1e-9)
        }

    @Test
    fun adapterEmitsNoReadingSnapshotWhenFleetEmpty() =
        runTest {
            val result =
                autopilotSnapshotResource(
                    vehicles = flowOf(successVehicles(emptyList())),
                    preferredVehicleId = null,
                    stateFor = { flowOf(successState(env(10.0))) },
                    cruiseFor = { flowOf(emptyObs()) },
                    followFor = { flowOf(emptyObs()) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertFalse(result.cached!!.hasAny)
        }

    @Test
    fun adapterStaysLoadingWhileFleetLoads() =
        runTest {
            val result =
                autopilotSnapshotResource(
                    vehicles = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    preferredVehicleId = null,
                    stateFor = { flowOf(successState(env(10.0))) },
                    cruiseFor = { flowOf(emptyObs()) },
                    followFor = { flowOf(emptyObs()) },
                ).toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterPropagatesFleetErrorWhenNoVehicle() =
        runTest {
            val result =
                autopilotSnapshotResource(
                    vehicles = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    preferredVehicleId = null,
                    stateFor = { flowOf(successState(env(10.0))) },
                    cruiseFor = { flowOf(emptyObs()) },
                    followFor = { flowOf(emptyObs()) },
                ).toList().last()
            assertTrue(result is Resource.Error)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val vehicles: List<Resource<List<Vehicle>>>,
        private val state: List<Resource<VehicleStateEnvelope>>,
        private val cruise: List<Resource<List<SignalObservation>>> = listOf(emptyObs()),
        private val follow: List<Resource<List<SignalObservation>>> = listOf(emptyObs()),
    ) : AutopilotSectionSource {
        var stateCalls = 0
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.asFlow()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> {
            stateCalls++
            return state.asFlow()
        }

        override fun cruiseSetSpeed(vehicleId: Long): Flow<Resource<List<SignalObservation>>> = cruise.asFlow()

        override fun followDistance(vehicleId: Long): Flow<Resource<List<SignalObservation>>> = follow.asFlow()
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }

    private companion object {
        fun successVehicles(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

        fun successState(envelope: VehicleStateEnvelope): Resource<VehicleStateEnvelope> =
            Resource.Success(envelope, fetchedAt = 100L, stale = false)

        fun loadingState(): Resource<VehicleStateEnvelope> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun emptyObs(): Resource<List<SignalObservation>> = Resource.Success(emptyList(), fetchedAt = 100L, stale = false)

        fun env(speed: Double?): VehicleStateEnvelope = VehicleStateEnvelope(state = speed?.let { vehicleState(it) }, live = false)

        fun vehicleState(speed: Double): VehicleState =
            VehicleState(
                batteryLevel = 80,
                chargeRate = 0.0,
                chargerPower = 0.0,
                idealRange = 0.0,
                insideTemp = 21.0,
                isCharging = false,
                isClimateOn = false,
                isLocked = true,
                latitude = 0.0,
                longitude = 0.0,
                odometer = 0.0,
                outsideTemp = 15.0,
                power = 0.0,
                ratedRange = 0.0,
                sentryMode = false,
                softwareVersion = "2025.0",
                speed = speed,
                state = "online",
                timeToFullCharge = 0.0,
                vehicleId = 1L,
            )

        fun vehicle(id: Long): Vehicle =
            Vehicle(
                createdAt = Instant.parse("2026-01-01T00:00:00Z"),
                displayName = "Car $id",
                enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
                id = id,
                teslaId = 1000 + id,
                timezone = "UTC",
                updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
                vin = "VIN$id",
            )
    }
}
