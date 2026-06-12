package io.teslasync.android.featureviews.batterycomparison

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
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
 * Drives [BatteryComparisonViewModel] over a fake [BatteryComparisonSource], plus the
 * [batteryComparisonResource] cache-then-network adapter directly — covering every state the web component's
 * aggregating `useQuery` produces (loading / content / empty / hard error / offline-cached), the per-vehicle
 * graceful degradation (a failed/absent state drops that bar, web `bars` filter), the refresh + retry
 * re-fetch, and the one-shot `view.opened` diagnostic. Run by the offline `:android:testReleaseUnitTest` gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BatteryComparisonViewModelTest {
    // ── ViewModel: state projection ───────────────────────────────────────────────
    @Test
    fun loadsContentRowsFromFleetStates() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1), vehicle(2)))),
                    states =
                        mapOf(
                            1L to
                                listOf(
                                    Resource.Loading(cached = null, fetchedAt = null, stale = false),
                                    successEnvelope(vehicleState(80)),
                                ),
                            2L to listOf(successEnvelope(vehicleState(20))),
                        ),
                )
            val vm = BatteryComparisonViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(listOf(1L, 2L), ui.data?.map { it.vehicleId })
        }

    @Test
    fun emptyFleetIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = listOf(success(emptyList())), states = emptyMap())
            val vm = BatteryComparisonViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun fleetLoadingIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    states = emptyMap(),
                )
            val vm = BatteryComparisonViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun everyVehicleOfflineIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    states = mapOf(1L to listOf(successEnvelope(state = null))),
                )
            val vm = BatteryComparisonViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun firstLoadWhileStatesPendingIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    states = mapOf(1L to listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false))),
                )
            val vm = BatteryComparisonViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWhenFleetFailsWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    states = emptyMap(),
                )
            val vm = BatteryComparisonViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedRowsWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    states =
                        mapOf(
                            1L to
                                listOf(
                                    Resource.Error(
                                        cached = VehicleStateEnvelope(vehicleState(55), live = true),
                                        fetchedAt = 100L,
                                        stale = true,
                                        error = ApiError.Network(),
                                    ),
                                ),
                        ),
                )
            val vm = BatteryComparisonViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(1, ui.data?.size)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    // ── ViewModel: refresh / retry / telemetry ───────────────────────────────────
    @Test
    fun refreshReCollectsStatesAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    states = mapOf(1L to listOf(successEnvelope(vehicleState(70)))),
                )
            val vm = BatteryComparisonViewModel(source, logger, backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.stateCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.stateCalls > before)
            assertTrue(logger.records.any { it.event == "batteryComparison.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    states = mapOf(1L to listOf(successEnvelope(vehicleState(70)))),
                )
            val vm = BatteryComparisonViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.stateCalls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.stateCalls > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = BatteryComparisonViewModel(FakeSource(emptyList(), emptyMap()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("BatteryComparison", opened.first().fields["surface"])
        }

    // ── adapter: cache-then-network composition ──────────────────────────────────
    @Test
    fun adapterEmptyFleetIsEmptySuccess() =
        runTest {
            val result =
                batteryComparisonResource(
                    vehicles = flowOf(success(emptyList())),
                    stateFor = { flowOf(successEnvelope(vehicleState(50))) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached!!.isEmpty())
        }

    @Test
    fun adapterResolvesRowsForFleet() =
        runTest {
            val result =
                batteryComparisonResource(
                    vehicles = flowOf(success(listOf(vehicle(1), vehicle(2)))),
                    stateFor = { id -> flowOf(successEnvelope(vehicleState(batteryLevel = 60, vehicleId = id))) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(listOf(1L, 2L), result.cached!!.map { it.vehicleId })
        }

    @Test
    fun adapterFiltersVehiclesWithNoState() =
        runTest {
            val result =
                batteryComparisonResource(
                    vehicles = flowOf(success(listOf(vehicle(1), vehicle(2)))),
                    stateFor = { id -> flowOf(successEnvelope(if (id == 1L) vehicleState(40) else null)) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(listOf(1L), result.cached!!.map { it.vehicleId })
        }

    @Test
    fun adapterStaysLoadingWhileFleetLoadsWithNoCache() =
        runTest {
            val result =
                batteryComparisonResource(
                    vehicles = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    stateFor = { flowOf(successEnvelope(vehicleState(50))) },
                ).toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterPropagatesFleetErrorWhenNoCache() =
        runTest {
            val result =
                batteryComparisonResource(
                    vehicles = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    stateFor = { flowOf(successEnvelope(vehicleState(50))) },
                ).toList().last()
            assertTrue(result is Resource.Error)
            assertEquals(null, result.cached)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val vehicles: List<Resource<List<Vehicle>>>,
        private val states: Map<Long, List<Resource<VehicleStateEnvelope>>>,
    ) : BatteryComparisonSource {
        var stateCalls = 0
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.asFlow()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> {
            stateCalls++
            val emissions = states[vehicleId] ?: listOf(Resource.Success(VehicleStateEnvelope(null, live = false), 100L, false))
            return emissions.asFlow()
        }
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

    private fun success(vehicles: List<Vehicle>): Resource<List<Vehicle>> = Resource.Success(vehicles, fetchedAt = 100L, stale = false)

    private fun successEnvelope(state: VehicleState?): Resource<VehicleStateEnvelope> =
        Resource.Success(VehicleStateEnvelope(state, live = false), fetchedAt = 100L, stale = false)

    private fun vehicleState(
        batteryLevel: Long,
        ratedRange: Double = 300_000.0,
        vehicleId: Long = 1L,
    ): VehicleState =
        VehicleState(
            batteryLevel = batteryLevel,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = ratedRange,
            insideTemp = 20.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 15.0,
            power = 0.0,
            ratedRange = ratedRange,
            sentryMode = false,
            softwareVersion = "2026.4.1",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = vehicleId,
        )

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:00:00Z"),
            vin = "VIN$id",
        )
}
