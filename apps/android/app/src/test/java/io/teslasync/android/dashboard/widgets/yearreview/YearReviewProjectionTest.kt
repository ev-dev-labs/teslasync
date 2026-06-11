package io.teslasync.android.dashboard.widgets.yearreview

import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the YearReviewWidget's pure logic — the raw-SI-JSON decode (incl. the nested
 * `longest_drive` + the `monthly_stats` array), the busiest-month `reduce`, the SI-kilometre → display-unit
 * distance conversion and SI-km/h → display speed conversion (the documented divergence from the web's
 * mile-floor arithmetic), the driving-time roll-up, the core / wide stat-grid + compact-hero projection
 * branches, the settings-derived display preferences, and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/YearReviewWidget.tsx).
 */
class YearReviewProjectionTest {
    private val strings =
        YearReviewStrings(
            title = "Year in Review",
            totalDistance = "Total Miles",
            totalDrives = "Total Drives",
            energyUsed = "Energy Used",
            co2Saved = "CO2 Saved",
            busiestMonth = "Best Month",
            longestDrive = "Longest Drive",
            drivingTime = "Driving Time",
            topSpeed = "Top Speed",
            inYear = "in {year}",
            noData = "No year-in-review data",
        )

    private val year = 2024

    private fun prefs(
        distance: DistanceUnitPref = DistanceUnitPref.KM,
        speed: SpeedUnitPref = SpeedUnitPref.KMH,
    ): YearReviewDisplayPrefs = YearReviewDisplayPrefs(distance, speed)

    private fun sampleJson() =
        buildJsonObject {
            put("total_drives", 320.0)
            put("total_distance_km", 10000.0)
            put("total_energy_kwh", 3456.7)
            put("co2_offset_kg", 1200.0)
            put("total_driving_minutes", 6000.0)
            put("fastest_speed_kmh", 200.0)
            putJsonObject("longest_drive") { put("distance_km", 500.0) }
            putJsonArray("monthly_stats") {
                add(monthStat(month = 1, drives = 10.0))
                add(monthStat(month = 3, drives = 25.0))
                add(monthStat(month = 7, drives = 25.0))
                add(monthStat(month = 11, drives = 5.0))
            }
        }

    private fun monthStat(
        month: Int,
        drives: Double,
    ) = buildJsonObject {
        put("month", month)
        put("drives", drives)
    }

    private fun project(
        json: kotlinx.serialization.json.JsonElement?,
        prefs: YearReviewDisplayPrefs = prefs(),
    ): YearReviewDisplay = YearReviewProjection.project(parseYearReview(json), prefs, strings, year, Locale.US)

    @Test
    fun parseNullPayloadIsNull() {
        assertNull(parseYearReview(null))
    }

    @Test
    fun parseNonObjectPayloadIsNull() {
        assertNull(parseYearReview(JsonNull))
        assertNull(parseYearReview(JsonPrimitive(42)))
    }

    @Test
    fun parseEmptyObjectIsNull() {
        // Web `data ?` is falsy for an absent payload; an empty object carries no recap → empty surface.
        assertNull(parseYearReview(buildJsonObject {}))
    }

    @Test
    fun parseReadsSnakeCaseSiFieldsIncludingNestedAndArray() {
        val data = parseYearReview(sampleJson())!!
        assertEquals(320.0, data.totalDrives, 0.0)
        assertEquals(10000.0, data.totalDistanceKm, 0.0)
        assertEquals(3456.7, data.totalEnergyKwh, 0.0)
        assertEquals(1200.0, data.co2OffsetKg, 0.0)
        assertEquals(6000.0, data.totalDrivingMinutes, 0.0)
        assertEquals(200.0, data.fastestSpeedKmh, 0.0)
        assertEquals(500.0, data.longestDriveKm, 0.0)
        assertEquals(4, data.monthlyStats.size)
        assertEquals(YearReviewMonthStat(3, 25.0), data.monthlyStats[1])
    }

    @Test
    fun parseTreatsMissingNumericsAndAbsentNestedAsZero() {
        val data = parseYearReview(buildJsonObject { put("total_drives", 5.0) })!!
        assertEquals(5.0, data.totalDrives, 0.0)
        assertEquals(0.0, data.totalDistanceKm, 0.0)
        assertEquals(0.0, data.fastestSpeedKmh, 0.0)
        assertEquals(0.0, data.longestDriveKm, 0.0)
        assertTrue(data.monthlyStats.isEmpty())
    }

