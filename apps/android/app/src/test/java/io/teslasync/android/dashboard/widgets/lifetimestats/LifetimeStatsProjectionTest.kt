package io.teslasync.android.dashboard.widgets.lifetimestats

import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the LifetimeStatsWidget's pure logic — the raw-SI-JSON decode, the
 * SI-kilometre → display-unit distance conversion (the documented divergence from the web's mile-floor
 * arithmetic), the currency formatting (web `useFormatting`), the core / wide stat-grid + compact-hero
 * projection branches, the settings-derived display preferences, and the registry metadata. Mirrors the
 * web spec (web/src/features/dashboard/widgets/LifetimeStatsWidget.tsx).
 */
class LifetimeStatsProjectionTest {
    private val strings =
        LifetimeStatsStrings(
            title = "Lifetime Stats",
            totalDistance = "Total Distance",
            totalDrives = "Total Drives",
            totalEnergy = "Total Energy",
            co2Saved = "CO2 Saved",
            totalCost = "Total Cost",
            ownershipDays = "Ownership Days",
            avgDailyDistance = "Avg Daily Distance",
            lifetime = "lifetime",
            noData = "No lifetime data",
        )

    private fun prefs(
        distance: DistanceUnitPref = DistanceUnitPref.KM,
        currency: String = "$",
        precision: Int = 2,
    ): LifetimeStatsDisplayPrefs = LifetimeStatsDisplayPrefs(distance, currency, precision)

    private fun sampleJson() =
        buildJsonObject {
            put("total_drives", 1234.0)
            put("total_distance_km", 10000.0)
            put("total_energy_kwh", 3456.7)
            put("co2_offset_kg", 1200.0)
            put("total_charging_cost", 567.89)
            put("ownership_days", 100.0)
        }

    private fun project(
        data: LifetimeStatsData,
        prefs: LifetimeStatsDisplayPrefs = prefs(),
    ): LifetimeStatsDisplay = LifetimeStatsProjection.project(data, prefs, strings, Locale.US)

    @Test
    fun parseNullPayloadIsEmpty() {
        val data = parseLifetimeStats(null)
        assertFalse(data.hasData)
        assertEquals(0.0, data.totalDistanceKm, 0.0)
        assertEquals(0.0, data.totalDrives, 0.0)
    }

    @Test
    fun parseReadsSnakeCaseSiFields() {
        val data = parseLifetimeStats(sampleJson())
        assertEquals(1234.0, data.totalDrives, 0.0)
        assertEquals(10000.0, data.totalDistanceKm, 0.0)
        assertEquals(3456.7, data.totalEnergyKwh, 0.0)
        assertEquals(1200.0, data.co2OffsetKg, 0.0)
        assertEquals(567.89, data.totalChargingCost, 0.0)
        assertEquals(100.0, data.ownershipDays, 0.0)
        assertTrue(data.hasData)
    }

    @Test
    fun parseTreatsMissingNumericsAsZero() {
        val data = parseLifetimeStats(buildJsonObject { put("total_drives", 5.0) })
        assertEquals(5.0, data.totalDrives, 0.0)
        assertEquals(0.0, data.totalDistanceKm, 0.0)
        assertEquals(0.0, data.totalEnergyKwh, 0.0)
        assertTrue(data.hasData)
    }

    @Test
    fun hasDataIsFalseOnlyWhenEveryCoreTotalIsZero() {
        assertFalse(parseLifetimeStats(buildJsonObject { put("total_charging_cost", 99.0) }).hasData)
        assertTrue(parseLifetimeStats(buildJsonObject { put("total_energy_kwh", 1.0) }).hasData)
        assertTrue(parseLifetimeStats(buildJsonObject { put("ownership_days", 1.0) }).hasData)
    }

    @Test
    fun coreStatsFormatDistanceDrivesEnergyAndCo2() {
        val core = project(parseLifetimeStats(sampleJson())).coreStats
        assertEquals(4, core.size)
        assertEquals(LifetimeStatItem("Total Distance", "10,000", "km", LifetimeStatIcon.Distance), core[0])
        assertEquals(LifetimeStatItem("Total Drives", "1,234", null, LifetimeStatIcon.Drives), core[1])
        assertEquals(LifetimeStatItem("Total Energy", "3,456.7", "kWh", LifetimeStatIcon.Energy), core[2])
        assertEquals(LifetimeStatItem("CO2 Saved", "1,200", "kg", LifetimeStatIcon.Co2), core[3])
    }

    @Test
    fun wideStatsFormatCostOwnershipAndAvgDaily() {
        val wide = project(parseLifetimeStats(sampleJson())).wideStats
        assertEquals(3, wide.size)
        assertEquals(LifetimeStatItem("Total Cost", "\$567.89", null, LifetimeStatIcon.Cost), wide[0])
        assertEquals(LifetimeStatItem("Ownership Days", "100", null, LifetimeStatIcon.OwnershipDays), wide[1])
        // 10,000 km over 100 days = 100 km/day.
        assertEquals(LifetimeStatItem("Avg Daily Distance", "100.0", "km", LifetimeStatIcon.AvgDailyDistance), wide[2])
    }

    @Test
    fun statsForFoldsInTheExtraTotalsOnlyWhenWide() {
        val display = project(parseLifetimeStats(sampleJson()))
        assertEquals(4, display.statsFor(wide = false).size)
        assertEquals(7, display.statsFor(wide = true).size)
        assertEquals(display.coreStats + display.wideStats, display.statsFor(wide = true))
    }

