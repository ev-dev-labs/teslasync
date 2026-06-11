package io.teslasync.android.dashboard.widgets.mileagestats

import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the MileageStatsWidget's pure logic — the raw kilometre-JSON decode, the
 * SI-kilometre → display-unit distance conversion (web `toDistanceDisplay` = `convertDistanceFromSI`),
 * the daily/weekly/monthly averages, the milestone + months-to-milestone projection, the compact hero +
 * TalkBack content description, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/MileageStatsWidget.tsx).
 */
class MileageStatsProjectionTest {
    private val strings =
        MileageStatsStrings(
            title = "Mileage Stats",
            dailyAvg = "Daily Avg",
            weeklyAvg = "Weekly Avg",
            monthlyAvg = "Monthly Avg",
            nextMilestone = "Next Milestone",
            inMonths = "~%1\$s mo",
            day = "day",
            noData = "No mileage data",
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

    private fun sampleJson(
        lifetimeKm: Double,
        last30dKm: Double,
    ) = buildJsonObject {
        put("vehicle_id", 5)
        put("lifetime_km", lifetimeKm)
        put("last_7d_km", last30dKm / 4)
        put("last_30d_km", last30dKm)
        put("last_365d_km", lifetimeKm)
        put("drive_count_lifetime", 100)
        put("drive_count_30d", 12)
    }

    private fun project(
        size: MileageStatsSize,
        lifetimeKm: Double = 50_000.0,
        last30dKm: Double = 1_500.0,
        distance: DistanceUnitPref = DistanceUnitPref.KM,
    ): MileageStatsDisplay =
        MileageStatsProjection.project(
            parseMileageStats(sampleJson(lifetimeKm, last30dKm)),
            size,
            strings,
            prefs(distance),
            Locale.US,
        )

    @Test
    fun parseNullPayloadIsEmpty() {
        val data = parseMileageStats(null)
        assertFalse(data.hasData)
        assertEquals(0.0, data.lifetimeKm, 0.0)
        assertEquals(0.0, data.last30dKm, 0.0)
    }

    @Test
    fun parseEmptyObjectIsEmpty() {
        assertFalse(parseMileageStats(buildJsonObject { }).hasData)
    }

    @Test
    fun parseReadsSnakeCaseKilometreFields() {
        val data = parseMileageStats(sampleJson(50_000.0, 1_500.0))
        assertTrue(data.hasData)
        assertEquals(50_000.0, data.lifetimeKm, 0.0)
        assertEquals(1_500.0, data.last30dKm, 0.0)
    }

    @Test
    fun parseTreatsMissingNumericsAsZero() {
        val data = parseMileageStats(buildJsonObject { put("vehicle_id", 7) })
        assertTrue(data.hasData)
        assertEquals(0.0, data.lifetimeKm, 0.0)
        assertEquals(0.0, data.last30dKm, 0.0)
    }

    @Test
    fun standardStatsAreFourMetricTilesInKilometres() {
        val display = project(MileageStatsRegistration.defaultSize)
        assertTrue(display.hasData)
        assertFalse(display.isCompact)
        assertEquals(2, display.statGridColumns)
        assertEquals(
            listOf(
                MileageStatItem("Daily Avg", "50.0", "km", MileageStatIcon.DailyAvg),
                MileageStatItem("Weekly Avg", "350", "km", MileageStatIcon.WeeklyAvg),
                MileageStatItem("Monthly Avg", "1,500", "km", MileageStatIcon.MonthlyAvg),
                MileageStatItem(
                    label = "Next Milestone",
                    value = "60,000",
                    unit = "km",
                    icon = MileageStatIcon.NextMilestone,
                    trend = MileageStatTrend(MileageTrendDirection.Up, "~7 mo"),
                ),
            ),
            display.stats,
        )
    }

    @Test
    fun milesConvertDistanceUnitAndProjection() {
        val display = project(MileageStatsRegistration.defaultSize, distance = DistanceUnitPref.MI)
        assertEquals(
            listOf(
                MileageStatItem("Daily Avg", "31.1", "mi", MileageStatIcon.DailyAvg),
                MileageStatItem("Weekly Avg", "217", "mi", MileageStatIcon.WeeklyAvg),
                MileageStatItem("Monthly Avg", "932", "mi", MileageStatIcon.MonthlyAvg),
                MileageStatItem(
                    label = "Next Milestone",
                    value = "40,000",
                    unit = "mi",
                    icon = MileageStatIcon.NextMilestone,
                    trend = MileageStatTrend(MileageTrendDirection.Up, "~10 mo"),
                ),
            ),
            display.stats,
        )
    }

    @Test
    fun compactHeroUsesDailyAverage() {
        val display = project(MileageStatsRegistration.minSize)
        assertTrue(display.isCompact)
        assertEquals(50.0, display.compactDailyAvg, 1e-9)
        assertEquals("50", display.compactValueText)
        assertEquals("km", display.distanceUnitLabel)
        assertEquals("km/day", display.compactUnitLabel)
        assertEquals("50 km/day", display.compactContentDescription)
    }

    @Test
    fun zeroAverageProjectsZerosAndEmDashMilestoneTrend() {
        val display = project(MileageStatsRegistration.defaultSize, lifetimeKm = 0.0, last30dKm = 0.0)
        assertEquals(
            listOf(
                MileageStatItem("Daily Avg", "0.0", "km", MileageStatIcon.DailyAvg),
                MileageStatItem("Weekly Avg", "0", "km", MileageStatIcon.WeeklyAvg),
                MileageStatItem("Monthly Avg", "0", "km", MileageStatIcon.MonthlyAvg),
                MileageStatItem(
                    label = "Next Milestone",
                    value = "10,000",
                    unit = "km",
                    icon = MileageStatIcon.NextMilestone,
                    trend = MileageStatTrend(MileageTrendDirection.Up, "\u2014"),
                ),
            ),
            display.stats,
        )
    }

    @Test
    fun emptyDataProjectsNoStatsAndEmptyMessage() {
        val display =
            MileageStatsProjection.project(
                MileageStatsData.EMPTY,
                MileageStatsRegistration.defaultSize,
                strings,
                prefs(),
                Locale.US,
            )
        assertFalse(display.hasData)
        assertTrue(display.stats.isEmpty())
        assertEquals("No mileage data", display.emptyMessage)
    }

    @Test
    fun milestoneAndMonthsHelpersMatchWebMath() {
        assertEquals(60_000.0, MileageStatsProjection.nextMilestone(50_000.0), 0.0)
        assertEquals(10_000.0, MileageStatsProjection.nextMilestone(0.0), 0.0)
        // Exact multiples still round up to the *next* milestone (web `ceil((total + 1) / step)`).
        assertEquals(20_000.0, MileageStatsProjection.nextMilestone(10_000.0), 0.0)
        assertEquals(7, MileageStatsProjection.monthsToMilestone(remaining = 10_000.0, dailyAvg = 50.0))
        assertEquals(0, MileageStatsProjection.monthsToMilestone(remaining = 10_000.0, dailyAvg = 0.0))
        // Web `Math.max(1, ...)` floor: a sub-month projection clamps to at least one month.
        assertEquals(1, MileageStatsProjection.monthsToMilestone(remaining = 5.0, dailyAvg = 1_000.0))
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("mileage-stats", MileageStatsRegistration.ID)
        assertEquals("analytics", MileageStatsRegistration.CATEGORY)
        assertEquals("MileageStatsWidget", MileageStatsRegistration.SLUG)
        assertEquals(MileageStatsSize(cols = 2, rows = 2), MileageStatsRegistration.defaultSize)
        assertEquals(MileageStatsSize(cols = 1, rows = 2), MileageStatsRegistration.minSize)
        assertEquals(MileageStatsSize(cols = 4, rows = 40), MileageStatsRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(MileageStatsSize(cols = 4, rows = 40), MileageStatsRegistration.clamp(MileageStatsSize(9, 99)))
        assertEquals(MileageStatsSize(cols = 1, rows = 2), MileageStatsRegistration.clamp(MileageStatsSize(0, 0)))
        assertTrue(MileageStatsRegistration.isWithinBounds(MileageStatsSize(2, 2)))
        assertFalse(MileageStatsRegistration.isWithinBounds(MileageStatsSize(5, 2)))
    }

    @Test
    fun compactBranchFollowsColumnCount() {
        assertTrue(MileageStatsSize(cols = 1, rows = 2).isCompact)
        assertFalse(MileageStatsSize(cols = 2, rows = 2).isCompact)
    }
}
