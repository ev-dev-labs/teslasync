package io.teslasync.android.featureviews.optimizersection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the OptimizerSection's pure logic — the native analogue of the web component's
 * data derivations (web/src/features/charging/components/charging-list/OptimizerSection.tsx): the savings-banner
 * gate (web `potential_monthly_savings > 5`), the battery-score band (web `>= 75 / >= 50`), the formatted habit
 * + cost rows, the "sessions during peak" emphasis (web `> 30`), the joined / em-dashed hour lists, the
 * per-recommendation level + savings badge (web `estimated_savings > 0`), the weekly heatmap grid + its rgba()
 * intensity math, and the PII-safe `view.opened` diagnostic. A fixed [Locale.US] keeps number formatting
 * deterministic. Runs in the :android:testReleaseUnitTest gate.
 */
class OptimizerSectionProjectionTest {
    private val fullData =
        ChargingOptimizerData(
            currentSchedule =
                OptimizerSchedule(
                    mostCommonStartHour = 22,
                    mostCommonDay = "Monday",
                    avgSessionsPerWeek = 4.5,
                    homeChargingPct = 80.0,
                    avgChargeToPct = 85.0,
                ),
            costAnalysis =
                OptimizerCostAnalysis(
                    peakHours = listOf(16, 17, 18),
                    offpeakHours = listOf(0, 1, 2),
                    peakCostPerKwh = 0.32,
                    offpeakCostPerKwh = 0.12,
                    sessionsDuringPeakPct = 40.0,
                    potentialMonthlySavings = 24.0,
                ),
            batteryHealthScore = 82.0,
            recommendations =
                listOf(
                    OptimizerRecommendation(
                        type = "shift",
                        priority = "high",
                        title = "Shift to off-peak",
                        detail = "Charge after midnight.",
                        estimatedSavings = 12.0,
                    ),
                ),
            weeklyHeatmap = listOf(OptimizerHeatmapEntry(day = 1, hour = 22, sessions = 3, avgCostPerKwh = 0.30)),
        )

    private fun project(data: ChargingOptimizerData) = OptimizerProjection.project(data, Locale.US)

    // ── Savings-banner gate (web `potential_monthly_savings > 5`) ─────────────────

    @Test
    fun savingsBannerGateMatchesWebThreshold() {
        assertTrue(project(fullData).showSavingsBanner)
        assertEquals("24", project(fullData).savingsAmount)
        assertFalse(project(fullData.copy(costAnalysis = OptimizerCostAnalysis(potentialMonthlySavings = 5.0))).showSavingsBanner)
        assertTrue(project(fullData.copy(costAnalysis = OptimizerCostAnalysis(potentialMonthlySavings = 6.0))).showSavingsBanner)
        assertFalse(project(fullData.copy(costAnalysis = OptimizerCostAnalysis(potentialMonthlySavings = 0.0))).showSavingsBanner)
    }

    // ── Habit rows ────────────────────────────────────────────────────────────────

    @Test
    fun habitRowsAreFormattedLikeTheWeb() {
        val habits = project(fullData).habits
        assertEquals("4.5", habits.sessionsPerWeek)
        assertEquals("80%", habits.homePct)
        assertEquals("85%", habits.avgTargetPct)
        assertEquals("22:00", habits.commonHour)
        assertEquals("Monday", habits.commonDay)
    }

    // ── Battery-score band (web `>= 75` / `>= 50` ternary) ──────────────────────────

    @Test
    fun scoreBandMatchesWebThresholds() {
        assertEquals(ScoreBand.Good, OptimizerProjection.scoreBand(82.0))
        assertEquals(ScoreBand.Good, OptimizerProjection.scoreBand(75.0))
        assertEquals(ScoreBand.Fair, OptimizerProjection.scoreBand(74.9))
        assertEquals(ScoreBand.Fair, OptimizerProjection.scoreBand(50.0))
        assertEquals(ScoreBand.Poor, OptimizerProjection.scoreBand(49.9))
        assertEquals(ScoreBand.Poor, OptimizerProjection.scoreBand(Double.NaN))
    }

    @Test
    fun projectCarriesTheRawBatteryScore() {
        assertEquals(82.0, project(fullData).batteryScore, SCORE_DELTA)
        assertEquals(0.0, project(fullData.copy(batteryHealthScore = Double.NaN)).batteryScore, SCORE_DELTA)
    }

    // ── Cost rows + emphasis (web `> 30` red) ──────────────────────────────────────

    @Test
    fun costRowsAreFormattedWithEmphasis() {
        val cost = project(fullData).cost
        assertEquals("\$0.320/kWh", cost.peakRate)
        assertEquals("\$0.120/kWh", cost.offpeakRate)
        assertEquals("40%", cost.sessionsDuringPeakPct)
        assertTrue(cost.sessionsDuringPeakHigh)
        assertEquals("16:00, 17:00, 18:00", cost.peakHours)
        assertEquals("0:00, 1:00, 2:00", cost.offpeakHours)
    }

    @Test
    fun sessionsDuringPeakEmphasisIsStrictlyAboveThirty() {
        fun high(pct: Double) =
            project(fullData.copy(costAnalysis = OptimizerCostAnalysis(sessionsDuringPeakPct = pct))).cost.sessionsDuringPeakHigh
        assertTrue(high(30.1))
        assertFalse(high(30.0))
        assertFalse(high(10.0))
    }

