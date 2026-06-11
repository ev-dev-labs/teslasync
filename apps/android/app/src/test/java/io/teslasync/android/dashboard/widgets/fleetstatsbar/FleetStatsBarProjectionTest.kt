package io.teslasync.android.dashboard.widgets.fleetstatsbar

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import kotlin.time.Instant

/**
 * Off-device verification of the FleetStatsBarWidget's pure logic — the raw-SI-JSON decode, the
 * online-vehicle count under the typed `/vehicles` contract, the dual-feed combine that mirrors the web
 * WidgetShell short-circuits (loading / hard error / empty / offline freshness), the SI metres→display
 * distance conversion + one-decimal formatting, the settings-derived display preferences, and the
 * registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx).
 */
class FleetStatsBarProjectionTest {
    private val strings =
        FleetStatsBarStrings(
            title = "Fleet Stats",
            vehicles = "Vehicles",
            online = "online",
            onlineNow = "Online Now",
            distance30d = "Distance (30d)",
            energy30d = "Energy (30d)",
            noData = "No fleet data available",
        )

    private fun project(
        data: FleetStatsBarData,
        unit: DistanceUnitPref = DistanceUnitPref.KM,
    ): FleetStatsBarDisplay = FleetStatsBarProjection.project(data, FleetStatsBarDisplayPrefs(unit), strings, Locale.US)

    // ---- parse ---------------------------------------------------------------------

    @Test
    fun parseNullPayloadIsAbsent() {
        val values = parseFleetAnalytics(null)
        assertFalse(values.present)
        assertEquals(0.0, values.totalDistanceSI, 0.0)
        assertEquals(0.0, values.totalEnergyKwh, 0.0)
    }

    @Test
    fun parseJsonNullPayloadIsAbsent() {
        assertFalse(parseFleetAnalytics(JsonNull).present)
    }

    @Test
    fun parseEmptyObjectIsPresentWithZeroTotals() {
        // Web `analytics` is truthy for any object, so an empty object still counts as data.
        val values = parseFleetAnalytics(buildJsonObject { })
        assertTrue(values.present)
        assertEquals(0.0, values.totalDistanceSI, 0.0)
        assertEquals(0.0, values.totalEnergyKwh, 0.0)
    }

    @Test
    fun parseReadsSnakeCaseSiTotals() {
        val values = parseFleetAnalytics(analyticsJson(distanceSI = 12345.0, energyKwh = 67.8))
        assertTrue(values.present)
        assertEquals(12345.0, values.totalDistanceSI, 0.0)
        assertEquals(67.8, values.totalEnergyKwh, 0.0)
    }

    @Test
    fun parseTreatsMissingTotalsAsZeroButPresent() {
        val values = parseFleetAnalytics(buildJsonObject { put("period_days", 30) })
        assertTrue(values.present)
        assertEquals(0.0, values.totalDistanceSI, 0.0)
        assertEquals(0.0, values.totalEnergyKwh, 0.0)
    }

    // ---- online count (contract pin) -----------------------------------------------

    @Test
    fun onlineCountReflectsTypedVehiclesContract() {
        // The typed `/vehicles` contract (Go `vehicle.Vehicle`, OpenAPI `Vehicle`, generated KMP
        // `Vehicle`) carries no per-vehicle live `state`, so the web `v.state === 'online'` predicate
        // matches zero at runtime. This pins that intentional, contract-faithful reproduction.
        assertEquals(0, countOnline(null))
        assertEquals(0, countOnline(emptyList()))
        assertEquals(0, countOnline(listOf(vehicle(1), vehicle(2), vehicle(3))))
        assertEquals("online", ONLINE_STATE)
    }

    // ---- combine -------------------------------------------------------------------

    @Test
    fun combineFirstLoadOfEitherFeedIsLoading() {
        val loadingV = Resource.Loading<List<Vehicle>>(cached = null, fetchedAt = null, stale = false)
        val loadingA = Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false)
        assertEquals(UiPhase.Loading, combineFleetStats(loadingV, loadingA).phase)

