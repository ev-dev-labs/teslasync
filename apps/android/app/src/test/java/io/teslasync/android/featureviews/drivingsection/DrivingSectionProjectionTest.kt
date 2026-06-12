package io.teslasync.android.featureviews.drivingsection

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the DrivingSection's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/analytics/components/weekly-digest/DrivingSection.tsx): the
 * `fmtNumber` / `fmtInt` locale-grouped formatting with the `safeNumber` non-finite guard, the
 * `Math.floor(totalDuration / 60)` + `totalDuration % 60` duration split, the `pctChange` helper, the
 * `prevAvgEfficiency > 0 ? … : '—'` efficiency-change guard, the `avgEfficiency <= prevAvgEfficiency` trend
 * direction, the `formatDate` localized date (with its blank/invalid em-dash fallback), and the formatted
 * Top-Drive fields. Because the surface is purely presentational, each [DrivingSectionDisplay] field is
 * exactly what the thin composable renders, so these assertions double as the per-state "snapshot" of the
 * populated and empty branches. A fixed [Locale.US] / UTC keeps the grouping + date deterministic. Runs in
 * the :android:testReleaseUnitTest gate.
 */
class DrivingSectionProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }
    private val locale = Locale.US
    private val zone = ZoneId.of("UTC")

    private val baseData =
        DrivingSectionData(
            avgEfficiency = 168.4,
            prevAvgEfficiency = 175.0,
            totalDuration = 372.0,
            totalDrives = 14.0,
            topDrive =
                DrivingTopDrive(
                    startDate = "2026-03-14",
                    distance = 182.6,
                    durationMin = 145.0,
                    efficiencyWhKm = 158.2,
                ),
            dailyDistanceData =
                listOf(
                    DailyDistanceEntry("Mon", 42.0),
                    DailyDistanceEntry("Sat", 120.4),
                ),
        )

    // ── The empty week: zeros + the em-dash change + no top drive (web body with all-zero metrics) ──

    @Test
    fun emptyWeekProjectsZeroMetricsAndNoTopDrive() {
        val display = DrivingSectionProjection.project(DrivingSectionData.EMPTY, locale, zone)

        assertEquals("0.0 Wh/km", display.avgEfficiency)
        assertEquals("0h 0m", display.totalDrivingTime)
        // prevAvgEfficiency == 0 -> the em dash (nothing to compare against).
        assertEquals(DRIVING_SECTION_EM_DASH, display.efficiencyChange)
        // 0 <= 0 -> improved (the web emerald TrendingDown branch).
        assertEquals(EfficiencyTrend.Improved, display.efficiencyTrend)
        assertEquals("0", display.drives)
        assertEquals(false, display.hasDailyDistance)
        assertNull(display.topDrive)
    }

    // ── Populated metrics: formatted strings, trend, and the bar points ─────────────────────────────

    @Test
    fun populatedWeekFormatsEveryMetricString() {
        val display = DrivingSectionProjection.project(baseData, locale, zone)

        assertEquals("168.4 Wh/km", display.avgEfficiency)
        // floor(372/60)=6, 372%60=12 -> "6h 12m" (web always shows the hour segment, even under an hour).
        assertEquals("6h 12m", display.totalDrivingTime)
        // pctChange(168.4, 175.0) = -3.771… -> fmtNumber(_, 1) -> "-3.8".
        assertEquals("-3.8%", display.efficiencyChange)
        assertEquals(EfficiencyTrend.Improved, display.efficiencyTrend)
        assertEquals("14", display.drives)
    }

    @Test
    fun dailyDistanceBarsPassThroughInOrder() {
        val display = DrivingSectionProjection.project(baseData, locale, zone)

        assertEquals(true, display.hasDailyDistance)
        assertEquals(listOf("Mon", "Sat"), display.dayLabels)
        assertEquals(listOf(42.0, 120.4), display.distanceValues)
    }

    // ── Trend direction: lower Wh/km is better (web `avgEfficiency <= prevAvgEfficiency`) ───────────

    @Test
    fun trendIsImprovedWhenEfficiencyHeldOrFell() {
        assertEquals(EfficiencyTrend.Improved, DrivingSectionProjection.efficiencyTrend(150.0, 175.0))
        assertEquals(EfficiencyTrend.Improved, DrivingSectionProjection.efficiencyTrend(175.0, 175.0))
    }

    @Test
    fun trendIsWorsenedWhenEfficiencyRose() {
        assertEquals(EfficiencyTrend.Worsened, DrivingSectionProjection.efficiencyTrend(180.0, 175.0))
    }

    // ── Efficiency change: the web `prevAvgEfficiency > 0 ? `${pct}%` : '—'` guard ──────────────────

    @Test
    fun efficiencyChangeShowsEmDashWithoutAPriorBaseline() {
        assertEquals(DRIVING_SECTION_EM_DASH, DrivingSectionProjection.efficiencyChange(160.0, 0.0, locale))
    }

    @Test
    fun efficiencyChangeFormatsAPositivePercentWhenWorsened() {
        // pctChange(180, 175) = (5/175)*100 = 2.857… -> "2.9%".
        assertEquals("2.9%", DrivingSectionProjection.efficiencyChange(180.0, 175.0, locale))
    }

    // ── pctChange: the web helper verbatim (web/.../weekly-digest/helpers.ts) ────────────────────────

    @Test
    fun pctChangeHandlesTheZeroBaselineSentinels() {
        assertEquals(100.0, DrivingSectionProjection.pctChange(5.0, 0.0), 0.0)
        assertEquals(0.0, DrivingSectionProjection.pctChange(0.0, 0.0), 0.0)
        assertEquals(0.0, DrivingSectionProjection.pctChange(-3.0, 0.0), 0.0)
    }

    @Test
    fun pctChangeUsesTheAbsoluteBaseline() {
        assertEquals(-100.0, DrivingSectionProjection.pctChange(0.0, 5.0), 1e-9)
        assertEquals(20.0, DrivingSectionProjection.pctChange(6.0, 5.0), 1e-9)
    }

    // ── Total driving time: web `${fmtInt(floor(d/60))}h ${fmtInt(d%60)}m`, locale-grouped ──────────

    @Test
    fun totalDrivingTimeSplitsHoursAndMinutes() {
        assertEquals("0h 45m", DrivingSectionProjection.totalDrivingTime(45.0, locale))
        assertEquals("2h 5m", DrivingSectionProjection.totalDrivingTime(125.0, locale))
        assertEquals("25h 0m", DrivingSectionProjection.totalDrivingTime(1500.0, locale))
    }

    @Test
    fun totalDrivingTimeGroupsLargeHourCounts() {
        // 60000 min -> floor(1000)h -> "1,000h 0m" (locale grouping, exactly like the web fmtInt).
        assertEquals("1,000h 0m", DrivingSectionProjection.totalDrivingTime(60_000.0, locale))
    }

    // ── fmtNumber / fmtInt: locale grouping, fixed precision, and the safeNumber non-finite guard ───

    @Test
    fun fmtNumberGroupsThousandsAndFixesFractionDigits() {
        assertEquals("1,234.5", DrivingSectionProjection.fmtNumber(1234.5, 1, locale))
        assertEquals("168.4", DrivingSectionProjection.fmtNumber(168.4, 1, locale))
    }

    @Test
    fun fmtIntRoundsAndGroups() {
        assertEquals("14", DrivingSectionProjection.fmtInt(14.0, locale))
        assertEquals("1,234", DrivingSectionProjection.fmtInt(1234.0, locale))
    }

    @Test
    fun nonFiniteValuesFoldToZeroLikeSafeNumber() {
        assertEquals("0.0", DrivingSectionProjection.fmtNumber(Double.NaN, 1, locale))
        assertEquals("0.0", DrivingSectionProjection.fmtNumber(Double.POSITIVE_INFINITY, 1, locale))
        assertEquals("0", DrivingSectionProjection.fmtInt(Double.NEGATIVE_INFINITY, locale))
    }

    // ── formatDate: localized medium date, em dash for blank / unparseable (web `formatDate`) ───────

    @Test
    fun formatDateRendersALocalizedMediumDate() {
        assertEquals("Mar 14, 2026", DrivingSectionProjection.formatDate("2026-03-14", locale, zone))
    }

    @Test
    fun formatDateToleratesAFullIsoTimestamp() {
        assertEquals("Mar 14, 2026", DrivingSectionProjection.formatDate("2026-03-14T08:30:00Z", locale, zone))
    }

    @Test
    fun formatDateFallsBackToAnEmDashForBlankOrInvalidInput() {
        assertEquals(DRIVING_SECTION_EM_DASH, DrivingSectionProjection.formatDate("", locale, zone))
        assertEquals(DRIVING_SECTION_EM_DASH, DrivingSectionProjection.formatDate("   ", locale, zone))
        assertEquals(DRIVING_SECTION_EM_DASH, DrivingSectionProjection.formatDate("not-a-date", locale, zone))
    }

    // ── Top-Drive card: the four formatted fields (web `formatDate` + `fmtNumber`/`fmtInt` + units) ──

    @Test
    fun projectsTheTopDriveCardFields() {
        val display = DrivingSectionProjection.project(baseData, locale, zone)
        val top = requireNotNull(display.topDrive)

        assertEquals("Mar 14, 2026", top.date)
        assertEquals("182.6 km", top.distance)
        assertEquals("145 min", top.duration)
        assertEquals("158.2 Wh/km", top.efficiency)
    }

    // ── Data adapter: decode the cached snake_case projection (extra columns ignored) and project ───

    @Test
    fun projectsStraightOffTheCachedJsonIgnoringUnknownColumns() {
        val json =
            """
            {
              "avg_efficiency": 168.4,
              "prev_avg_efficiency": 175.0,
              "total_duration": 372,
              "total_drives": 14,
              "top_drive": {
                "start_date": "2026-03-14",
                "distance": 182.6,
                "duration_min": 145,
                "efficiency_wh_km": 158.2,
                "energy_used": 28900,
                "id": 4071
              },
              "daily_distance": [
                { "day": "Mon", "distance": 42.0 },
                { "day": "Sat", "distance": 120.4 }
              ],
              "co2_saved": 11.2,
              "alert_total": 0
            }
            """.trimIndent()

        val decoded = lenientJson.decodeFromString<DrivingSectionData>(json)

        assertEquals(168.4, decoded.avgEfficiency, 0.0)
        assertEquals(14.0, decoded.totalDrives, 0.0)
        assertEquals("2026-03-14", requireNotNull(decoded.topDrive).startDate)
        assertEquals(2, decoded.dailyDistanceData.size)

        val display = DrivingSectionProjection.project(decoded, locale, zone)
        assertEquals("168.4 Wh/km", display.avgEfficiency)
        assertEquals("6h 12m", display.totalDrivingTime)
        assertEquals("-3.8%", display.efficiencyChange)
        assertEquals("14", display.drives)
        assertEquals("182.6 km", requireNotNull(display.topDrive).distance)
        assertEquals(listOf("Mon", "Sat"), display.dayLabels)
    }
}
