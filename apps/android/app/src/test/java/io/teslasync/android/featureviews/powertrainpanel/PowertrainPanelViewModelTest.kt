// Drives [PowertrainPanelViewModel] over a fake [PowertrainPanelSource], plus the [powertrainPanelResource]
// cache-then-network adapter directly — covering every state the web component renders from its host-resolved
// `useMotorLatest` snapshot (loading / content / empty / hard error / offline-cached), the first-vehicle
// fallback when no prop id is supplied, the present-but-empty-object → content gate (the web truthy-object
// branch), the refresh + retry re-fetch, and the one-shot `view.opened` diagnostic. Run by the offline
// `:android:testReleaseUnitTest` gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.powertrainpanel

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class PowertrainPanelViewModelTest {
    // ── ViewModel: state projection ───────────────────────────────────────────────
    @Test
    fun loadsContentFromPositiveVehicleWithoutConsultingFleet() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = emptyList(),
                    motor =
                        listOf(
                            Resource.Loading(cached = null, fetchedAt = null, stale = false),
                            successJson(motorObject()),
                        ),
                )
            val vm = PowertrainPanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data is JsonObject)
            assertEquals(0, source.vehiclesCalls)
        }

    @Test
    fun positiveVehicleWithNullSnapshotRendersEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = emptyList(), motor = listOf(successJson(JsonNull)))
            val vm = PowertrainPanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun presentEmptyObjectIsContentNotEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            // The web gate is `motorData ? … : <EmptyState/>` — a present (even empty) object renders content.
            val source = FakeSource(vehicles = emptyList(), motor = listOf(successJson(buildJsonObject {})))
            val vm = PowertrainPanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun missingVehicleIdFallsBackToFirstEnrolledVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(vehiclesJson(2L)),
                    motor = listOf(successJson(motorObject())),
                )
            val vm = PowertrainPanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = null)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertTrue(source.vehiclesCalls > 0)
            assertTrue(source.motorCalls > 0)
        }

    @Test
    fun missingVehicleIdWithNoFleetRendersEmptyNotLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = listOf(vehiclesJson()), motor = emptyList())
            val vm = PowertrainPanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = null)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
            assertEquals(0, source.motorCalls)
        }

    @Test
    fun feedLoadingIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = emptyList(),
                    motor = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                )
            val vm = PowertrainPanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = emptyList(),
                    motor = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val vm = PowertrainPanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 1L)
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
                    vehicles = emptyList(),
                    motor =
                        listOf(
                            Resource.Error(cached = motorObject(), fetchedAt = 100L, stale = true, error = ApiError.Network()),
                        ),
                )
            val vm = PowertrainPanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data is JsonObject)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    // ── ViewModel: refresh / retry / telemetry ───────────────────────────────────
    @Test
    fun refreshReCollectsAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(vehicles = emptyList(), motor = listOf(successJson(motorObject())))
            val vm = PowertrainPanelViewModel(source, logger, backgroundScope, vehicleId = 1L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.motorCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.motorCalls > before)
            assertTrue(logger.records.any { it.event == "powertrainPanel.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = emptyList(), motor = listOf(successJson(motorObject())))
            val vm = PowertrainPanelViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 3L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.motorCalls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.motorCalls > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSurfaceSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = PowertrainPanelViewModel(FakeSource(emptyList(), emptyList()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("PowertrainPanel", opened.first().fields["surface"])
        }

    // ── adapter: cache-then-network composition ──────────────────────────────────
    @Test
    fun adapterPositiveIdStreamsMotorDirectly() =
        runTest {
            val result =
                powertrainPanelResource(
                    vehicles = flowOf(Resource.Success(emptyList(), fetchedAt = 1L, stale = false)),
                    preferredVehicleId = 1L,
                    motorFor = { flowOf(successJson(motorObject())) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached is JsonObject)
        }

    @Test
    fun adapterFallsBackToFirstVehicleWhenIdMissing() =
        runTest {
            val result =
                powertrainPanelResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(2L)), fetchedAt = 1L, stale = false)),
                    preferredVehicleId = null,
                    motorFor = { id -> flowOf(successJson(buildJsonObject { put("vehicle", id) })) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached is JsonObject)
        }

    @Test
    fun adapterEmitsNoVehicleSnapshotWhenFleetEmpty() =
        runTest {
            val result =
                powertrainPanelResource(
                    vehicles = flowOf(Resource.Success(emptyList(), fetchedAt = 1L, stale = false)),
                    preferredVehicleId = null,
                    motorFor = { flowOf(successJson(motorObject())) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(JsonNull, result.cached)
        }

    @Test
    fun adapterEmitsNoVehicleSnapshotWhenIdNonPositive() =
        runTest {
            val result =
                powertrainPanelResource(
                    vehicles = flowOf(Resource.Success(emptyList(), fetchedAt = 1L, stale = false)),
                    preferredVehicleId = 0L,
                    motorFor = { flowOf(successJson(motorObject())) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(JsonNull, result.cached)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    // The call counters increment on collection (`onStart`), not on method invocation — so a positive
    // prop id (which builds but never collects the vehicles flow) reads as zero fleet consultations.
    private class FakeSource(
        private val vehicles: List<Resource<List<Vehicle>>>,
        private val motor: List<Resource<JsonElement>>,
    ) : PowertrainPanelSource {
        var vehiclesCalls = 0
            private set
        var motorCalls = 0
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.asFlow().onStart { vehiclesCalls++ }

        override fun motor(vehicleId: Long): Flow<Resource<JsonElement>> = motor.asFlow().onStart { motorCalls++ }
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

    private fun successJson(json: JsonElement): Resource<JsonElement> = Resource.Success(json, fetchedAt = 100L, stale = false)

    private fun vehiclesJson(vararg ids: Long): Resource<List<Vehicle>> =
        Resource.Success(ids.map { vehicle(it) }, fetchedAt = 100L, stale = false)

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

    private fun motorObject(): JsonObject =
        buildJsonObject {
            put("shift_state", "D")
            put("power_kw", 150.5)
            put("motor_rpm_front", 4200.0)
        }
}