    @Test
    fun populatedAllZeroPayloadStillProjectsContentNotEmpty() {
        // Unlike the lifetime surface there is no all-zero gate: a populated payload (web `data` truthy)
        // renders the grid even when every total is zero.
        val display = project(buildJsonObject { put("total_drives", 0.0) })
        assertTrue(display.hasData)
        assertEquals("0", display.coreStats[1].value)
    }

    @Test
    fun coreStatsFormatAllSixTiles() {
        val core = project(sampleJson()).coreStats
        assertEquals(6, core.size)
        assertEquals(YearReviewStatItem("Total Miles", "10,000", "km", YearReviewStatIcon.Distance), core[0])
        assertEquals(YearReviewStatItem("Total Drives", "320", null, YearReviewStatIcon.Drives), core[1])
        assertEquals(YearReviewStatItem("Energy Used", "3,456.7", "kWh", YearReviewStatIcon.Energy), core[2])
        assertEquals(YearReviewStatItem("CO2 Saved", "1,200", "kg", YearReviewStatIcon.Co2), core[3])
        assertEquals(YearReviewStatItem("Best Month", "Mar", null, YearReviewStatIcon.BestMonth), core[4])
        assertEquals(YearReviewStatItem("Longest Drive", "500.0", "km", YearReviewStatIcon.LongestDrive), core[5])
    }

    @Test
    fun wideStatsFormatDrivingTimeAndTopSpeed() {
        val wide = project(sampleJson()).wideStats
        assertEquals(2, wide.size)
        // 6000 minutes / 60 = 100 h.
        assertEquals(YearReviewStatItem("Driving Time", "100", "h", YearReviewStatIcon.DrivingTime), wide[0])
        assertEquals(YearReviewStatItem("Top Speed", "200", "km/h", YearReviewStatIcon.TopSpeed), wide[1])
    }

    @Test
    fun statsForFoldsInTheExtrasOnlyWhenWide() {
        val display = project(sampleJson())
        assertEquals(6, display.statsFor(wide = false).size)
        assertEquals(8, display.statsFor(wide = true).size)
        assertEquals(display.coreStats + display.wideStats, display.statsFor(wide = true))
    }

    @Test
    fun compactHeroUsesYearDistanceAndCaption() {
        val display = project(sampleJson())
        assertTrue(display.hasData)
        assertEquals(10000.0, display.compactValue, 1e-6)
        assertEquals("km", display.compactUnit)
        assertEquals("km in 2024", display.compactCaption)
        assertEquals("10,000 km in 2024", display.compactContentDescription)
    }

    @Test
    fun titleAppendsTheYear() {
        assertEquals("Year in Review 2024", project(sampleJson()).title)
        // The title is present on the empty surface too (the header always renders).
        assertEquals("Year in Review 2024", project(null).title)
    }

    @Test
    fun distanceFloorsOnSiMetresNotTheWebMileArithmetic() {
        // Parity note: the web converts `total_distance_km * KM_TO_MI` through a metre-expecting converter
        // (under-reporting); the native bridges km → m → display unit, the correct result.
        val km = project(sampleJson(), prefs(DistanceUnitPref.KM))
        assertEquals("10,000", km.coreStats[0].value)
        assertEquals("500.0", km.coreStats[5].value)

        val mi = project(sampleJson(), prefs(DistanceUnitPref.MI))
        // 10,000 km == 10,000,000 m / 1609.344 == 6213.71 mi; 500 km == 310.7 mi.
        assertEquals(6213.71, YearReviewProjection.toDisplayDistance(10_000_000.0, DistanceUnitPref.MI), 0.01)
        assertEquals("6,214", mi.coreStats[0].value)
        assertEquals("mi", mi.coreStats[0].unit)
        assertEquals("310.7", mi.coreStats[5].value)
    }

    @Test
    fun speedFloorsOnSiNotTheWebMileArithmetic() {
        // 200 km/h bridged to m/s (÷3.6) then converted: km/h → "200", mph → 200 * 0.621371 ≈ "124".
        val kmh = project(sampleJson(), prefs(speed = SpeedUnitPref.KMH))
        assertEquals("200", kmh.wideStats[1].value)
        assertEquals("km/h", kmh.wideStats[1].unit)

        val mph = project(sampleJson(), prefs(speed = SpeedUnitPref.MPH))
        assertEquals(124.27, YearReviewProjection.toDisplaySpeed(200.0 * 1000.0 / 3600.0, SpeedUnitPref.MPH), 0.01)
        assertEquals("124", mph.wideStats[1].value)
        assertEquals("mph", mph.wideStats[1].unit)
    }