        // Vehicles still first-loading wins over an analytics error (web `isLoading` short-circuits first).
        val analyticsErr = Resource.Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
        assertEquals(UiPhase.Loading, combineFleetStats(loadingV, analyticsErr).phase)
    }

    @Test
    fun combineAnalyticsHardErrorIsErrorEvenWithVehicles() {
        val vehicles = Resource.Success(listOf(vehicle(1)), 100L, false)
        val analyticsErr = Resource.Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
        val state = combineFleetStats(vehicles, analyticsErr)
        assertEquals(UiPhase.Error, state.phase)
        assertEquals(ErrorKind.Network, state.errorKind)
        assertTrue(state.canRetry)
        assertNull(state.data)
    }

    @Test
    fun combineNoVehiclesAndNoAnalyticsIsEmpty() {
        val vehicles = Resource.Success(emptyList<Vehicle>(), 100L, false)
        val analytics = Resource.Success<JsonElement>(JsonNull, 100L, false)
        val state = combineFleetStats(vehicles, analytics)
        assertEquals(UiPhase.Empty, state.phase)
        assertFalse(state.data!!.hasData)
    }

    @Test
    fun combineVehiclesPresentWithoutAnalyticsIsContent() {
        // Web `hasData = (vehicles.length > 0) || analytics`: vehicles alone is enough.
        val vehicles = Resource.Success(listOf(vehicle(1), vehicle(2)), 100L, false)
        val analytics = Resource.Success<JsonElement>(JsonNull, 100L, false)
        val state = combineFleetStats(vehicles, analytics)
        assertEquals(UiPhase.Content, state.phase)
        val data = state.data!!
        assertEquals(2, data.vehicleCount)
        assertEquals(0, data.onlineCount)
    }

    @Test
    fun combineContentCarriesAnalyticsTotalsAndFreshness() {
        val vehicles = Resource.Success(listOf(vehicle(1), vehicle(2), vehicle(3)), 100L, false)
        val analytics = Resource.Success<JsonElement>(analyticsJson(distanceSI = 5000.0, energyKwh = 42.0), 200L, false)
        val state = combineFleetStats(vehicles, analytics)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(200L, state.fetchedAt)
        assertFalse(state.stale)
        val data = state.data!!
        assertEquals(3, data.vehicleCount)
        assertEquals(5000.0, data.totalDistanceSI, 0.0)
        assertEquals(42.0, data.totalEnergyKwh, 0.0)
        assertTrue(data.hasData)
    }

    @Test
    fun combineAnalyticsErrorWithCacheStaysOfflineContentWithRetry() {
        val vehicles = Resource.Success(listOf(vehicle(1), vehicle(2)), 100L, false)
        val cached = analyticsJson(distanceSI = 4200.0, energyKwh = 12.0)
        val analytics = Resource.Error<JsonElement>(cached = cached, fetchedAt = 100L, stale = true, error = ApiError.Timeout())
        val state = combineFleetStats(vehicles, analytics)
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.stale)
        assertTrue(state.isOffline)
        assertTrue(state.canRetry)
        assertEquals(ErrorKind.Timeout, state.errorKind)
        assertEquals(4200.0, state.data!!.totalDistanceSI, 0.0)
    }

    @Test
    fun combineAnalyticsBackgroundRefreshIsRefreshing() {
        val vehicles = Resource.Success(listOf(vehicle(1)), 100L, false)
        val cached = analyticsJson(distanceSI = 1000.0, energyKwh = 3.0)
        val analytics = Resource.Loading<JsonElement>(cached = cached, fetchedAt = 100L, stale = false)
        val state = combineFleetStats(vehicles, analytics)
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.refreshing)
        assertFalse(state.stale)
    }

    // ---- project -------------------------------------------------------------------

    @Test
    fun projectMetricBuildsFourStatsWithKmAndKwh() {
        val data = FleetStatsBarData(vehicleCount = 3, onlineCount = 0, totalDistanceSI = 5000.0, totalEnergyKwh = 42.0, hasData = true)
        val display = project(data, DistanceUnitPref.KM)
        assertTrue(display.hasData)
        assertEquals(4, display.items.size)

        val vehiclesItem = display.items[0]
        assertEquals("Vehicles", vehiclesItem.label)
        assertEquals("3", vehiclesItem.value)
        assertNull(vehiclesItem.unit)
        assertEquals(FleetStatIcon.Vehicles, vehiclesItem.iconKey)

        val onlineItem = display.items[1]
        assertEquals("Online Now", onlineItem.label)
        assertEquals("0", onlineItem.value)
        assertEquals(FleetStatIcon.Online, onlineItem.iconKey)

        val distanceItem = display.items[2]
        assertEquals("Distance (30d)", distanceItem.label)
        assertEquals("5.0", distanceItem.value) // 5000 m / 1000 = 5.0 km
        assertEquals("km", distanceItem.unit)
        assertEquals(FleetStatIcon.Distance, distanceItem.iconKey)

        val energyItem = display.items[3]
        assertEquals("Energy (30d)", energyItem.label)
        assertEquals("42.0", energyItem.value)
        assertEquals("kWh", energyItem.unit)
        assertEquals(FleetStatIcon.Energy, energyItem.iconKey)
    }

    @Test
    fun projectImperialConvertsDistanceToMiles() {
        // 1609.344 m / 1609.344 = 1.0 mi exactly.
        val data = FleetStatsBarData(vehicleCount = 1, onlineCount = 0, totalDistanceSI = 1609.344, totalEnergyKwh = 9.0, hasData = true)
        val display = project(data, DistanceUnitPref.MI)
        val distanceItem = display.items[2]
        assertEquals("1.0", distanceItem.value)
        assertEquals("mi", distanceItem.unit)
    }

    @Test
    fun projectEmptyKeepsItemsButFlagsNoData() {
        val display = project(FleetStatsBarData.EMPTY)
        assertFalse(display.hasData)
        assertEquals("No fleet data available", display.emptyMessage)
        assertEquals(4, display.items.size)
        assertEquals("0", display.items[0].value)
    }

    @Test
    fun displayPrefsResolveFromSettings() {
        assertEquals(FleetStatsBarDisplayPrefs.METRIC_DEFAULT, FleetStatsBarDisplayPrefs.fromSettings(null))
        assertEquals(DistanceUnitPref.KM, FleetStatsBarDisplayPrefs.METRIC_DEFAULT.distanceUnit)

        val imperial = FleetStatsBarDisplayPrefs.fromSettings(buildJsonObject { put("unit_of_length", "mi") })
        assertEquals(DistanceUnitPref.MI, imperial.distanceUnit)
    }

    // ---- registration --------------------------------------------------------------

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("fleet-stats-bar", FleetStatsBarRegistration.ID)
        assertEquals("analytics", FleetStatsBarRegistration.CATEGORY)
        assertEquals("FleetStatsBarWidget", FleetStatsBarRegistration.SLUG)
        assertEquals(30, FleetStatsBarRegistration.WINDOW_DAYS)
        assertEquals(FleetStatsBarSize(cols = 4, rows = 2), FleetStatsBarRegistration.defaultSize)
        assertEquals(FleetStatsBarSize(cols = 3, rows = 2), FleetStatsBarRegistration.minSize)
        assertEquals(FleetStatsBarSize(cols = 4, rows = 40), FleetStatsBarRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(FleetStatsBarSize(cols = 4, rows = 40), FleetStatsBarRegistration.clamp(FleetStatsBarSize(9, 99)))
        assertEquals(FleetStatsBarSize(cols = 3, rows = 2), FleetStatsBarRegistration.clamp(FleetStatsBarSize(0, 0)))
        assertTrue(FleetStatsBarRegistration.isWithinBounds(FleetStatsBarSize(4, 2)))
        assertTrue(FleetStatsBarRegistration.isWithinBounds(FleetStatsBarSize(3, 10)))
        assertFalse(FleetStatsBarRegistration.isWithinBounds(FleetStatsBarSize(2, 10)))
    }

    @Test
    fun compactBranchFollowsRowsBelowTwo() {
        assertTrue(FleetStatsBarSize(cols = 4, rows = 1).isCompact)
        assertFalse(FleetStatsBarSize(cols = 4, rows = 2).isCompact)
        assertFalse(FleetStatsBarSize(cols = 3, rows = 3).isCompact)
    }

    private companion object {
        private val EPOCH = Instant.fromEpochMilliseconds(0)

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
