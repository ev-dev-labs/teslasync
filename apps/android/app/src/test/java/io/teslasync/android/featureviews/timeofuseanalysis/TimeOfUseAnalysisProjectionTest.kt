package io.teslasync.android.featureviews.timeofuseanalysis

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Time-of-Use rate-analysis surface's pure logic — the native analogue of the
 * web component's derivations (web/src/features/charging/components/cost-analysis/TimeOfUseAnalysis.tsx): the
 * per-bar `isPeak` / `isOffPeak` band classification, the chart inputs (hour labels + session counts + the
 * empty guard), the four insight cards (cheapest / priciest / busiest / off-peak ratio in order, with their
 * captions), the `touInsights ? … : null` empty branch, and the PII-safe `view.opened` diagnostic. Runs in
 * the :android:testReleaseUnitTest gate; no Compose, no device.
 */
class TimeOfUseAnalysisProjectionTest {
    private val strings =
        TimeOfUseStrings(
            title = "Title",
            insights = "Insights",
            cheapestHour = "Cheapest",
            priciestHour = "Priciest",
            busiestHour = "Busiest",
            offPeakRatio = "OffPeakRatio",
            offPeakDesc = "OffPeakDesc",
            noInsights = "NoInsights",
            avgCost = "avg",
            perSession = "/session",
            sessions = "Sessions",
            peak = "Peak",
            midPeak = "Mid",
            offPeak = "Off",
        )

    private val formatters =
        TimeOfUseFormatters(
            avgCostSummary = { "cost($it)" },
            sessionsSummary = { "sess($it)" },
            percent = { "pct($it)" },
        )

    private val hourlyData =
        listOf(
            bucket(hour = 2, sessions = 3, avgCost = 0.12),
            bucket(hour = 14, sessions = 6, avgCost = 0.28),
            bucket(hour = 18, sessions = 9, avgCost = 0.30),
        )

    private val insights =
        TouInsights(
            cheapest = hourlyData[0],
            priciest = hourlyData[2],
            busiest = hourlyData[2],
            offPeakPct = 42.5,
        )

    // ── Band classification (web isPeak / isOffPeak parity) ───────────────────────

    @Test
    fun ratePeriodClassifiesPeakHoursInclusive() {
        assertEquals(RatePeriod.Peak, TimeOfUseAnalysisProjection.ratePeriod(14))
        assertEquals(RatePeriod.Peak, TimeOfUseAnalysisProjection.ratePeriod(17))
        assertEquals(RatePeriod.Peak, TimeOfUseAnalysisProjection.ratePeriod(19))
    }

    @Test
    fun ratePeriodClassifiesOffPeakAcrossMidnight() {
        assertEquals(RatePeriod.OffPeak, TimeOfUseAnalysisProjection.ratePeriod(22))
        assertEquals(RatePeriod.OffPeak, TimeOfUseAnalysisProjection.ratePeriod(23))
        assertEquals(RatePeriod.OffPeak, TimeOfUseAnalysisProjection.ratePeriod(0))
        assertEquals(RatePeriod.OffPeak, TimeOfUseAnalysisProjection.ratePeriod(5))
    }

    @Test
    fun ratePeriodClassifiesEverythingElseAsMidPeak() {
        // Boundaries: 6 (first non-off-peak), 13 (last pre-peak), 20–21 (post-peak, pre-off-peak).
        assertEquals(RatePeriod.MidPeak, TimeOfUseAnalysisProjection.ratePeriod(6))
        assertEquals(RatePeriod.MidPeak, TimeOfUseAnalysisProjection.ratePeriod(13))
        assertEquals(RatePeriod.MidPeak, TimeOfUseAnalysisProjection.ratePeriod(20))
        assertEquals(RatePeriod.MidPeak, TimeOfUseAnalysisProjection.ratePeriod(21))
    }

    // ── Chart inputs (web hourlyData map + empty guard) ───────────────────────────

    @Test
    fun projectBuildsChartLabelsAndSessionValuesInOrder() {
        val result = TimeOfUseAnalysisProjection.project(TimeOfUseData(hourlyData, insights), strings, formatters)

        assertFalse(result.chart.isEmpty)
        assertEquals(listOf("02:00", "14:00", "18:00"), result.chart.xLabels)
        assertEquals(listOf(3.0, 6.0, 9.0), result.chart.sessionValues)
    }

    @Test
    fun projectMarksChartEmptyForNoBuckets() {
        val result = TimeOfUseAnalysisProjection.project(TimeOfUseData(emptyList(), null), strings, formatters)

        assertTrue(result.chart.isEmpty)
        assertTrue(result.chart.xLabels.isEmpty())
        assertTrue(result.chart.sessionValues.isEmpty())
    }

    // ── Insight cards (web touInsights branch) ────────────────────────────────────

    @Test
    fun projectBuildsFourInsightCardsInWebOrder() {
        val result = TimeOfUseAnalysisProjection.project(TimeOfUseData(hourlyData, insights), strings, formatters)

        assertTrue(result.hasInsights)
        assertEquals(
            listOf(
                TouInsightCard(TouTone.Cheapest, "Cheapest", "02:00", "cost(0.12)"),
                TouInsightCard(TouTone.Priciest, "Priciest", "18:00", "cost(0.3)"),
                TouInsightCard(TouTone.Busiest, "Busiest", "18:00", "sess(9)"),
                TouInsightCard(TouTone.OffPeak, "OffPeakRatio", "pct(42.5)", "OffPeakDesc"),
            ),
            result.insightCards,
        )
    }

    @Test
    fun projectShowsNoInsightsWhenInsightsNull() {
        // The web `touInsights ? … : noInsights` branch: buckets can be present while insights are null.
        val result = TimeOfUseAnalysisProjection.project(TimeOfUseData(hourlyData, null), strings, formatters)

        assertFalse(result.hasInsights)
        assertTrue(result.insightCards.isEmpty())
        assertFalse(result.chart.isEmpty)
    }

    @Test
    fun insightCardsUseInjectedFormattersForCaptions() {
        val cards = TimeOfUseAnalysisProjection.insightCards(insights, strings, formatters)

        assertEquals("cost(0.12)", cards[0].caption)
        assertEquals("cost(0.3)", cards[1].caption)
        assertEquals("sess(9)", cards[2].caption)
        assertEquals("OffPeakDesc", cards[3].caption)
        assertEquals("pct(42.5)", cards[3].value)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordTimeOfUseAnalysisOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "TimeOfUseAnalysis"), fields)
    }

    @Test
    fun viewOpenedCarriesNoNumericPayload() {
        val logger = RecordingLogger()

        recordTimeOfUseAnalysisOpened(logger)

        val fields = logger.records.single().second
        assertEquals(setOf("surface"), fields.keys)
        assertTrue(fields.values.none { it.any(Char::isDigit) })
    }

    private fun bucket(
        hour: Int,
        sessions: Long,
        avgCost: Double,
    ): TouHourBucket =
        TouHourBucket(
            hour = hour,
            label = "${hour.toString().padStart(2, '0')}:00",
            sessions = sessions,
            avgCost = avgCost,
            totalEnergy = sessions * 8.0,
        )

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
}
