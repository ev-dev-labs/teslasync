package io.teslasync.android.dashboard.widgets.fleetstatsbar

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
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
 * Drives [FleetStatsBarWidgetViewModel] over a controllable fake [FleetStatsBarSource], covering the full
 * cache-then-network state matrix the web component renders (loading / content / empty / hard error +
 * retry / stale-offline + retry / refresh re-fetch) across the COMBINED vehicles + fleet-analytics feeds,
 * the settings-derived display preferences (web `useUnits`), and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FleetStatsBarWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : FleetStatsBarSource {
        var vehicleEmissions: List<Resource<List<Vehicle>>> = listOf(loadingVehicles())
        var fleetEmissions: List<Resource<JsonElement>> = listOf(loadingAnalytics())
        var settingsEmissions: List<Resource<JsonElement>> = listOf(Resource.Success(JsonObject(emptyMap()), 0L, false))

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehicleEmissions.forEach { emit(it) } }

        override fun fleetAnalytics(): Flow<Resource<JsonElement>> = flow { fleetEmissions.forEach { emit(it) } }

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
    fun loadingWhileFeedsLoad() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenVehiclesAndAnalyticsPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehicleEmissions = listOf(Resource.Success(listOf(vehicle(1), vehicle(2)), 100L, false))
            src.fleetEmissions = listOf(Resource.Success(analyticsJson(5000.0, 42.0), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            val data = state.data!!
            assertEquals(2, data.vehicleCount)
            assertEquals(0, data.onlineCount)
            assertEquals(5000.0, data.totalDistanceSI, 0.0)
            assertEquals(42.0, data.totalEnergyKwh, 0.0)
        }

    @Test
    fun emptyWhenNoVehiclesAndNoAnalytics() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehicleEmissions = listOf(Resource.Success(emptyList(), 100L, false))
            src.fleetEmissions = listOf(Resource.Success(JsonNull, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenAnalyticsFailsWithNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehicleEmissions = listOf(Resource.Success(listOf(vehicle(1)), 100L, false))
            src.fleetEmissions = listOf(loadingAnalytics(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedAnalyticsWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehicleEmissions = listOf(Resource.Success(listOf(vehicle(1), vehicle(2)), 100L, false))
            val cached = analyticsJson(4200.0, 12.0)
            src.fleetEmissions = listOf(Resource.Success(cached, 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.fleetEmissions = listOf(Resource.Error(cached, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
            assertEquals(4200.0, state.data!!.totalDistanceSI, 0.0)
        }

    @Test
    fun refreshReFetchesUpdatedAnalytics() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.vehicleEmissions = listOf(Resource.Success(listOf(vehicle(1)), 100L, false))
            src.fleetEmissions = listOf(Resource.Success(analyticsJson(1000.0, 5.0), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val first = vm.state.value
            assertEquals(1000.0, first.data!!.totalDistanceSI, 0.0)

            src.fleetEmissions = listOf(Resource.Success(analyticsJson(6000.0, 30.0), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            val refreshed = vm.state.value
            assertEquals(6000.0, refreshed.data!!.totalDistanceSI, 0.0)
            assertEquals(200L, refreshed.fetchedAt)
        }

    @Test
    fun displayPrefsReflectSettingsDocument() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.settingsEmissions = listOf(Resource.Success(buildJsonObject { put("unit_of_length", "mi") }, 10L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.displayPrefs.collect {} }
            advanceUntilIdle()
            assertEquals(DistanceUnitPref.MI, vm.displayPrefs.value.distanceUnit)
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
            assertEquals(mapOf("surface" to "FleetStatsBarWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutFleetPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "fleetStatsBar.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("vehicleCount") })
            assertFalse(logger.events.any { it.second.containsKey("distance") })
        }

    private fun TestScope.viewModel(
        source: FleetStatsBarSource,
        logger: Logger = NoopLogger,
    ): FleetStatsBarWidgetViewModel = FleetStatsBarWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        private val EPOCH = Instant.fromEpochMilliseconds(0)

        fun loadingVehicles(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun loadingAnalytics(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun analyticsJson(
            distanceSI: Double,
            energyKwh: Double,
        ): JsonElement =
            buildJsonObject {
                put("period_days", 30)
                put("total_distance_km", distanceSI)
                put("total_energy_kwh", energyKwh)
            }

        fun vehicle(id: Long): Vehicle =
            Vehicle(
                createdAt = EPOCH,
                displayName = "Vehicle $id",
                enrolledAt = EPOCH,
                id = id,
                teslaId = id,
                timezone = "UTC",
                updatedAt = EPOCH,
                vin = "VIN$id",
            )
    }
}
