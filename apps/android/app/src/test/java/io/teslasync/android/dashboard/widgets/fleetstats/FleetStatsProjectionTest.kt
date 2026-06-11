package io.teslasync.android.dashboard.widgets.fleetstats

import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device unit tests for the pure Fleet Stats model + projection — the adapter test the prompt
 * requires (cached SI JSON → render-ready projection). Covers the decode (null-safe, web `?? 0`), the
 * display-boundary conversions (the web `FleetStatsWidget`/`FleetStatsBar` arithmetic verbatim — incl.
 * the distance quirk it does NOT scale by 1000), the five-card projection + TalkBack content
 * descriptions, and the registry footprint clamp. All number formatting is pinned to [Locale.US].
 */
class FleetStatsProjectionTest {
    private val strings =
        FleetStatsStrings(
            size = "Fleet Size",
            online = "online",
            distance = "Distance (30d)",
            energy = "Energy (30d)",
            efficiency = "Efficiency",
            average = "fleet average",
            alerts = "Alerts",
            unread = "unread",
        )

    // ---- decode ------------------------------------------------------------------

    @Test
    fun parseReadsSiTotals() {
        val data =
            parseFleetStats(
                buildJsonObject {
                    put("total_distance_km", 1234.5)
                    put("total_energy_kwh", 56.7)
                    put("avg_efficiency_wh_km", 160.0)
                },
            )
        assertEquals(1234.5, data.totalDistanceKm, 0.0)
        assertEquals(56.7, data.totalEnergyKwh, 0.0)
        assertEquals(160.0, data.avgEfficiencyWhKm, 0.0)
    }

    @Test
    fun parseIsNullSafe() {
        // Non-object input collapses to the all-zero snapshot (web `analytics` undefined).
        assertEquals(FleetStatsData.EMPTY, parseFleetStats(JsonArray(emptyList())))
        assertEquals(FleetStatsData.EMPTY, parseFleetStats(null))
        // Missing / JSON-null fields collapse to zero (web `?? 0`).
        val partial = parseFleetStats(buildJsonObject { put("total_energy_kwh", 9.0) })
        assertEquals(0.0, partial.totalDistanceKm, 0.0)
        assertEquals(9.0, partial.totalEnergyKwh, 0.0)
        assertEquals(0.0, partial.avgEfficiencyWhKm, 0.0)
    }

    // ---- conversions -------------------------------------------------------------

    @Test
    fun distanceMirrorsWebArithmeticWithoutScaleUp() {
        // The web FleetStatsWidget passes `total_distance_km` straight into convertDistanceFromSI WITHOUT
        // the `* 1000` the sibling AnalyticsSummaryWidget applies; we mirror the named spec exactly.
        assertEquals(5.0, FleetStatsProjection.distanceDisplay(5000.0, DistanceUnitPref.KM), 1e-9)
        assertEquals(1.0, FleetStatsProjection.distanceDisplay(1609.344, DistanceUnitPref.MI), 1e-9)
    }

    @Test
    fun efficiencyConvertsForMilesOnly() {
        assertEquals(160.0, FleetStatsProjection.efficiencyDisplay(160.0, DistanceUnitPref.KM), 1e-9)
        assertEquals(160.0 * FleetStatsProjection.KM_PER_MILE, FleetStatsProjection.efficiencyDisplay(160.0, DistanceUnitPref.MI), 1e-9)
    }

    @Test
    fun efficiencyUnitTracksDistanceUnit() {
        assertEquals("Wh/km", FleetStatsProjection.efficiencyUnit(DistanceUnitPref.KM))
        assertEquals("Wh/mi", FleetStatsProjection.efficiencyUnit(DistanceUnitPref.MI))
    }

    // ---- projection --------------------------------------------------------------

    @Test
    fun projectBuildsFiveCardsInWebOrder() {
        val display = project(distanceKm = 5000.0, energyKwh = 56.7, efficiency = 160.0)
        assertEquals(
            listOf("Fleet Size", "Distance (30d)", "Energy (30d)", "Efficiency", "Alerts"),
            display.metrics.map { it.label },
        )
    }

    @Test
    fun fleetSizeFoldsCountAndOnlineSub() {
        val display = project(bar = bar(vehicleCount = 3, onlineCount = 0))
        assertEquals(3.0, display.fleetSize.value, 0.0)
        assertEquals("0 online", display.fleetSize.sublabel)
        assertEquals("Fleet Size: 3, 0 online", display.fleetSize.contentDescription)
    }

