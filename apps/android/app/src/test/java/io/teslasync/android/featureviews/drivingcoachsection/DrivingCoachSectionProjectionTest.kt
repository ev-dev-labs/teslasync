package io.teslasync.android.featureviews.drivingcoachsection

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the DrivingCoachSection's pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/driving/components/driving-dynamics/DrivingCoachSection.tsx): the
 * clamped overall score + its `>= 75 / >= 50` color band, the `Number.isInteger ? 0 : precision` gauge
 * decimals, the `fmtNumber` locale-grouped efficiency strings with the `safeNumber` non-finite guard, the
 * `(count / total) * 100` style segments (zeros dropped) + the always-three-row legend, the `weekly_trend.length
 * > 1` gate, the five pattern bars with the lo/hi threshold tones, the `impact === 'high' ? danger : …` mapping,
 * and the per-drive rows (formatted cells + the raw comparables the sortable table orders on). A fixed
 * [Locale.US] / UTC keeps grouping + dates deterministic. Runs in the :android:testReleaseUnitTest gate.
 */
class DrivingCoachSectionProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }
    private val locale = Locale.US
    private val zone = ZoneId.of("UTC")

    private val baseData =
        DrivingCoachData(
            overallScore = 82.0,
            efficiencyWhKm = 168.4,
            bestEfficiencyWhKm = 152.1,
            totalDrivesAnalyzed = 37.0,
            styleBreakdown = mapOf("efficient" to 20.0, "moderate" to 12.0, "aggressive" to 5.0),
            patterns =
                CoachPatterns(
                    hardAccelPct = 18.0,
                    hardBrakePct = 22.0,
                    highwayPct = 61.0,
                    shortTripPct = 44.0,
                    coldStartPct = 9.0,
                ),
            weeklyTrend =
                listOf(
                    CoachWeeklyTrend(week = "W1", score = 71.0),
                    CoachWeeklyTrend(week = "W2", score = 78.0),
                    CoachWeeklyTrend(week = "W3", score = 82.0),
                ),
            recommendations =
                listOf(
                    CoachRecommendation(category = "braking", impact = "high", tip = "Brake earlier."),
                    CoachRecommendation(category = "trips", impact = "low", tip = "Combine short errands."),
                ),
            perDriveScores =
                listOf(
                    CoachDriveScore(
                        driveId = 1,
                        date = "2026-03-14",
                        score = 88.0,
                        style = "efficient",
                        efficiency = 151.2,
                        distance = 42.6,
                    ),
                    CoachDriveScore(
                        driveId = 2,
                        date = "2026-03-12",
                        score = 64.0,
                        style = "moderate",
                        efficiency = 178.9,
                        distance = 12.1,
                    ),
                ),
        )

    // ── The empty coach: zeros + the internal empty-state gates (web body with `coachData` undefined) ────────

    @Test
    fun emptyCoachProjectsZerosAndInternalEmptyGates() {
        val display = DrivingCoachProjection.project(DrivingCoachData.EMPTY, locale, zone)

        assertEquals(0.0, display.scoreValue, 0.0)
        assertEquals(0, display.scoreDecimals)
        assertEquals(CoachTone.Danger, display.scoreTone)
        assertEquals("0", display.drivesAnalyzedCountText)
        assertEquals("0.00 Wh/km", display.avgEfficiencyText)
        assertEquals("0.00 Wh/km", display.bestEfficiencyText)
        // Internal empty-state gates: every sub-section falls back rather than hiding.
        assertFalse(display.hasStyleData)
        assertTrue(display.styleSegments.isEmpty())
        assertFalse(display.hasWeeklyTrend)
        assertFalse(display.hasRecommendations)
        assertFalse(display.hasPerDriveScores)
        // The legend still lists all three styles, each at zero (web fixed-array map).
        assertEquals(listOf("0", "0", "0"), display.styleLegend.map { it.countText })
    }

    // ── Populated metrics: clamped score, decimals, color band, formatted efficiency ─────────────────────────

    @Test
    fun populatedCoachFormatsScoreAndEfficiency() {
        val display = DrivingCoachProjection.project(baseData, locale, zone)

        assertEquals(82.0, display.scoreValue, 0.0)
        // 82 is a whole number -> 0 gauge decimals (web `Number.isInteger(clamped) ? 0 : precision`).
        assertEquals(0, display.scoreDecimals)
        assertEquals(CoachTone.Success, display.scoreTone)
        assertEquals("37", display.drivesAnalyzedCountText)
        assertEquals("168.40 Wh/km", display.avgEfficiencyText)
        assertEquals("152.10 Wh/km", display.bestEfficiencyText)
    }

    @Test
    fun scoreIsClampedAndUsesPrecisionWhenFractional() {
        val display = DrivingCoachProjection.project(DrivingCoachData(overallScore = 142.5), locale, zone)
        // Web `Math.max(0, Math.min(value, max))` clamps 142.5 to the 100 max; 100 is whole -> 0 decimals.
        assertEquals(100.0, display.scoreValue, 0.0)
        assertEquals(0, display.scoreDecimals)

        val fractional = DrivingCoachProjection.project(DrivingCoachData(overallScore = 63.5), locale, zone)
        assertEquals(63.5, fractional.scoreValue, 0.0)
        assertEquals(2, fractional.scoreDecimals)
    }

    // ── Threshold bands: the web `>= 75 / >= 50` ternary, verbatim ────────────────────────────────────────────

    @Test
    fun scoreToneCrossesAtSeventyFiveAndFifty() {
        assertEquals(CoachTone.Success, DrivingCoachProjection.scoreTone(75.0))
        assertEquals(CoachTone.Warning, DrivingCoachProjection.scoreTone(74.9))
        assertEquals(CoachTone.Warning, DrivingCoachProjection.scoreTone(50.0))
        assertEquals(CoachTone.Danger, DrivingCoachProjection.scoreTone(49.9))
    }

    @Test
    fun driveScoreToneMatchesTheGaugeBands() {
        assertEquals(CoachTone.Success, DrivingCoachProjection.driveScoreTone(90.0))
        assertEquals(CoachTone.Warning, DrivingCoachProjection.driveScoreTone(60.0))
        assertEquals(CoachTone.Danger, DrivingCoachProjection.driveScoreTone(30.0))
    }

    @Test
    fun styleToneMapsTheThreeCategoriesAndDefaultsUnknownToDanger() {
        assertEquals(CoachTone.Success, DrivingCoachProjection.styleTone("efficient"))
        assertEquals(CoachTone.Warning, DrivingCoachProjection.styleTone("moderate"))
        assertEquals(CoachTone.Danger, DrivingCoachProjection.styleTone("aggressive"))
        assertEquals(CoachTone.Danger, DrivingCoachProjection.styleTone("unknown"))
    }

    @Test
    fun impactToneFollowsTheSectionMappingNotTheWidget() {
        // Section source: high -> danger, medium -> warning, low (and anything else) -> success.
        assertEquals(CoachTone.Danger, DrivingCoachProjection.impactTone("high"))
        assertEquals(CoachTone.Warning, DrivingCoachProjection.impactTone("medium"))
        assertEquals(CoachTone.Success, DrivingCoachProjection.impactTone("low"))
        assertEquals(CoachTone.Success, DrivingCoachProjection.impactTone(""))
    }

    @Test
    fun patternToneUsesEachKindsLoHiBounds() {
        // HardAccel lo=20, hi=40.
        assertEquals(CoachTone.Success, DrivingCoachProjection.patternTone(20.0, CoachPatternKind.HardAccel))
        assertEquals(CoachTone.Warning, DrivingCoachProjection.patternTone(40.0, CoachPatternKind.HardAccel))
        assertEquals(CoachTone.Danger, DrivingCoachProjection.patternTone(40.1, CoachPatternKind.HardAccel))
        // Highway lo=50, hi=70 — a different band than HardAccel for the same value.
        assertEquals(CoachTone.Success, DrivingCoachProjection.patternTone(50.0, CoachPatternKind.Highway))
        assertEquals(CoachTone.Warning, DrivingCoachProjection.patternTone(70.0, CoachPatternKind.Highway))
    }

    // ── Style breakdown: proportional segments (zeros dropped) + the formatted per-section bars ─────────────

    @Test
    fun styleSegmentsAreProportionalInFixedOrder() {
        val display = DrivingCoachProjection.project(baseData, locale, zone)

        assertTrue(display.hasStyleData)
        assertEquals(
            listOf(CoachStyle.Efficient, CoachStyle.Moderate, CoachStyle.Aggressive),
            display.styleSegments.map { it.style },
        )
        // 20 / 37 * 100, 12 / 37 * 100, 5 / 37 * 100.
        assertEquals(54.054f, display.styleSegments[0].weight, 0.01f)
        assertEquals(32.432f, display.styleSegments[1].weight, 0.01f)
        assertEquals(13.513f, display.styleSegments[2].weight, 0.01f)
        assertEquals(listOf("20", "12", "5"), display.styleLegend.map { it.countText })
    }

    @Test
    fun styleSegmentsDropZeroShares() {
        val data = DrivingCoachData(totalDrivesAnalyzed = 10.0, styleBreakdown = mapOf("efficient" to 10.0))
        val display = DrivingCoachProjection.project(data, locale, zone)
        // Only the non-zero efficient share renders a segment (web `if (pct <= 0) return null`).
        assertEquals(listOf(CoachStyle.Efficient), display.styleSegments.map { it.style })
        assertEquals(100f, display.styleSegments.single().weight, 0.01f)
        // The legend still lists all three categories.
        assertEquals(3, display.styleLegend.size)
    }

    @Test
    fun patternBarsCarryValueToneAndFormattedText() {
        val display = DrivingCoachProjection.project(baseData, locale, zone)
        val byKind = display.patterns.associateBy { it.kind }

        assertEquals(5, display.patterns.size)
        assertEquals(CoachTone.Success, byKind.getValue(CoachPatternKind.HardAccel).tone) // 18 <= 20
        assertEquals("18.00%", byKind.getValue(CoachPatternKind.HardAccel).valueText)
        assertEquals(CoachTone.Warning, byKind.getValue(CoachPatternKind.HardBrake).tone) // 15 < 22 <= 30
        assertEquals(CoachTone.Warning, byKind.getValue(CoachPatternKind.Highway).tone) // 50 < 61 <= 70
        assertEquals(CoachTone.Success, byKind.getValue(CoachPatternKind.ColdStarts).tone) // 9 <= 15
    }

    // ── Weekly trend gate: web `weekly_trend.length > 1` ─────────────────────────────────────────────────────

    @Test
    fun weeklyTrendNeedsMoreThanOnePoint() {
        assertTrue(DrivingCoachProjection.project(baseData, locale, zone).hasWeeklyTrend)

        val oneWeek = baseData.copy(weeklyTrend = listOf(CoachWeeklyTrend(week = "W1", score = 71.0)))
        val display = DrivingCoachProjection.project(oneWeek, locale, zone)
        assertFalse(display.hasWeeklyTrend)
        assertEquals(listOf("W1"), display.weekLabels)
        assertEquals(listOf(71.0), display.weekScores)
    }

    // ── Recommendations + per-drive rows ─────────────────────────────────────────────────────────────────────

    @Test
    fun recommendationsProjectImpactToneAndTip() {
        val display = DrivingCoachProjection.project(baseData, locale, zone)

        assertTrue(display.hasRecommendations)
        assertEquals(CoachTone.Danger, display.recommendations[0].tone)
        assertEquals("high", display.recommendations[0].impactLabel)
        assertEquals("Brake earlier.", display.recommendations[0].tip)
        assertEquals(CoachTone.Success, display.recommendations[1].tone)
    }

    @Test
    fun perDriveRowsFormatCellsAndKeepRawComparables() {
        val display = DrivingCoachProjection.project(baseData, locale, zone)
        val first = display.driveRows.first()

        assertTrue(display.hasPerDriveScores)
        assertEquals(1L, first.driveId)
        assertEquals("Mar 14", first.dateText)
        assertEquals("88", first.scoreText)
        assertEquals(CoachTone.Success, first.scoreTone)
        assertEquals("efficient", first.styleLabel)
        assertEquals(CoachTone.Success, first.styleTone)
        assertEquals("151.20", first.efficiencyText)
        assertEquals("42.60 km", first.distanceText)
        // Raw comparables preserved for the sortable table.
        assertEquals(88.0, first.score, 0.0)
        assertEquals(151.2, first.efficiency, 0.0)
        assertEquals(42.6, first.distance, 0.0)
    }

    // ── Sorting: the web sortable DataTable columns, applied to the projected rows ──────────────────────────

    @Test
    fun sortDriveRowsOrdersByScoreInBothDirections() {
        val rows = DrivingCoachProjection.project(baseData, locale, zone).driveRows

        val asc = DrivingCoachProjection.sortDriveRows(rows, SORT_KEY_SCORE, ascending = true)
        assertEquals(listOf(64.0, 88.0), asc.map { it.score })

        val desc = DrivingCoachProjection.sortDriveRows(rows, SORT_KEY_SCORE, ascending = false)
        assertEquals(listOf(88.0, 64.0), desc.map { it.score })
    }

    @Test
    fun sortDriveRowsOrdersByDate() {
        val rows = DrivingCoachProjection.project(baseData, locale, zone).driveRows
        // 2026-03-12 precedes 2026-03-14 ascending.
        val asc = DrivingCoachProjection.sortDriveRows(rows, SORT_KEY_DATE, ascending = true)
        assertEquals(listOf(2L, 1L), asc.map { it.driveId })
    }

    @Test
    fun sortDriveRowsReturnsSourceOrderForNullKey() {
        val rows = DrivingCoachProjection.project(baseData, locale, zone).driveRows
        val unsorted = DrivingCoachProjection.sortDriveRows(rows, key = null, ascending = true)
        assertEquals(listOf(1L, 2L), unsorted.map { it.driveId })
    }

    // ── Number / date formatting: locale grouping, the safeNumber guard, the raw-number rendering ───────────

    @Test
    fun fmtNumberGroupsThousandsAndFixesFractionDigits() {
        assertEquals("1,234.50", DrivingCoachProjection.fmtNumber(1234.5, 2, locale))
        assertEquals("168.40", DrivingCoachProjection.fmtNumber(168.4, 2, locale))
        assertEquals("37", DrivingCoachProjection.fmtInt(37.0, locale))
    }

    @Test
    fun nonFiniteValuesFoldToZeroLikeSafeNumber() {
        assertEquals("0.00", DrivingCoachProjection.fmtNumber(Double.NaN, 2, locale))
        assertEquals("0.00", DrivingCoachProjection.fmtNumber(Double.POSITIVE_INFINITY, 2, locale))
        assertEquals("0", DrivingCoachProjection.plainNumber(Double.NEGATIVE_INFINITY))
    }

    @Test
    fun plainNumberRendersWholeAndFractionalLikeJsInterpolation() {
        assertEquals("88", DrivingCoachProjection.plainNumber(88.0))
        assertEquals("82.5", DrivingCoachProjection.plainNumber(82.5))
        assertEquals("0", DrivingCoachProjection.plainNumber(0.0))
    }

    @Test
    fun formatDateShortRendersMonthDayAndGuardsInvalidInput() {
        assertEquals("Mar 14", DrivingCoachProjection.formatDateShort("2026-03-14", locale, zone))
        assertEquals("Mar 14", DrivingCoachProjection.formatDateShort("2026-03-14T08:30:00Z", locale, zone))
        assertEquals(DRIVING_COACH_EM_DASH, DrivingCoachProjection.formatDateShort("", locale, zone))
        assertEquals(DRIVING_COACH_EM_DASH, DrivingCoachProjection.formatDateShort("not-a-date", locale, zone))
    }

    // ── Data adapter: decode the cached snake_case payload (extra columns ignored) and project ──────────────

    @Test
    fun projectsStraightOffTheCachedJsonIgnoringUnknownColumns() {
        val json =
            """
            {
              "overall_score": 82,
              "efficiency_wh_km": 168.4,
              "best_efficiency_wh_km": 152.1,
              "total_drives_analyzed": 37,
              "style_breakdown": { "efficient": 20, "moderate": 12, "aggressive": 5 },
              "patterns": { "hard_accel_pct": 18, "hard_brake_pct": 22, "highway_pct": 61, "short_trip_pct": 44, "cold_start_pct": 9 },
              "weekly_trend": [
                { "week": "W1", "score": 71, "efficiency": 170, "drives": 4 },
                { "week": "W2", "score": 78, "efficiency": 165, "drives": 6 }
              ],
              "recommendations": [ { "category": "braking", "impact": "high", "tip": "Brake earlier." } ],
              "per_drive_scores": [
                { "drive_id": 1, "date": "2026-03-14", "score": 88, "style": "efficient", "efficiency": 151.2, "distance": 42.6, "co2_saved": 11.2 }
              ],
              "generated_at": "2026-03-15T00:00:00Z"
            }
            """.trimIndent()

        val decoded = lenientJson.decodeFromString<DrivingCoachData>(json)

        assertEquals(82.0, decoded.overallScore, 0.0)
        assertEquals(37.0, decoded.totalDrivesAnalyzed, 0.0)
        assertEquals(3, decoded.styleBreakdown.size)
        assertEquals(2, decoded.weeklyTrend.size)
        assertEquals(1, decoded.perDriveScores.size)

        val display = DrivingCoachProjection.project(decoded, locale, zone)
        assertEquals(CoachTone.Success, display.scoreTone)
        assertEquals("168.40 Wh/km", display.avgEfficiencyText)
        assertTrue(display.hasWeeklyTrend)
        assertEquals("Mar 14", display.driveRows.single().dateText)
    }
}
