package io.teslasync.android.dashboard.widgets.energystats

import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the EnergyStatsWidget's pure logic — the raw-SI-JSON decode, the SI energy
 * formatting (web `useUnits().formatEnergy`), the SI Wh/m → display-unit efficiency conversion (web
 * `toEfficiencyDisplay`), the Wh → kWh chart series, the standard/wide stat-grid branches, the compact
 * hero + TalkBack content description, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/EnergyStatsWidget.tsx).
 */
class EnergyStatsProjectionTest {
    private val strings =
        EnergyStatsStrings(
            title = "Energy Stats",
            totalUsed = "Total Used",
            totalCharged = "Total Charged",
            avgEfficiency = "Avg Efficiency",
            co2Saved = "CO\u2082 Saved",
            totalCost = "Total Cost",
            netBalance = "Net Energy",
            noData = "No energy data available",
            dailyUsage = "Daily Usage",
            energyKwh = "Energy (kWh)",
        )

    private fun prefs(distance: DistanceUnitPref = DistanceUnitPref.KM): UnitPref =
        UnitPref(
            distance = distance,
            speed = SpeedUnitPref.KMH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.BAR,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
            precision = null,
        )

    private fun sampleJson() =
        buildJsonObject {
            put("total_energy_used_wh", 12_300.0)
            put("total_energy_charged_wh", 20_000.0)
            put("total_wh", 32_000.0)
            put("total_cost", 45.5)
            put("avg_efficiency_wh_per_m", 0.15)
            put("co2_saved_kg", 8.5)
            put(
                "daily_breakdown",
                buildJsonArray {
                    add(day("2025-01-15", 5_000.0))
                    add(day("2025-01-16", 7_500.0))
                },
            )
        }

    private fun day(
        date: String,
        energyWh: Double,
    ) = buildJsonObject {
        put("date", date)
        put("energy_wh", energyWh)
    }

    private fun project(
        size: EnergyStatsSize,
        distance: DistanceUnitPref = DistanceUnitPref.KM,
    ): EnergyStatsDisplay = EnergyStatsProjection.project(parseEnergyStats(sampleJson()), size, strings, prefs(distance), Locale.US)

    @Test
    fun parseNullPayloadIsEmpty() {
        val data = parseEnergyStats(null)
        assertFalse(data.hasData)
        assertEquals(0.0, data.totalEnergyUsedWh, 0.0)
        assertTrue(data.daily.isEmpty())
    }

    @Test
    fun parseEmptyObjectIsEmpty() {
        assertFalse(parseEnergyStats(buildJsonObject { }).hasData)
    }

    @Test
    fun parseReadsSnakeCaseSiFields() {
        val data = parseEnergyStats(sampleJson())
        assertTrue(data.hasData)
        assertEquals(12_300.0, data.totalEnergyUsedWh, 0.0)
        assertEquals(20_000.0, data.totalEnergyChargedWh, 0.0)
        assertEquals(32_000.0, data.totalWh, 0.0)
        assertEquals(45.5, data.totalCost, 0.0)
        assertEquals(0.15, data.avgEfficiencyWhPerM, 0.0)
        assertEquals(8.5, data.co2SavedKg, 0.0)
        assertEquals(2, data.daily.size)
        assertEquals(DailyEnergyPoint("2025-01-16", 7_500.0), data.daily.last())
    }

    @Test
    fun parseTreatsMissingNumericsAsZero() {
        val json =
            buildJsonObject {
                put(
                    "daily_breakdown",
                    buildJsonArray { add(buildJsonObject { put("date", "2025-09-01") }) },
                )
            }
        val data = parseEnergyStats(json)
        assertTrue(data.hasData)
        assertEquals(0.0, data.totalWh, 0.0)
        assertEquals(DailyEnergyPoint("2025-09-01", 0.0), data.daily.single())
    }

    @Test
    fun standardStatsAreFourCoreTiles() {
        val display = project(EnergyStatsRegistration.defaultSize)
        assertTrue(display.hasData)
        assertFalse(display.isCompact)
        assertFalse(display.isWide)
        assertEquals(2, display.statGridColumns)
        assertEquals(
            listOf(
                EnergyStatItem("Total Used", "12.3 kWh", null, EnergyStatIcon.Used),
                EnergyStatItem("Total Charged", "20.0 kWh", null, EnergyStatIcon.Charged),
                EnergyStatItem("Avg Efficiency", "150.0", "Wh/km", EnergyStatIcon.Efficiency),
                EnergyStatItem("CO\u2082 Saved", "8.5", "kg", EnergyStatIcon.Co2),
            ),
            display.stats,
        )
    }