    @Test
    fun drivingTimeRoundsMinutesToWholeHours() {
        // 6090 minutes / 60 = 101.5 → rounds half-up to 102 (web `Math.round`).
        val json = buildJsonObject { put("total_driving_minutes", 6090.0) }
        assertEquals("102", project(json).wideStats[0].value)
    }

    @Test
    fun busiestMonthPicksMostDrivesFirstWinningTies() {
        // Months 3 and 7 both have 25 drives; the first (March) wins, matching the web `reduce` (strict >).
        assertEquals("Mar", YearReviewProjection.busiestMonth(parseYearReview(sampleJson())!!.monthlyStats))
    }

    @Test
    fun busiestMonthHandlesEmptyAndOutOfRange() {
        assertEquals("\u2014", YearReviewProjection.busiestMonth(emptyList()))
        assertEquals("Dec", YearReviewProjection.busiestMonth(listOf(YearReviewMonthStat(12, 3.0))))
        assertEquals("\u2014", YearReviewProjection.busiestMonth(listOf(YearReviewMonthStat(0, 3.0))))
    }

    @Test
    fun nullDataProjectsEmptyMessageAndNoStats() {
        val display = project(null)
        assertFalse(display.hasData)
        assertEquals(0.0, display.compactValue, 0.0)
        assertEquals("No year-in-review data", display.emptyMessage)
        assertTrue(display.coreStats.isEmpty())
        assertTrue(display.wideStats.isEmpty())
    }

    @Test
    fun displayPrefsResolveFromSettings() {
        assertEquals(YearReviewDisplayPrefs.METRIC_DEFAULT, YearReviewDisplayPrefs.fromSettings(null))

        val imperial = YearReviewDisplayPrefs.fromSettings(buildJsonObject { put("unit_of_length", "mi") })
        assertEquals(YearReviewDisplayPrefs(DistanceUnitPref.MI, SpeedUnitPref.MPH), imperial)

        val metric = YearReviewDisplayPrefs.fromSettings(buildJsonObject { put("unit_of_length", "km") })
        assertEquals(YearReviewDisplayPrefs(DistanceUnitPref.KM, SpeedUnitPref.KMH), metric)
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("year-review", YearReviewRegistration.ID)
        assertEquals("analytics", YearReviewRegistration.CATEGORY)
        assertEquals("YearReviewWidget", YearReviewRegistration.SLUG)
        assertEquals(YearReviewSize(cols = 2, rows = 4), YearReviewRegistration.defaultSize)
        assertEquals(YearReviewSize(cols = 2, rows = 4), YearReviewRegistration.minSize)
        assertEquals(YearReviewSize(cols = 4, rows = 40), YearReviewRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(YearReviewSize(cols = 4, rows = 40), YearReviewRegistration.clamp(YearReviewSize(9, 99)))
        assertEquals(YearReviewSize(cols = 2, rows = 4), YearReviewRegistration.clamp(YearReviewSize(0, 0)))
        assertTrue(YearReviewRegistration.isWithinBounds(YearReviewSize(2, 4)))
        assertFalse(YearReviewRegistration.isWithinBounds(YearReviewSize(5, 4)))
    }

    @Test
    fun sizeBranchesFollowColumnCount() {
        assertTrue(YearReviewSize(cols = 1, rows = 4).isCompact)
        assertFalse(YearReviewSize(cols = 2, rows = 4).isCompact)
        assertFalse(YearReviewSize(cols = 2, rows = 4).isWide)
        assertTrue(YearReviewSize(cols = 3, rows = 4).isWide)
        assertTrue(YearReviewSize(cols = 4, rows = 4).isWide)
    }

    @Test
    fun emptyMonthlyStatsYieldEmDashBestMonth() {
        val json =
            buildJsonObject {
                put("total_distance_km", 100.0)
                putJsonArray("monthly_stats") {}
            }
        assertEquals("\u2014", project(json).coreStats[4].value)
    }

    @Test
    fun arrayAndObjectGuardsTolerateMalformedMonthlyRows() {
        // A non-object monthly row is skipped (web optional-chaining); the remaining rows still reduce.
        val json =
            buildJsonObject {
                put("total_distance_km", 100.0)
                put(
                    "monthly_stats",
                    buildJsonArray {
                        add(JsonPrimitive("garbage"))
                        add(monthStat(month = 6, drives = 9.0))
                    },
                )
            }
        assertEquals("Jun", project(json).coreStats[4].value)
    }
}