    @Test
    fun compactHeroUsesLifetimeDistanceAndCaption() {
        val display = project(parseLifetimeStats(sampleJson()))
        assertTrue(display.hasData)
        assertEquals(10000.0, display.compactValue, 1e-6)
        assertEquals("km", display.compactUnit)
        assertEquals("km lifetime", display.compactCaption)
        assertEquals("10,000 km lifetime", display.compactContentDescription)
    }

    @Test
    fun distanceFloorsOnSiMetresNotTheWebMileArithmetic() {
        // Parity note: the web converts `total_distance_km * KM_TO_MI` through a metre-expecting
        // converter (under-reporting); the native bridges km → m → display unit, the correct result.
        val km = project(parseLifetimeStats(sampleJson()), prefs(DistanceUnitPref.KM))
        assertEquals("10,000", km.coreStats[0].value)
        assertEquals("mi", project(parseLifetimeStats(sampleJson()), prefs(DistanceUnitPref.MI)).coreStats[0].unit)

        val mi = project(parseLifetimeStats(sampleJson()), prefs(DistanceUnitPref.MI))
        // 10,000 km == 10,000,000 m / 1609.344 == 6213.71 mi.
        assertEquals(6213.71, LifetimeStatsProjection.toDisplayDistance(10_000_000.0, DistanceUnitPref.MI), 0.01)
        assertEquals("6,214", mi.coreStats[0].value)
        assertEquals("62.1", mi.wideStats[2].value)
    }

    @Test
    fun avgDailyIsZeroWhenNoOwnershipDays() {
        val json =
            buildJsonObject {
                put("total_distance_km", 10000.0)
                put("ownership_days", 0.0)
            }
        val display = project(parseLifetimeStats(json))
        assertEquals("0", display.wideStats[1].value)
        assertEquals("0.0", display.wideStats[2].value)
    }

    @Test
    fun emptyDataProjectsNoDataMessageAndNoTotals() {
        val display = project(LifetimeStatsData.EMPTY)
        assertFalse(display.hasData)
        assertEquals(0.0, display.compactValue, 0.0)
        assertEquals("No lifetime data", display.emptyMessage)
        assertEquals("0", display.coreStats[1].value)
    }

    @Test
    fun formatCurrencyGroupsAndPrefixesSymbol() {
        assertEquals("\$1,234.50", LifetimeStatsProjection.formatCurrency(1234.5, "$", 2, Locale.US))
        assertEquals("\u20AC9.999", LifetimeStatsProjection.formatCurrency(9.999, "\u20AC", 3, Locale.US))
        // Blank symbol falls back to "$" (web `currency_symbol` blank guard).
        assertEquals("\$5.00", LifetimeStatsProjection.formatCurrency(5.0, "  ", 2, Locale.US))
    }

    @Test
    fun costTileHonoursTheUserCurrencyAndPrecision() {
        val euros = project(parseLifetimeStats(sampleJson()), prefs(DistanceUnitPref.KM, "\u20AC", 0))
        assertEquals("\u20AC568", euros.wideStats[0].value)
    }

    @Test
    fun displayPrefsResolveFromSettings() {
        assertEquals(LifetimeStatsDisplayPrefs.METRIC_DEFAULT, LifetimeStatsDisplayPrefs.fromSettings(null))

        val custom =
            LifetimeStatsDisplayPrefs.fromSettings(
                buildJsonObject {
                    put("unit_of_length", "mi")
                    put("currency_symbol", "\u20AC")
                    put("decimal_precision", 3)
                },
            )
        assertEquals(LifetimeStatsDisplayPrefs(DistanceUnitPref.MI, "\u20AC", 3), custom)

        val blankSymbol = LifetimeStatsDisplayPrefs.fromSettings(buildJsonObject { put("currency_symbol", "   ") })
        assertEquals("$", blankSymbol.currencySymbol)
        assertEquals(2, blankSymbol.precision)
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("lifetime-stats", LifetimeStatsRegistration.ID)
        assertEquals("analytics", LifetimeStatsRegistration.CATEGORY)
        assertEquals("LifetimeStatsWidget", LifetimeStatsRegistration.SLUG)
        assertEquals(LifetimeStatsSize(cols = 2, rows = 2), LifetimeStatsRegistration.defaultSize)
        assertEquals(LifetimeStatsSize(cols = 1, rows = 2), LifetimeStatsRegistration.minSize)
        assertEquals(LifetimeStatsSize(cols = 4, rows = 40), LifetimeStatsRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(LifetimeStatsSize(cols = 4, rows = 40), LifetimeStatsRegistration.clamp(LifetimeStatsSize(9, 99)))
        assertEquals(LifetimeStatsSize(cols = 1, rows = 2), LifetimeStatsRegistration.clamp(LifetimeStatsSize(0, 0)))
        assertTrue(LifetimeStatsRegistration.isWithinBounds(LifetimeStatsSize(2, 2)))
        assertFalse(LifetimeStatsRegistration.isWithinBounds(LifetimeStatsSize(5, 2)))
    }

    @Test
    fun sizeBranchesFollowColumnCount() {
        assertTrue(LifetimeStatsSize(cols = 1, rows = 4).isCompact)
        assertFalse(LifetimeStatsSize(cols = 2, rows = 4).isCompact)
        assertFalse(LifetimeStatsSize(cols = 2, rows = 4).isWide)
        assertTrue(LifetimeStatsSize(cols = 3, rows = 4).isWide)
        assertTrue(LifetimeStatsSize(cols = 4, rows = 4).isWide)
    }
}
