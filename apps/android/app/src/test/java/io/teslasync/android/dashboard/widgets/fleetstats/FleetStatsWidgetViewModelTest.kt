package io.teslasync.android.dashboard.widgets.fleetstats

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.Drive
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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Drives [FleetStatsWidgetViewModel] over a controllable fake [FleetStatsSource], covering the
 * cache-then-network state matrix the web `WidgetShell` renders (loading / content / hard error + retry /
 * stale-offline + retry / refresh re-fetch), the supplementary bar fold (fleet count, the stateless
 * online count, and the reversed/limited recent-activity trends), the settings-derived display
 * preferences (web `useUnits`), and the PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FleetStatsWidgetViewModelTest {
    /** A fake whose feeds are re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : FleetStatsSource {
        var vehiclesEmissions: List<Resource<List<Vehicle>>> = listOf(success(emptyList()))
        var analyticsEmissions: List<Resource<JsonElement>> = listOf(loading())
        var drivesEmissions: List<Resource<List<Drive>>> = listOf(success(emptyList()))
        var chargesEmissions: List<Resource<List<ChargingSession>>> = listOf(success(emptyList()))
        var settingsEmissions: List<Resource<JsonElement>> = listOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
        var recentDrivesRequestedFor: Long? = null
        var recentChargesRequestedFor: Long? = null

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = flow { vehiclesEmissions.forEach { emit(it) } }

        override fun fleetAnalytics(): Flow<Resource<JsonElement>> = flow { analyticsEmissions.forEach { emit(it) } }

        override fun recentDrives(vehicleId: Long): Flow<Resource<List<Drive>>> =
            flow {
                recentDrivesRequestedFor = vehicleId
                drivesEmissions.forEach { emit(it) }
            }

        override fun recentCharges(vehicleId: Long): Flow<Resource<List<ChargingSession>>> =
            flow {
                recentChargesRequestedFor = vehicleId
                chargesEmissions.forEach { emit(it) }
            }

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

    // ---- analytics-driven primary state ------------------------------------------

    @Test
    fun loadingWhileAnalyticsLoads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenAnalyticsPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource().apply { analyticsEmissions = listOf(success(analyticsJson(distanceKm = 5000.0))) }
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(100L, state.fetchedAt)
            assertEquals(5000.0, parseFleetStats(state.data).totalDistanceKm, 0.0)
        }

    @Test
    fun contentEvenWhenAnalyticsIsEmptyObject() =
        runTest(UnconfinedTestDispatcher()) {
            // FleetStats never hides the bar: an all-zero/empty payload is content (labeled zeros), not Empty.
            val src = FakeSource().apply { analyticsEmissions = listOf(Resource.Success(JsonObject(emptyMap()), 100L, false)) }
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenAnalyticsFailsNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource().apply { analyticsEmissions = listOf(loading(), Resource.Error(null, null, false, ApiError.Network())) }
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
            val cached = analyticsJson(distanceKm = 4200.0)
            val src = FakeSource().apply { analyticsEmissions = listOf(success(cached)) }
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            src.analyticsEmissions = listOf(Resource.Error(cached, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
            assertEquals(4200.0, parseFleetStats(state.data).totalDistanceKm, 0.0)
        }

    @Test
    fun refreshReFetchesUpdatedAnalytics() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource().apply { analyticsEmissions = listOf(success(analyticsJson(energyKwh = 10.0))) }
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(10.0, parseFleetStats(vm.state.value.data).totalEnergyKwh, 0.0)

            src.analyticsEmissions = listOf(Resource.Success(analyticsJson(energyKwh = 99.0), 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(99.0, parseFleetStats(vm.state.value.data).totalEnergyKwh, 0.0)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    // ---- supplementary bar fold --------------------------------------------------

    @Test
    fun barFoldsVehicleCountAndReversedLimitedTrends() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource().apply {
                    vehiclesEmissions = listOf(success(listOf(vehicle(7), vehicle(8))))
                    // Six drives — only the five most-recent feed the sparkline, reversed (oldest → newest).
                    drivesEmissions =
                        listOf(success((1..6).map { drive(id = it.toLong(), distanceM = it * 10.0) }))
                    chargesEmissions =
                        listOf(success(listOf(charge(id = 1, wh = 100.0), charge(id = 2, wh = 200.0))))
                }
            val vm = viewModel(src)
            backgroundScope.launch { vm.bar.collect {} }
            advanceUntilIdle()

            val bar = vm.bar.value
            assertEquals(2, bar.vehicleCount)
            assertEquals(listOf(50.0, 40.0, 30.0, 20.0, 10.0), bar.distanceTrend)
            assertEquals(listOf(200.0, 100.0), bar.energyTrend)
            // The recent feeds are scoped to the first enrolled vehicle (web `vehicles?.[0]?.id`).
            assertEquals(7L, src.recentDrivesRequestedFor)
            assertEquals(7L, src.recentChargesRequestedFor)
        }

    @Test
    fun barWithoutVehicleSkipsRecentFeeds() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource().apply {
                    vehiclesEmissions = listOf(success(emptyList()))
                    drivesEmissions = listOf(success(listOf(drive(id = 1, distanceM = 99.0))))
                }
            val vm = viewModel(src)
            backgroundScope.launch { vm.bar.collect {} }
            advanceUntilIdle()

            val bar = vm.bar.value
            assertEquals(0, bar.vehicleCount)
            assertTrue(bar.distanceTrend.isEmpty())
            assertTrue(bar.energyTrend.isEmpty())
            // No bogus vehicle_id=0 recent request is issued.
            assertEquals(null, src.recentDrivesRequestedFor)
        }

    @Test
    fun barOnlineCountIsZeroAgainstStatelessVehicleContract() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource().apply { vehiclesEmissions = listOf(success(listOf(vehicle(7), vehicle(8), vehicle(9)))) }
            val vm = viewModel(src)
            backgroundScope.launch { vm.bar.collect {} }
            advanceUntilIdle()

            // The generated /vehicles contract carries no `state`, so the web's `v.state==='online'` count is 0.
            assertEquals(3, vm.bar.value.vehicleCount)
            assertEquals(0, vm.bar.value.onlineCount)
            assertEquals(0, vm.bar.value.unreadAlerts)
        }

    // ---- settings-derived display prefs ------------------------------------------

    @Test
    fun displayPrefsReflectSettingsDocument() =
        runTest(UnconfinedTestDispatcher()) {
            val miles = Resource.Success(buildJsonObject { put("unit_of_length", "mi") }, 10L, false)
            val src = FakeSource().apply { settingsEmissions = listOf(miles) }
            val vm = viewModel(src)
            backgroundScope.launch { vm.displayPrefs.collect {} }
            advanceUntilIdle()
            assertEquals(DistanceUnitPref.MI, vm.displayPrefs.value.distanceUnit)
        }

    // ---- diagnostics -------------------------------------------------------------

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "FleetStatsWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutFleetPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "fleetStats.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("distance") })
            assertFalse(logger.events.any { it.second.containsKey("energy") })
        }

    private fun TestScope.viewModel(
        source: FleetStatsSource,
        logger: Logger = NoopLogger,
    ): FleetStatsWidgetViewModel = FleetStatsWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        val EPOCH: Instant = Instant.fromEpochMilliseconds(0)

        fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun <T> success(value: T): Resource<T> = Resource.Success(value, 100L, false)

        fun analyticsJson(
            distanceKm: Double = 0.0,
            energyKwh: Double = 0.0,
            efficiency: Double = 0.0,
        ): JsonElement =
            buildJsonObject {
                put("period_days", 30)
                put("total_distance_km", distanceKm)
                put("total_energy_kwh", energyKwh)
                put("avg_efficiency_wh_km", efficiency)
            }

        fun vehicle(id: Long): Vehicle =
            Vehicle(
                createdAt = EPOCH,
                displayName = "Car $id",
                enrolledAt = EPOCH,
                id = id,
                teslaId = 1000L + id,
                timezone = "UTC",
                updatedAt = EPOCH,
                vin = "VIN$id",
            )

        fun drive(
            id: Long,
            distanceM: Double,
        ): Drive =
            Drive(
                createdAt = EPOCH,
                distanceM = distanceM,
                durationS = 600L,
                id = id,
                startTs = EPOCH,
                updatedAt = EPOCH,
                vehicleId = 7L,
            )

        fun charge(
            id: Long,
            wh: Double,
        ): ChargingSession =
            ChargingSession(
                id = id,
                startedAt = EPOCH,
                vehicleId = 7L,
                totalEnergyAddedWh = wh,
            )
    }
}
