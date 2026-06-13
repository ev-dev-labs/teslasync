// Off-device unit coverage for the InsightsEngine pure model — the framework-free analyzers, the
// surface classifier, the formatting projection, and the trend-tone fold. This is the "data adapter"
// test the P3 contract mandates (cached/raw inputs → projection): every analyzer's threshold gate,
// produced keys / formatted args / trend / tone / severity, the feed-status → surface mapping, and
// the `useFormatting` settings projection are asserted here, so the composable stays a thin renderer.
// Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.insightsengine

import io.teslasync.android.components.datadisplay.DeltaTone
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class InsightsEngineModelTest {
    private val fmt = InsightsFormatting(currencySymbol = "$", precision = 2, localeTag = "en-US")
    private val utc = ZoneId.of("UTC")

    // ── Formatting projection (the native useFormatting) ──────────────────────────────────────

    @Test
    fun formattingDefaultsMirrorTheWebFallbacks() {
        val default = InsightsFormatting.fromSettings(null)
        assertEquals("$", default.currencySymbol)
        assertEquals(2, default.precision)
    }

    @Test
    fun formattingReadsCurrencyPrecisionAndLocale() {
        val parsed =
            InsightsFormatting.fromSettings(
                buildJsonObject {
                    put("currency_symbol", "€")
                    put("decimal_precision", 1)
                    put("locale", "de-DE")
                },
            )
        assertEquals("€", parsed.currencySymbol)
        assertEquals(1, parsed.precision)
    }

    @Test
    fun formattingFormatsCurrencyAndGroupsThousands() {
        assertEquals("$1,234.50", fmt.formatCurrency(1234.5, 2))
        assertEquals("$104", fmt.formatCurrency(103.5, 0))
        assertEquals("1,000", fmt.number(1000.0, 0))
    }

    // ── Trend-tone fold (the web trendGood + trendColor quirk) ─────────────────────────────────

    @Test
    fun insightToneFoldsTheWebColoringRule() {
        assertEquals(DeltaTone.Good, insightTone(InsightTrend.Up, trendGood = true))
        assertEquals(DeltaTone.Bad, insightTone(InsightTrend.Up, trendGood = false))
        assertEquals(DeltaTone.Bad, insightTone(InsightTrend.Down, trendGood = true))
        assertEquals(DeltaTone.Good, insightTone(InsightTrend.Down, trendGood = false))
        assertEquals(DeltaTone.Muted, insightTone(InsightTrend.Neutral, trendGood = true))
        assertEquals(DeltaTone.Muted, insightTone(InsightTrend.Neutral, trendGood = false))
    }

    // ── Full analyzer suite over rich data (order + content) ───────────────────────────────────

    @Test
    fun buildInsightsRunsEveryAnalyzerInTheWebOrder() {
        val insights = buildInsights(richData(), fmt, utc)
        assertEquals(
            listOf(
                "charging-cost",
                "efficiency-trend",
                "battery-health",
                "optimal-charging",
                "vampire-drain",
                "driving-patterns",
                "cost-savings",
                "range-optimization",
            ),
            insights.map { it.id },
        )
    }

    @Test
    fun chargingCostInsightComparesHomeAndSupercharger() {
        val insight = insight("charging-cost")
        assertEquals(InsightIcon.DollarSign, insight.icon)
        assertEquals(InsightTitleKey.ChargingCost, insight.titleKey)
        assertEquals(InsightTrend.Up, insight.trend)
        assertEquals(DeltaTone.Good, insight.tone)
        assertEquals(InsightSeverity.Info, insight.severity)
        assertEquals(
            listOf(
                InsightSegment(InsightBodyKey.ChargingCostAvg, listOf(InsightArg.Raw("$0.20"))),
                InsightSegment(InsightBodyKey.ChargingCostHomeSavings, listOf(InsightArg.Raw("75"))),
            ),
            insight.body,
        )
    }

    @Test
    fun efficiencyInsightReportsTheImprovement() {
        val insight = insight("efficiency-trend")
        assertEquals(InsightIcon.Efficiency, insight.icon)
        assertEquals(InsightTrend.Up, insight.trend)
        assertEquals(InsightSeverity.Success, insight.severity)
        assertEquals(
            listOf(InsightSegment(InsightBodyKey.EfficiencyImproved, listOf(InsightArg.Raw("25.0")))),
            insight.body,
        )
    }

    @Test
    fun batteryInsightDerivesYearlyRateAndAgingPhrase() {
        val insight = insight("battery-health")
        assertEquals(InsightIcon.Battery, insight.icon)
        assertEquals(InsightTrend.Up, insight.trend)
        assertEquals(InsightSeverity.Success, insight.severity)
        assertEquals(
            listOf(
                InsightSegment(
                    InsightBodyKey.BatteryHealthBody,
                    listOf(
                        InsightArg.Raw("92.0"),
                        InsightArg.Raw("12.0"),
                        InsightArg.Res(InsightBodyKey.BatteryAgingBetter),
                    ),
                ),
            ),
            insight.body,
        )
    }

    @Test
    fun optimalChargingInsightRewardsTheIdealRange() {
        val insight = insight("optimal-charging")
        assertEquals(InsightIcon.BatteryCharging, insight.icon)
        assertEquals(InsightSeverity.Success, insight.severity)
        assertEquals(
            listOf(
                InsightSegment(InsightBodyKey.OptimalChargingAvg, listOf(InsightArg.Raw("73"))),
                InsightSegment(InsightBodyKey.OptimalChargingIdeal),
            ),
            insight.body,
        )
    }

    @Test
    fun vampireDrainInsightFlagsSentryPenalty() {
        val insight = insight("vampire-drain")
        assertEquals(InsightIcon.Shield, insight.icon)
        assertEquals(InsightTrend.Down, insight.trend)
        assertEquals(InsightSeverity.Warning, insight.severity)
        assertEquals(
            listOf(
                InsightSegment(
                    InsightBodyKey.VampireSentry,
                    listOf(InsightArg.Raw("100"), InsightArg.Raw("48.0")),
                ),
            ),
            insight.body,
        )
    }

    @Test
    fun drivingPatternsInsightResolvesBusiestDayAndPeakHour() {
        val insight = insight("driving-patterns")
        assertEquals(InsightIcon.Car, insight.icon)
        assertEquals(InsightTrend.Neutral, insight.trend)
        assertEquals(DeltaTone.Muted, insight.tone)
        assertEquals(
            listOf(
                InsightSegment(
                    InsightBodyKey.DrivingPatternsBody,
                    listOf(
                        InsightArg.Raw("4.0"),
                        InsightArg.Res(InsightBodyKey.DayMonday),
                        InsightArg.Raw("8"),
                        InsightArg.Raw("9"),
                    ),
                ),
            ),
            insight.body,
        )
    }

    @Test
    fun costSavingsInsightComparesAgainstGasoline() {
        val insight = insight("cost-savings")
        assertEquals(InsightIcon.Leaf, insight.icon)
        assertEquals(InsightSeverity.Success, insight.severity)
        assertEquals(
            listOf(
                InsightSegment(
                    InsightBodyKey.CostSavingsBody,
                    listOf(
                        InsightArg.Raw("$100"),
                        InsightArg.Raw("200"),
                        InsightArg.Raw("1,000"),
                        InsightArg.Raw("300"),
                    ),
                ),
            ),
            insight.body,
        )
    }

    @Test
    fun rangeOptimizationInsightAdvisesWhenBelowRated() {
        val insight = insight("range-optimization")
        assertEquals(InsightIcon.Clock, insight.icon)
        assertEquals(InsightTrend.Down, insight.trend)
        assertEquals(InsightSeverity.Warning, insight.severity)
        assertEquals(
            listOf(
                InsightSegment(
                    InsightBodyKey.RangeOptimizationBody,
                    listOf(InsightArg.Raw("200"), InsightArg.Raw("300"), InsightArg.Raw("75")),
                ),
                InsightSegment(InsightBodyKey.RangeAdviceImprove),
            ),
            insight.body,
        )
    }

    // ── Threshold gates (no analyzer fires below its minimum) ─────────────────────────────────

    @Test
    fun chargingCostNeedsTwoCostBearingSessions() {
        val data = InsightData(chargingSessions = listOf(session(cost = 2.0, energy = 20.0, endLevel = null)))
        assertNull(buildInsights(data, fmt, utc).firstOrNull { it.id == "charging-cost" })
    }

    @Test
    fun efficiencyNeedsFourValidDrivesButPatternsFireAtThree() {
        val data = InsightData(drives = List(3) { drive(1000.0, 150.0, dayHourMillis(8)) })
        val produced = buildInsights(data, fmt, utc).map { it.id }
        assertFalse(produced.contains("efficiency-trend"))
        assertTrue(produced.contains("driving-patterns"))
    }

    @Test
    fun batteryNeedsANonZeroHealthScore() {
        val report = batteryReport().copy(healthScore = 0.0)
        assertNull(buildInsights(InsightData(batteryReport = report), fmt, utc).firstOrNull { it.id == "battery-health" })
    }

    @Test
    fun vampireNeedsAtLeastOneEvent() {
        val stats = vampireStats().copy(eventCount = 0)
        assertNull(buildInsights(InsightData(vampireDrainStats = stats), fmt, utc).firstOrNull { it.id == "vampire-drain" })
    }

    // ── Surface classification (the P3 state vocabulary) ──────────────────────────────────────

    @Test
    fun loadingShortCircuitsBeforeAnalysis() {
        assertEquals(InsightsSurface.Loading, classifyInsights(richData(), InsightsFeedStatus.Loading, fmt, utc))
    }

    @Test
    fun readyWithContentIsFreshContent() {
        val surface = classifyInsights(richData(), InsightsFeedStatus.Ready, fmt, utc)
        assertTrue(surface is InsightsSurface.Content)
        assertEquals(InsightsFreshness.Fresh, (surface as InsightsSurface.Content).freshness)
        assertEquals(8, surface.insights.size)
    }

    @Test
    fun readyWithoutContentIsEmpty() {
        assertEquals(InsightsSurface.Empty, classifyInsights(InsightData(), InsightsFeedStatus.Ready, fmt, utc))
    }

    @Test
    fun staleWithContentChipsStale() {
        val surface = classifyInsights(richData(), InsightsFeedStatus.Stale, fmt, utc)
        assertEquals(InsightsFreshness.Stale, (surface as InsightsSurface.Content).freshness)
    }

    @Test
    fun offlineWithContentChipsOfflineButFailsWhenEmpty() {
        val content = classifyInsights(richData(), InsightsFeedStatus.Offline, fmt, utc)
        assertEquals(InsightsFreshness.Offline, (content as InsightsSurface.Content).freshness)
        assertEquals(InsightsSurface.Failed(offline = true), classifyInsights(InsightData(), InsightsFeedStatus.Offline, fmt, utc))
    }

    @Test
    fun errorShowsCachedContentOrAHardFailure() {
        val cached = classifyInsights(richData(), InsightsFeedStatus.Error, fmt, utc)
        assertEquals(InsightsFreshness.Stale, (cached as InsightsSurface.Content).freshness)
        assertEquals(InsightsSurface.Failed(offline = false), classifyInsights(InsightData(), InsightsFeedStatus.Error, fmt, utc))
    }

    @Test
    fun accessibilityLabelJoinsTitleAndDescription() {
        assertEquals("Battery Health. Healthy.", insightCardAccessibilityLabel("Battery Health", "Healthy."))
    }

    // ── Fixtures ──────────────────────────────────────────────────────────────────────────────

    private fun insight(id: String): Insight = buildInsights(richData(), fmt, utc).first { it.id == id }

    /** A Monday-08:00 base; [hour] shifts the wall-clock hour in UTC for the histogram. */
    private fun dayHourMillis(hour: Int): Long {
        val zoned = ZonedDateTime.of(2024, 1, 1, hour, 0, 0, 0, utc)
        return zoned.toInstant().toEpochMilli()
    }

    private fun drive(
        distanceM: Double,
        energyWh: Double?,
        ts: Long,
    ): InsightDrive = InsightDrive(distanceM = distanceM, energyUsedWh = energyWh, startTsMillis = ts)

    private fun session(
        cost: Double?,
        energy: Double,
        endLevel: Double?,
        fastCharger: String? = null,
    ): InsightChargingSession =
        InsightChargingSession(
            cost = cost,
            chargeEnergyAddedKwh = energy,
            fastChargerType = fastCharger,
            endBatteryLevelPct = endLevel,
        )

    private fun batteryReport(): InsightBatteryReport =
        InsightBatteryReport(
            healthScore = 90.0,
            currentCapacityPct = 92.0,
            degradationPct = 3.0,
            monthlyTrend = listOf(InsightBatteryTrendPoint(95.0), InsightBatteryTrendPoint(93.0)),
            estimatedRangeNewKm = 500.0,
            estimatedRangeCurrentKm = 400.0,
        )

    private fun vampireStats(): InsightVampireDrainStats =
        InsightVampireDrainStats(
            eventCount = 5,
            avgSentryDrain = 2.0,
            avgNoSentryDrain = 1.0,
            avgDrainRate = 1.5,
            totalRangeLost = 10.0,
        )

    private fun richData(): InsightData =
        InsightData(
            drives =
                listOf(
                    drive(1000.0, 150.0, dayHourMillis(8)),
                    drive(1000.0, 150.0, dayHourMillis(8)),
                    drive(1000.0, 200.0, dayHourMillis(9)),
                    drive(1000.0, 200.0, dayHourMillis(9)),
                ),
            chargingSessions =
                listOf(
                    session(cost = 2.0, energy = 20.0, endLevel = 70.0, fastCharger = null),
                    session(cost = 8.0, energy = 20.0, endLevel = 78.0, fastCharger = "Supercharger"),
                    session(cost = 2.0, energy = 20.0, endLevel = 72.0, fastCharger = null),
                ),
            energyStats =
                InsightEnergyStats(
                    totalEnergyUsedKwh = 200.0,
                    totalDistanceKm = 1000.0,
                    totalCost = 27.5,
                    co2SavedKg = 300.0,
                    avgEfficiencyWhKm = 200.0,
                ),
            batteryReport = batteryReport(),
            vampireDrainStats = vampireStats(),
        )
}
