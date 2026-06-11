package io.teslasync.android.dashboardwidgets.batteryradialgauge

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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Tests [BatteryRadialGaugeWidgetViewModel] against the [BatteryRadialGaugeSource] seam with a fake feed,
 * plus the [batteryRadialGaugeResource] cache-then-network adapter directly — covering every state the web
 * widget renders (loading / content / empty / hard error / offline-cached), the active-vehicle resolution
 * (preferred id vs. first enrolled), the refresh + retry re-fetch, and the one-shot `view.opened` event.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BatteryRadialGaugeWidgetViewModelTest {
    // ── ViewModel: state projection ───────────────────────────────────────────────
    @Test
    fun loadsContentFromFirstVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    state =
                        listOf(
                            Resource.Loading(cached = null, fetchedAt = null, stale = false),
                            success(envelope(state(72, charging = false))),
                        ),
                )
            val vm = BatteryRadialGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(72L, ui.data?.state?.batteryLevel)
        }

    @Test
    fun noDecodableStateIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    state = listOf(success(envelope(null))),
                )
            val vm = BatteryRadialGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Empty, ui.phase)
            assertNull(ui.data?.state)
        }

    @Test
    fun emptyFleetIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = listOf(success(emptyList())), state = emptyList())
            val vm = BatteryRadialGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope)
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
                    state = emptyList(),
                )
            val vm = BatteryRadialGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    state = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val vm = BatteryRadialGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedStateWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    state =
                        listOf(
                            Resource.Error(
                                cached = envelope(state(50, charging = false)),
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                )
            val vm = BatteryRadialGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(50L, ui.data?.state?.batteryLevel)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    @Test
    fun preferredVehicleIdBypassesFleet() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(emptyList())),
                    state = listOf(success(envelope(state(33, charging = false)))),
                )
            val vm = BatteryRadialGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(33L, ui.data?.state?.batteryLevel)
        }

    // ── ViewModel: refresh / retry / telemetry ───────────────────────────────────
    @Test
    fun refreshReFetchesPreferredVehicleAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(vehicles = emptyList(), state = listOf(success(envelope(state(20, charging = false)))))
            val vm = BatteryRadialGaugeWidgetViewModel(source, logger, backgroundScope, vehicleId = 2L)

            vm.refresh()
            advanceUntilIdle()

            assertEquals(2L, source.refreshedId)
            assertEquals(1, source.refreshCount)
            assertTrue(logger.records.any { it.event == "batteryRadialGauge.refresh" })
        }

    @Test
    fun refreshResolvesFirstVehicleWhenNoPreferredId() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = listOf(success(listOf(vehicle(7)))), state = emptyList())
            val vm = BatteryRadialGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope)

            vm.refresh()
            advanceUntilIdle()

            assertEquals(7L, source.refreshedId)
        }

    @Test
    fun retryAlsoReFetches() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = emptyList(), state = emptyList())
            val vm = BatteryRadialGaugeWidgetViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 4L)

            vm.retry()
            advanceUntilIdle()

            assertEquals(4L, source.refreshedId)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = BatteryRadialGaugeWidgetViewModel(FakeSource(emptyList(), emptyList()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("BatteryRadialGaugeWidget", opened.first().fields["slug"])
        }

    // ── adapter: cache-then-network composition ──────────────────────────────────
    @Test
    fun adapterPreferredIdStreamsStateDirectly() =
        runTest {
            val result =
                batteryRadialGaugeResource(
                    vehicles = flowOf(success(emptyList())),
                    preferredVehicleId = 2L,
                    stateFor = { flowOf(success(envelope(state(33, charging = false)))) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(33L, result.cached?.state?.batteryLevel)
        }

    @Test
    fun adapterResolvesFirstVehicleForState() =
        runTest {
            val result =
                batteryRadialGaugeResource(
                    vehicles = flowOf(success(listOf(vehicle(7)))),
                    preferredVehicleId = null,
                    stateFor = { id -> flowOf(success(envelope(state(if (id == 7L) 40 else 0, charging = false)))) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(40L, result.cached?.state?.batteryLevel)
        }

    @Test
    fun adapterEmitsNoVehicleEnvelopeWhenFleetEmpty() =
        runTest {
            val result =
                batteryRadialGaugeResource(
                    vehicles = flowOf(success(emptyList())),
                    preferredVehicleId = null,
                    stateFor = { flowOf(success(envelope(state(1, charging = false)))) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertNull(result.cached?.state)
        }

    @Test
    fun adapterStaysLoadingWhileFleetLoads() =
        runTest {
            val result =
                batteryRadialGaugeResource(
                    vehicles = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    preferredVehicleId = null,
                    stateFor = { flowOf(success(envelope(state(1, charging = false)))) },
                ).toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterPropagatesFleetErrorWhenNoVehicle() =
        runTest {
            val result =
                batteryRadialGaugeResource(
                    vehicles = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    preferredVehicleId = null,
                    stateFor = { flowOf(success(envelope(state(1, charging = false)))) },
                ).toList().last()
            assertTrue(result is Resource.Error)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val vehicles: List<Resource<List<Vehicle>>>,
        private val state: List<Resource<VehicleStateEnvelope>>,
    ) : BatteryRadialGaugeSource {
        var refreshedId: Long? = null
            private set
        var refreshCount = 0
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.asFlow()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = state.asFlow()

        override suspend fun refresh(vehicleId: Long) {
            refreshedId = vehicleId
            refreshCount++
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

    private fun success(envelope: VehicleStateEnvelope): Resource<VehicleStateEnvelope> =
        Resource.Success(envelope, fetchedAt = 100L, stale = false)

    private fun envelope(state: VehicleState?): VehicleStateEnvelope = VehicleStateEnvelope(state = state, live = false)

    private fun state(
        level: Long,
        charging: Boolean,
    ): VehicleState =
        VehicleState(
            batteryLevel = level,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 21.0,
            isCharging = charging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 15.0,
            power = 0.0,
            ratedRange = 350.0,
            sentryMode = false,
            softwareVersion = "2024.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1L,
        )

    private fun vehicle(id: Long): Vehicle =
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
