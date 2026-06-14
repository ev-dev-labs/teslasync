package io.teslasync.android.dashboard.widgets.costforecast

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
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
 * Drives [CostForecastWidgetViewModel] over a controllable fake [CostForecastSource], covering the full
 * cache-then-network state matrix the web component renders (loading / content / empty / hard error +
 * retry / stale-offline + retry / refresh re-fetch), the default-vehicle resolution from the vehicles
 * list (web `vehicles?.[0]?.id`), the explicit-vehicle override, the settings-derived display preference
 * (web `useFormatting`), and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CostForecastWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : CostForecastSource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())
        val forecastEmissions = mutableMapOf<String, List<Resource<JsonElement>>>()
        var settingsEmissions: List<Resource<JsonElement>> = listOf(Resource.Success(JsonObject(emptyMap()), 0L, false))

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun costForecast(vehicleId: String): Flow<Resource<JsonElement>> =
            flow { (forecastEmissions[vehicleId] ?: listOf(loadingForecast())).forEach { emit(it) } }

        override fun settings(): Flow<Resource<JsonElement>> = flow { settingsEmissions.forEach { emit(it) } }
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
    fun contentWhenFirstVehicleHasForecastData() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.forecastEmissions["5"] =
                listOf(Resource.Success(forecastJson(historical = listOf("2025-01" to 40.0)), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertTrue(parseCostForecast(state.data).hasData)
        }

    @Test
    fun emptyWhenNoVehiclesEnrolled() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(emptyList(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyWhenForecastPayloadHasNoMonths() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.forecastEmissions["5"] = listOf(Resource.Success(forecastJson(), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun explicitVehicleIdBypassesVehiclesList() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            // Vehicles list never resolves; the explicit id must still drive the forecast feed.
            src.forecastEmissions["9"] =
                listOf(Resource.Success(forecastJson(forecast = listOf("2025-04" to 30.0)), 100L, false))
            val vm = viewModel(src, vehicleId = 9)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenForecastFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.forecastEmissions["5"] = listOf(loadingForecast(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
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
        }

    @Test
    fun staleOfflineKeepsCachedForecastWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            val cached = forecastJson(historical = listOf("2025-03" to 20.0))
            src.forecastEmissions["5"] = listOf(Resource.Success(cached, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.forecastEmissions["5"] = listOf(Resource.Error(cached, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedForecast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehiclesEmissions = listOf(Resource.Success(listOf(vehicle(5)), 50L, false))
            src.forecastEmissions["5"] =
                listOf(Resource.Success(forecastJson(forecast = listOf("2025-04" to 10.0)), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(10.0, parseCostForecast(vm.state.value.data).forecast.single().cost, 0.0)

            src.forecastEmissions["5"] =
                listOf(Resource.Success(forecastJson(forecast = listOf("2025-05" to 88.0)), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(88.0, parseCostForecast(vm.state.value.data).forecast.single().cost, 0.0)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun displayPrefsReflectSettingsDocument() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.settingsEmissions =
                listOf(
                    Resource.Success(
                        buildJsonObject { put("currency_symbol", "\u20AC") },
                        10L,
                        false,
                    ),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.displayPrefs.collect {} }
            advanceUntilIdle()
            assertEquals("\u20AC", vm.displayPrefs.value.currencySymbol)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "CostForecastWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutForecastPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "costForecast.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("cost") })
            assertFalse(logger.events.any { it.second.containsKey("forecast") })
        }

    private fun TestScope.viewModel(
        source: CostForecastSource,
        logger: Logger = NoopLogger,
        vehicleId: Long? = null,
    ): CostForecastWidgetViewModel = CostForecastWidgetViewModel(source, logger, vehicleId, backgroundScope)

    private companion object {
        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingForecast(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun forecastJson(
            historical: List<Pair<String, Double>> = emptyList(),
            forecast: List<Pair<String, Double>> = emptyList(),
        ): JsonElement =
            buildJsonObject {
                put(
                    "historical",
                    buildJsonArray {
                        historical.forEach { (month, cost) ->
                            add(
                                buildJsonObject {
                                    put("month", month)
                                    put("cost", cost)
                                    put("cost_per_kwh", 0.12)
                                },
                            )
                        }
                    },
                )
                put(
                    "forecast",
                    buildJsonArray {
                        forecast.forEach { (month, cost) ->
                            add(
                                buildJsonObject {
                                    put("month", month)
                                    put("cost", cost)
                                },
                            )
                        }
                    },
                )
            }

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
            )
    }
}