    @Test
    fun distanceCardConvertsAndCarriesUnitAndTrend() {
        val display =
            project(
                distanceKm = 5000.0,
                bar = bar(distanceTrend = listOf(50.0, 40.0, 30.0)),
            )
        assertEquals(5.0, display.distance.value, 1e-9)
        assertEquals("km", display.distance.unit)
        assertEquals(listOf(50.0, 40.0, 30.0), display.distance.trend)
        assertEquals("Distance (30d): 5 km", display.distance.contentDescription)
    }

    @Test
    fun energyCardIsOneDecimalKwh() {
        val display = project(energyKwh = 56.74)
        assertEquals(56.74, display.energy.value, 0.0)
        assertEquals(1, display.energy.decimals)
        assertEquals("kWh", display.energy.unit)
        assertEquals("Energy (30d): 56.7 kWh", display.energy.contentDescription)
    }

    @Test
    fun efficiencyCardConvertsForMiles() {
        val display = project(efficiency = 160.0, unit = DistanceUnitPref.MI)
        assertEquals(160.0 * FleetStatsProjection.KM_PER_MILE, display.efficiency.value, 1e-9)
        assertEquals("Wh/mi", display.efficiency.unit)
        assertEquals("fleet average", display.efficiency.sublabel)
        assertEquals("Efficiency: 257 Wh/mi, fleet average", display.efficiency.contentDescription)
    }

    @Test
    fun alertsCardReflectsUnreadCount() {
        val none = project(bar = bar(unreadAlerts = 0))
        assertEquals(0.0, none.alerts.value, 0.0)
        assertEquals("unread", none.alerts.sublabel)
        assertFalse(none.alertsHasUnread)
        assertEquals("Alerts: 0 unread", none.alerts.contentDescription)

        val some = project(bar = bar(unreadAlerts = 4))
        assertTrue(some.alertsHasUnread)
        assertEquals("Alerts: 4 unread", some.alerts.contentDescription)
    }

    @Test
    fun energyTrendFlowsToEnergyCardOnly() {
        val display = project(bar = bar(energyTrend = listOf(1.0, 2.0)))
        assertEquals(listOf(1.0, 2.0), display.energy.trend)
        // The non-trend cards never carry a sparkline series.
        assertTrue(display.fleetSize.trend.isEmpty())
        assertTrue(display.efficiency.trend.isEmpty())
        assertTrue(display.alerts.trend.isEmpty())
    }

    // ---- registration ------------------------------------------------------------

    @Test
    fun registrationMetadataMatchesWebRegistry() {
        assertEquals("fleet-stats", FleetStatsRegistration.ID)
        assertEquals("analytics", FleetStatsRegistration.CATEGORY)
        assertEquals("FleetStatsWidget", FleetStatsRegistration.SLUG)
        assertEquals(FleetStatsSize(4, 2), FleetStatsRegistration.defaultSize)
        assertEquals(FleetStatsSize(2, 2), FleetStatsRegistration.minSize)
        assertEquals(FleetStatsSize(4, 40), FleetStatsRegistration.maxSize)
    }

    @Test
    fun registrationClampsToBounds() {
        assertEquals(FleetStatsSize(2, 2), FleetStatsRegistration.clamp(FleetStatsSize(1, 1)))
        assertEquals(FleetStatsSize(4, 40), FleetStatsRegistration.clamp(FleetStatsSize(9, 99)))
        assertTrue(FleetStatsRegistration.isWithinBounds(FleetStatsSize(4, 2)))
        assertFalse(FleetStatsRegistration.isWithinBounds(FleetStatsSize(1, 1)))
    }

    // ---- helpers -----------------------------------------------------------------

    private fun bar(
        vehicleCount: Int = 0,
        onlineCount: Int = 0,
        unreadAlerts: Int = 0,
        distanceTrend: List<Double> = emptyList(),
        energyTrend: List<Double> = emptyList(),
    ): FleetStatsBarData = FleetStatsBarData(vehicleCount, onlineCount, unreadAlerts, distanceTrend, energyTrend)

    private fun project(
        distanceKm: Double = 0.0,
        energyKwh: Double = 0.0,
        efficiency: Double = 0.0,
        unit: DistanceUnitPref = DistanceUnitPref.KM,
        bar: FleetStatsBarData = bar(),
    ): FleetStatsDisplay =
        FleetStatsProjection.project(
            data = FleetStatsData(distanceKm, energyKwh, efficiency),
            bar = bar,
            prefs = FleetStatsDisplayPrefs(unit),
            strings = strings,
            locale = Locale.US,
        )
}
