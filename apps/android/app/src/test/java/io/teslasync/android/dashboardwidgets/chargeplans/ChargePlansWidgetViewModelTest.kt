package io.teslasync.android.dashboardwidgets.chargeplans

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Tests [ChargePlansWidgetViewModel] against the [ChargePlansSource] seam with a fake feed — covering
 * every state the web widget renders (loading / content / empty / hard error / offline-cached), the
 * `vehicleId ?? vehicles[0].id` resolution and the `enabled: id > 0` lazy gate, the settings-derived
 * display prefs, the refresh re-fetch, and the one-shot `view.opened` diagnostics event.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargePlansWidgetViewModelTest {
    @Test
    fun loadsContentForFirstVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeChargePlansSource(
                    vehicles = listOf(success(vehiclesJson(1L))),
                    plans = listOf(success(plansJson(plan(1, "scheduled", 80)))),
                    rates = listOf(success(ratesJson(rate("EV2A", "EV2-A", "PG&E")))),
                )
            val vm = ChargePlansWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(1L, state.data?.activePlan?.id)
            assertEquals(1, state.data?.ratePlans?.size)
            assertEquals(1L, source.lastPlansVehicleId)
        }

    @Test
    fun emptyWhenNoPlansOrRates() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeChargePlansSource(
                    vehicles = listOf(success(vehiclesJson(1L))),
                    plans = listOf(success(JsonArray(emptyList()))),
                    rates = listOf(success(JsonArray(emptyList()))),
                )
            val vm = ChargePlansWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun noVehicleGatesPlansButStillLoadsRates() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeChargePlansSource(
                    vehicles = listOf(success(emptyList<Vehicle>())),
                    plans = listOf(success(plansJson(plan(9, "active", 50)))),
                    rates = listOf(success(ratesJson(rate("EV2A", "EV2-A", "PG&E")))),
                )
            val vm = ChargePlansWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            val data = state.data!!
            assertTrue(data.plans.isEmpty())
            assertEquals(1, data.ratePlans.size)
            // web `enabled: id > 0` → the plans feed is never queried when no vehicle resolves
            assertEquals(0, source.plansCalls)
        }

    @Test
    fun explicitVehicleIdOverridesFirstEnrolled() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeChargePlansSource(
                    vehicles = listOf(success(vehiclesJson(1L))),
                    plans = listOf(success(plansJson(plan(5, "active", 60)))),
                    rates = listOf(success(JsonArray(emptyList()))),
                )
            val vm = ChargePlansWidgetViewModel(source, RecordingLogger(), backgroundScope, explicitVehicleId = 5L)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(5L, source.lastPlansVehicleId)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeChargePlansSource(
                    vehicles = listOf(success(vehiclesJson(1L))),
                    plans = listOf(errorNoCache()),
                    rates = listOf(errorNoCache()),
                )
            val vm = ChargePlansWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertTrue(state.hasError)
            assertFalse(state.hasData)
        }

    @Test
    fun offlineKeepsCachedRatesWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeChargePlansSource(
                    vehicles = listOf(success(vehiclesJson(1L))),
                    plans = listOf(errorNoCache()),
                    rates =
                        listOf(
                            Resource.Error(
                                ratesJson(rate("EV2A", "EV2-A", "PG&E")),
                                fetchedAt = 100L,
                                stale = true,
                                error = ApiError.Network(),
                            ),
                        ),
                )
            val vm = ChargePlansWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(1, state.data!!.ratePlans.size)
        }

    @Test
    fun displayPrefsDeriveFromSettings() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeChargePlansSource(
                    vehicles = listOf(success(vehiclesJson(1L))),
                    plans = listOf(success(JsonArray(emptyList()))),
                    rates = listOf(success(JsonArray(emptyList()))),
                    settings =
                        listOf(
                            success(
                                buildJsonObject {
                                    put("currency_symbol", "\u20AC")
                                    put("decimal_precision", 3.0)
                                },
                            ),
                        ),
                )
            val vm = ChargePlansWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.displayPrefs.collect {} }
            advanceUntilIdle()

            assertEquals("\u20AC", vm.displayPrefs.value.currencySymbol)
            assertEquals(3, vm.displayPrefs.value.precision)
        }

    @Test
    fun refreshReFetchesAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeChargePlansSource(
                    vehicles = listOf(success(vehiclesJson(1L))),
                    plans = listOf(success(plansJson(plan(1, "active", 80)))),
                    rates = listOf(success(JsonArray(emptyList()))),
                )
            val logger = RecordingLogger()
            val vm = ChargePlansWidgetViewModel(source, logger, backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val ratesBefore = source.ratesCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue("rates re-fetched", source.ratesCalls > ratesBefore)
            assertTrue("vehicles re-fetched", source.vehiclesCalls >= 2)
            assertTrue(logger.records.any { it.event == "chargePlans.refresh" })
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeChargePlansSource()
            val vm = ChargePlansWidgetViewModel(source, logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("ChargePlansWidget", opened.first().fields["surface"])
        }

    // ── fakes + builders ───────────────────────────────────────────────────────────────────────
    private class FakeChargePlansSource(
        private val vehicles: List<Resource<List<Vehicle>>> = listOf(Resource.Success(emptyList(), 0L, false)),
        private val plans: List<Resource<JsonElement>> = listOf(Resource.Success(JsonArray(emptyList()), 0L, false)),
        private val rates: List<Resource<JsonElement>> = listOf(Resource.Success(JsonArray(emptyList()), 0L, false)),
        private val settings: List<Resource<JsonElement>> = listOf(Resource.Success(JsonObject(emptyMap()), 0L, false)),
    ) : ChargePlansSource {
        var vehiclesCalls = 0
            private set
        var plansCalls = 0
            private set
        var ratesCalls = 0
            private set
        var lastPlansVehicleId: Long? = null
            private set

        override fun vehicles(): Flow<Resource<List<Vehicle>>> =
            flow {
                vehiclesCalls++
                vehicles.forEach { emit(it) }
            }

        override fun chargePlans(vehicleId: Long): Flow<Resource<JsonElement>> =
            flow {
                plansCalls++
                lastPlansVehicleId = vehicleId
                plans.forEach { emit(it) }
            }

        override fun ratePlans(): Flow<Resource<JsonElement>> =
            flow {
                ratesCalls++
                rates.forEach { emit(it) }
            }

        override fun settings(): Flow<Resource<JsonElement>> = flow { settings.forEach { emit(it) } }
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

    private fun <T> success(value: T): Resource<T> = Resource.Success(value, fetchedAt = 100L, stale = false)

    private fun errorNoCache(): Resource<JsonElement> =
        Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())

    private fun vehiclesJson(vararg ids: Long): List<Vehicle> = ids.map { vehicle(it) }

    private fun plansJson(vararg plans: JsonObject): JsonArray = buildJsonArray { plans.forEach { add(it) } }

    private fun ratesJson(vararg rates: JsonObject): JsonArray = buildJsonArray { rates.forEach { add(it) } }

    private fun plan(
        id: Long,
        status: String,
        targetSoc: Int,
    ): JsonObject =
        buildJsonObject {
            put("id", id)
            put("vehicle_id", 1)
            put("status", status)
            put("target_soc", targetSoc)
            put("scheduled_start", "2024-01-02T00:00:00Z")
            put("scheduled_end", "2024-01-02T06:00:00Z")
        }

    private fun rate(
        id: String,
        name: String,
        utility: String,
    ): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", name)
            put("utility", utility)
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
