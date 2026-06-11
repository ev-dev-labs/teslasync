package io.teslasync.android.dashboard.widgets.climatestatus

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
 * Tests [ClimateStatusWidgetViewModel] against the [ClimateStatusSource] seam with a fake feed, plus the
 * [climateStatusResource] cache-then-network adapter directly — covering every state the web widget
 * renders (loading / content / empty / hard error / offline-cached), the active-vehicle resolution
 * (preferred id vs. first enrolled), the refresh + retry re-fetch, and the one-shot `view.opened` event.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ClimateStatusWidgetViewModelTest {
    // ── ViewModel: state projection ───────────────────────────────────────────────
    @Test
    fun loadsContentFromFirstVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    climate =
                        listOf(
                            Resource.Loading(cached = null, fetchedAt = null, stale = false),
                            successJson(climateObject()),
                        ),
                )
            val vm = ClimateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertTrue(ui.data is JsonObject)
        }

    @Test
    fun noClimateObjectIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    vehicles = listOf(success(listOf(vehicle(1)))),
                    climate = listOf(successJson(JsonNull)),
                )
            val vm = ClimateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyFleetIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = listOf(success(emptyList())), climate = emptyList())
            val vm = ClimateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
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
                    climate = emptyList(),
                )
            val vm = ClimateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
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
                    climate = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val vm = ClimateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
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
                    climate =
                        listOf(
                            Resource.Error(
                                cached = climateObject(),
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                )
            val vm = ClimateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope)
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
                    climate = listOf(successJson(climateObject())),
                )
            val vm = ClimateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    // ── ViewModel: refresh / retry / telemetry ───────────────────────────────────
    @Test
    fun refreshReCollectsClimateAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(vehicles = emptyList(), climate = listOf(successJson(climateObject())))
            val vm = ClimateStatusWidgetViewModel(source, logger, backgroundScope, vehicleId = 2L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.climateCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.climateCalls > before)
            assertTrue(logger.records.any { it.event == "climateStatus.refresh" })
        }

    @Test
    fun retryAlsoReCollects() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(vehicles = emptyList(), climate = listOf(successJson(climateObject())))
            val vm = ClimateStatusWidgetViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 4L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.climateCalls

            vm.retry()
            advanceUntilIdle()

            assertTrue(source.climateCalls > before)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = ClimateStatusWidgetViewModel(FakeSource(emptyList(), emptyList()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("ClimateStatusWidget", opened.first().fields["slug"])
        }

    // ── adapter: cache-then-network composition ──────────────────────────────────
    @Test
    fun adapterPreferredIdStreamsClimateDirectly() =
        runTest {
            val result =
                climateStatusResource(
                    vehicles = flowOf(success(emptyList())),
                    preferredVehicleId = 2L,
                    climateFor = { flowOf(successJson(climateObject())) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertTrue(result.cached is JsonObject)
        }

    @Test
    fun adapterResolvesFirstVehicleForClimate() =
        runTest {
            val result =
                climateStatusResource(
                    vehicles = flowOf(success(listOf(vehicle(7)))),
                    preferredVehicleId = null,
                    climateFor = { id -> flowOf(successJson(buildJsonObject { put("vehicle_id", id) })) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(7L, (result.cached as JsonObject)["vehicle_id"].toString().toLong())
        }

    @Test
    fun adapterEmitsNoVehicleClimateWhenFleetEmpty() =
        runTest {
            val result =
                climateStatusResource(
                    vehicles = flowOf(success(emptyList())),
                    preferredVehicleId = null,
                    climateFor = { flowOf(successJson(climateObject())) },
                ).toList().last()
            assertTrue(result is Resource.Success)
            assertEquals(JsonNull, result.cached)
        }

    @Test
    fun adapterStaysLoadingWhileFleetLoads() =
        runTest {
            val result =
                climateStatusResource(
                    vehicles = flowOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)),
                    preferredVehicleId = null,
                    climateFor = { flowOf(successJson(climateObject())) },
                ).toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterPropagatesFleetErrorWhenNoVehicle() =
        runTest {
            val result =
                climateStatusResource(
                    vehicles = flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                    preferredVehicleId = null,
                    climateFor = { flowOf(successJson(climateObject())) },
                ).toList().last()
            assertTrue(result is Resource.Error)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val vehicles: List<Resource<List<Vehicle>>>,
        private val climate: List<Resource<JsonElement>>,
    ) : ClimateStatusSource {
        var climateCalls = 0
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.asFlow()

        override fun climate(vehicleId: Long): Flow<Resource<JsonElement>> {
            climateCalls++
            return climate.asFlow()
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

    private fun climateObject(): JsonObject =
        buildJsonObject {
            put("inside_temp", 21.0)
            put("outside_temp", 14.0)
            put("hvac_power", 2.4)
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