    // ── Hour list (web join or `|| '—'`) ───────────────────────────────────────────

    @Test
    fun hourListJoinsOrFallsBackToEmDash() {
        assertEquals("16:00, 17:00", OptimizerProjection.hourList(listOf(16, 17)))
        assertEquals("\u2014", OptimizerProjection.hourList(emptyList()))
    }

    // ── Recommendation level + savings badge ────────────────────────────────────────

    @Test
    fun levelMapsWirePriorityCaseInsensitively() {
        assertEquals(RecommendationLevel.High, OptimizerProjection.level("high"))
        assertEquals(RecommendationLevel.High, OptimizerProjection.level(" HIGH "))
        assertEquals(RecommendationLevel.Medium, OptimizerProjection.level("medium"))
        assertEquals(RecommendationLevel.Low, OptimizerProjection.level("low"))
        assertEquals(RecommendationLevel.Low, OptimizerProjection.level("anything-else"))
        assertEquals(RecommendationLevel.Low, OptimizerProjection.level(""))
    }

    @Test
    fun recommendationProjectionUppercasesPriorityAndBuildsBadge() {
        val rec = project(fullData).recommendations.single()
        assertEquals("Shift to off-peak", rec.title)
        assertEquals("Charge after midnight.", rec.detail)
        assertEquals(RecommendationLevel.High, rec.level)
        assertEquals("HIGH", rec.priorityLabel)
        assertEquals("~\$12/mo", rec.savingsBadge)
    }

    @Test
    fun savingsBadgeOnlyShownForPositiveFiniteEstimate() {
        assertEquals("~\$12/mo", OptimizerProjection.savingsBadge(12.0, Locale.US))
        assertNull(OptimizerProjection.savingsBadge(0.0, Locale.US))
        assertNull(OptimizerProjection.savingsBadge(-5.0, Locale.US))
        assertNull(OptimizerProjection.savingsBadge(null, Locale.US))
        assertNull(OptimizerProjection.savingsBadge(Double.NaN, Locale.US))
    }

    // ── Heatmap grid + intensity ────────────────────────────────────────────────────

    @Test
    fun heatmapHiddenWhenNoReadings() {
        val heatmap = OptimizerProjection.projectHeatmap(emptyList(), peakCostPerKwh = 0.32)
        assertFalse(heatmap.visible)
        assertTrue(heatmap.rows.isEmpty())
    }

    @Test
    fun heatmapBuildsSevenByTwentyFourGridWithNormalizedIntensity() {
        val heatmap = project(fullData).heatmap
        assertTrue(heatmap.visible)
        assertEquals(OptimizerProjection.DAYS_PER_WEEK, heatmap.rows.size)
        heatmap.rows.forEach { assertEquals(OptimizerProjection.HOURS_PER_DAY, it.size) }

        val populated = heatmap.rows[1][22]
        assertEquals(3, populated.sessions)
        assertEquals(0.30 / 0.32, populated.intensity, INTENSITY_DELTA)

        val idle = heatmap.rows[0][0]
        assertEquals(0, idle.sessions)
        assertEquals(0.0, idle.intensity, INTENSITY_DELTA)
    }

    @Test
    fun heatmapFallsBackToDefaultMaxCostWhenPeakRateUnknown() {
        val heatmap =
            OptimizerProjection.projectHeatmap(
                listOf(OptimizerHeatmapEntry(day = 0, hour = 0, sessions = 2, avgCostPerKwh = 0.15)),
                peakCostPerKwh = 0.0,
            )
        // maxCost defaults to 0.30, so 0.15 normalizes to half intensity.
        assertEquals(0.5, heatmap.rows[0][0].intensity, INTENSITY_DELTA)
    }

    // ── Gradient + legend rgba() math (web channel formula) ─────────────────────────

    @Test
    fun heatColorMatchesWebRgbaMath() {
        val hot = OptimizerProjection.heatColor(intensity = 1.0, sessions = 1)
        assertEquals(HeatRgba(red = 239, green = 0, blue = 0, alpha = 0.27), hot)

        val cool = OptimizerProjection.heatColor(intensity = 0.0, sessions = 5)
        assertEquals(HeatRgba(red = 0, green = 187, blue = 100, alpha = 0.75), cool)
    }

    @Test
    fun heatColorAlphaIsCappedAtNinetyPercent() {
        val saturated = OptimizerProjection.heatColor(intensity = 0.5, sessions = 100)
        assertEquals(0.9, saturated.alpha, INTENSITY_DELTA)
    }

    @Test
    fun legendColorMatchesWebRgbaMath() {
        assertEquals(HeatRgba(red = 36, green = 159, blue = 85, alpha = 0.6), OptimizerProjection.legendColor(0.15))
        assertEquals(HeatRgba(red = 215, green = 19, blue = 10, alpha = 0.6), OptimizerProjection.legendColor(0.9))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ───────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        OptimizerSectionDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "OptimizerSection"), fields)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }

    private companion object {
        const val INTENSITY_DELTA: Double = 1e-9
        const val SCORE_DELTA: Double = 1e-9
    }
}
