package io.teslasync.android.dashboard.widgets.safetyfeatures

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

/**
 * Tests [SafetyFeaturesWidgetViewModel] against the [SafetyFeaturesSource] seam with a fake feed, plus the
 * [safetyFeaturesResource] cache-then-network adapter directly — covering every state the web widget
 * renders (loading / content / empty / hard error / offline-cached), the active-vehicle resolution
 * (preferred id vs. first enrolled), the refresh + retry re-fetch, and the one-shot `view.opened` event.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SafetyFeaturesWidgetViewModelTest {
    // ── ViewModel: state projection ───────────────────────────────────────────────
    @Test
    fun loadsContentFromFirstVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    safety =
                        listOf(
                            Resource.Loading(cached = null, fetchedAt = null, stale = false),
                            successJson(safetyObject()),
                        ),
                )
            val vm = SafetyFeaturesWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data is JsonObject)
        }

    @Test
    fun noSafetyObjectIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    safety = listOf(successJson(JsonNull)),
                )
            val vm = SafetyFeaturesWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyFleetIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = listOf(success(emptyList())), safety = emptyList())
            val vm = SafetyFeaturesWidgetViewModel(source, RecordingLogger(), backgroundScope)
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
                    safety = emptyList(),
                )
            val vm = SafetyFeaturesWidgetViewModel(source, RecordingLogger(), backgroundScope)
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
                    safety = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val vm = SafetyFeaturesWidgetViewModel(source, RecordingLogger(), backgroundScope)
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
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    safety =
                        listOf(
                            Resource.Error(
                                cached = safetyObject(),
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                )
            val vm = SafetyFeaturesWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data is JsonObject)
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
                    safety = listOf(successJson(safetyObject())),
                )
            val vm = SafetyFeaturesWidgetViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    // ── ViewModel: refresh / retry / telemetry ───────────────────────────────────
    @Test
    fun refreshReCollectsSafetyAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(vehicles = emptyList(), safety = listOf(successJson(safetyObject())))
            val vm = SafetyFeaturesWidgetViewModel(source, logger, backgroundScope, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.safetyCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.safetyCalls > before)
            assertTrue(logger.records.any { it.event == "safetyFeatures.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = emptyList(), safety = listOf(successJson(safetyObject())))
            val vm = SafetyFeaturesWidgetViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 4L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.safetyCalls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.safetyCalls > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = SafetyFeaturesWidgetViewModel(FakeSource(emptyList(), emptyList()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("SafetyFeaturesWidget", opened.first().fields["slug"])
        }

    // ── adapter: cache-then-network composition ──────────────────────────────────
    @Test
    fun adapterPreferredIdStreamsSafetyDirectly() =
        runTest {
            val result =
                safetyFeaturesResource(
                    vehicles = flowOf(success(emptyList())),
                    preferredVehicleId = 2L,
                    safetyFor = { flowOf(successJson(safetyObject())) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached is JsonObject)
        }

    @Test
    fun adapterResolvesFirstVehicleForSafety() =
        runTest {
            val result =
                safetyFeaturesResource(
                    vehicles = flowOf(success(listOf(vehicle(7)))),
                    preferredVehicleId = null,
                    safetyFor = { id -> flowOf(successJson(buildJsonObject { put("vehicle_id", id) })) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(7L, (result.cached as JsonObject)["vehicle_id"].toString().toLong())
        }

    @Test
    fun adapterEmitsNoVehicleSafetyWhenFleetEmpty() =
        runTest {
            val result =
                safetyFeaturesResource(
                    vehicles = flowOf(success(emptyList())),
                    preferredVehicleId = null,
                    safetyFor = { flowOf(successJson(safetyObject())) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(JsonNull, result.cached)
        }

    @Test
    fun adapterStaysLoadingWhileFleetLoads() =
        runTest {
            val result =
                safetyFeaturesResource(
                    vehicles = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    preferredVehicleId = null,
                    safetyFor = { flowOf(successJson(safetyObject())) },
                ).toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterPropagatesFleetErrorWhenNoVehicle() =
        runTest {
            val result =
                safetyFeaturesResource(
                    vehicles = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    preferredVehicleId = null,
                    safetyFor = { flowOf(successJson(safetyObject())) },
                ).toList().last()
            assertTrue(result is Resource.Error)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val vehicles: List<Resource<List<Vehicle>>>,
        private val safety: List<Resource<JsonElement>>,
    ) : SafetyFeaturesSource {
        var safetyCalls = 0
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.asFlow()

        override fun safety(vehicleId: Long): Flow<Resource<JsonElement>> {
            safetyCalls++
            return safety.asFlow()
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

    private fun successJson(json: JsonElement): Resource<JsonElement> = Resource.Success(json, fetchedAt = 100L, stale = false)

    private fun safetyObject(): JsonObject =
        buildJsonObject {
            put("forward_collision_warning", "ForwardCollisionSensitivityMedium")
            put("automatic_emergency_braking_off", false)
            put("cruise_follow_distance", "FollowDistance3")
        }

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
