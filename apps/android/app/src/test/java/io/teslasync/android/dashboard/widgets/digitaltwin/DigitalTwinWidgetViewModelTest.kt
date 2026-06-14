package io.teslasync.android.dashboard.widgets.digitaltwin

import io.teslasync.android.data.ErrorKind
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
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [DigitalTwinWidgetViewModel] over a controllable fake [DigitalTwinSource], covering the
 * cache-then-network state matrix the web component renders (loading / content / empty / offline-cached),
 * the active-vehicle resolution (first enrolled vs. preferred prop id), the refresh + retry re-collection,
 * and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DigitalTwinWidgetViewModelTest {
    @Test
    fun loadsContentFromFirstVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertNotNull(ui.data?.vehicle)
            assertEquals("Car 1", ui.data?.vehicle?.label)
        }

    @Test
    fun emptyFleetIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(vehicles = listOf(success(emptyList<Vehicle>()))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun fleetLoadingIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(vehicles = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun coreFeedLoadingShowsLoadingEvenWithVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(state = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false))),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun preferredVehicleIdSelectsThatVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = listOf(success(listOf(car(1, "Car 1"), car(2, "Car 2")))))
            val vm = viewModel(source, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals(2L, source.lastStateVehicleId)
            assertEquals(
                "Car 2",
                vm.state.value.data
                    ?.vehicle
                    ?.label,
            )
        }

    @Test
    fun lockedTwinIsDecodedFromSecurity() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(security = listOf(success(buildJsonObject { put("locked", true) })))
            val vm = viewModel(source)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(
                true,
                vm.state.value.data
                    ?.twin
                    ?.locked,
            )
        }

    @Test
    fun offlineKeepsCachedTwinWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    security =
                        listOf(
                            Resource.Error(
                                cached = buildJsonObject { put("locked", false) },
                                fetchedAt = 50L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                )
            val vm = viewModel(source)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
            assertEquals(ErrorKind.Network, ui.errorKind)
            assertEquals(false, ui.data?.twin?.locked)
        }

    @Test
    fun refreshReCollectsAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource()
            val vm = viewModel(source, logger = logger)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.stateCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.stateCalls > before)
            assertTrue(logger.records.any { it.event == "digitalTwin.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.stateCalls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.stateCalls > before)
        }

    @Test
    fun viewOpenedEmitsSurfaceExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("DigitalTwinWidget", opened.single().fields["surface"])
        }

    @Test
    fun refreshDiagnosticCarriesNoVehiclePayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.records.any { it.event == "digitalTwin.refresh" })
            assertFalse(logger.records.any { it.fields.containsKey("vin") })
            assertFalse(logger.records.any { it.fields.containsKey("door_state") })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private class FakeSource(
        private val vehicles: List<Resource<List<Vehicle>>> = listOf(Resource.Success(listOf(car(1, "Car 1")), 100L, false)),
        private val state: List<Resource<VehicleStateEnvelope>> = listOf(Resource.Success(envelope(), 100L, false)),
        private val security: List<Resource<JsonElement>> = listOf(Resource.Success(JsonNull, 100L, false)),
        private val charging: List<Resource<JsonElement>> = listOf(Resource.Success(JsonNull, 100L, false)),
    ) : DigitalTwinSource {
        var stateCalls = 0
            private set
        var lastStateVehicleId: Long = -1
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.asFlow()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> {
            stateCalls++
            lastStateVehicleId = vehicleId
            return state.asFlow()
        }

        override fun security(vehicleId: Long): Flow<Resource<JsonElement>> = security.asFlow()

        override fun chargingTelemetry(vehicleId: Long): Flow<Resource<JsonElement>> = charging.asFlow()

        private companion object {
            fun envelope(): VehicleStateEnvelope = VehicleStateEnvelope(state = sampleState(), live = false)
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

    private fun TestScope.viewModel(
        source: DigitalTwinSource,
        logger: Logger = RecordingLogger(),
        vehicleId: Long? = null,
    ): DigitalTwinWidgetViewModel = DigitalTwinWidgetViewModel(source, logger, backgroundScope, vehicleId)

    private fun <T> success(
        value: T,
        at: Long = 100L,
    ): Resource<T> = Resource.Success(value, fetchedAt = at, stale = false)

    private companion object {
        fun car(
            id: Long,
            name: String,
        ): Vehicle =
            Vehicle(
                createdAt = Instant.parse("2026-01-01T00:00:00Z"),
                displayName = name,
                enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
                id = id,
                teslaId = 1000 + id,
                timezone = "UTC",
                updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
                vin = "VIN$id",
            )

        fun sampleState(): VehicleState =
            VehicleState(
                batteryLevel = 80,
                chargeRate = 0.0,
                chargerPower = 0.0,
                idealRange = 0.0,
                insideTemp = 20.0,
                isCharging = false,
                isClimateOn = false,
                isLocked = false,
                latitude = 0.0,
                longitude = 0.0,
                odometer = 0.0,
                outsideTemp = 15.0,
                power = 0.0,
                ratedRange = 0.0,
                sentryMode = false,
                softwareVersion = "2025.1",
                speed = 0.0,
                state = "online",
                timeToFullCharge = 0.0,
                vehicleId = 1,
            )
    }
}