    @Test
    fun wideStatsAddCostAndNetEnergy() {
        val display = project(EnergyStatsSize(cols = 3, rows = 4))
        assertTrue(display.isWide)
        assertEquals(3, display.statGridColumns)
        assertEquals(6, display.stats.size)
        // Total Cost: fmtNumber(45.5, 2) with the "$" unit (web `unit: '$'`).
        assertEquals(EnergyStatItem("Total Cost", "45.50", "$", EnergyStatIcon.Cost), display.stats[4])
        // Net Energy: formatEnergy(charged - used) = (20000 - 12300) Wh = 7.7 kWh.
        assertEquals(EnergyStatItem("Net Energy", "7.7 kWh", null, EnergyStatIcon.Net), display.stats[5])
    }

    @Test
    fun chartPointsConvertWhToKwhWithShortLabels() {
        val points = project(EnergyStatsRegistration.defaultSize).chartPoints
        assertEquals(2, points.size)
        assertEquals(EnergyChartPoint("2025-01-15", "Jan 15", 5.0), points.first())
        assertEquals(EnergyChartPoint("2025-01-16", "Jan 16", 7.5), points.last())
    }

    @Test
    fun compactHeroUsesTotalWhInKwh() {
        val display = project(EnergyStatsRegistration.minSize)
        assertTrue(display.isCompact)
        assertEquals(32.0, display.compactValueKwh, 0.0)
        assertEquals("32", display.compactValueText)
        assertEquals("kWh", display.energyUnitLabel)
        assertEquals("32 kWh", display.compactContentDescription)
    }

    @Test
    fun efficiencyConvertsPerMeterToDisplayUnit() {
        assertEquals(150.0, EnergyStatsProjection.efficiencyDisplay(0.15, DistanceUnitPref.KM), 1e-9)
        assertEquals(241.4016, EnergyStatsProjection.efficiencyDisplay(0.15, DistanceUnitPref.MI), 1e-9)
        assertEquals("Wh/km", EnergyStatsProjection.efficiencyUnit(DistanceUnitPref.KM))
        assertEquals("Wh/mi", EnergyStatsProjection.efficiencyUnit(DistanceUnitPref.MI))

        val miles = project(EnergyStatsRegistration.defaultSize, DistanceUnitPref.MI)
        assertEquals(EnergyStatItem("Avg Efficiency", "241.4", "Wh/mi", EnergyStatIcon.Efficiency), miles.stats[2])
    }

    @Test
    fun emptyDataProjectsNoStatsAndEmptyMessage() {
        val display =
            EnergyStatsProjection.project(
                EnergyStatsData.EMPTY,
                EnergyStatsRegistration.defaultSize,
                strings,
                prefs(),
                Locale.US,
            )
        assertFalse(display.hasData)
        assertTrue(display.stats.isEmpty())
        assertFalse(display.hasChartData)
        assertTrue(display.chartPoints.isEmpty())
        assertEquals("No energy data available", display.emptyMessage)
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("energy-stats", EnergyStatsRegistration.ID)
        assertEquals("energy", EnergyStatsRegistration.CATEGORY)
        assertEquals("EnergyStatsWidget", EnergyStatsRegistration.SLUG)
        assertEquals(30, EnergyStatsRegistration.WINDOW_DAYS)
        assertEquals(EnergyStatsSize(cols = 2, rows = 4), EnergyStatsRegistration.defaultSize)
        assertEquals(EnergyStatsSize(cols = 1, rows = 2), EnergyStatsRegistration.minSize)
        assertEquals(EnergyStatsSize(cols = 4, rows = 40), EnergyStatsRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(EnergyStatsSize(cols = 4, rows = 40), EnergyStatsRegistration.clamp(EnergyStatsSize(9, 99)))
        assertEquals(EnergyStatsSize(cols = 1, rows = 2), EnergyStatsRegistration.clamp(EnergyStatsSize(0, 0)))
        assertTrue(EnergyStatsRegistration.isWithinBounds(EnergyStatsSize(2, 4)))
        assertFalse(EnergyStatsRegistration.isWithinBounds(EnergyStatsSize(5, 4)))
    }

    @Test
    fun compactAndWideBranchesFollowColumnCount() {
        assertTrue(EnergyStatsSize(cols = 1, rows = 4).isCompact)
        assertFalse(EnergyStatsSize(cols = 2, rows = 4).isCompact)
        assertTrue(EnergyStatsSize(cols = 3, rows = 4).isWide)
        assertFalse(EnergyStatsSize(cols = 2, rows = 4).isWide)
    }
}
