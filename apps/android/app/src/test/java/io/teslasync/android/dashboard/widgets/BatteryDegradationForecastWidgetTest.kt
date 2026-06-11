package io.teslasync.android.dashboard.widgets

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * JVM unit tests for the framework-free `BatteryDegradationForecastWidget` adapter logic — the data
 * projection (cached SI JSON → typed [DegradationForecast]), the health-tier and risk-impact
 * classification, the risk-icon heuristic, the localized projected-date + number formatters, the
 * size-constraint math, and the diagnostics event builder. These run in the no-device
 * `:app:testReleaseUnitTest` gate; the per-state rendering + accessibility coverage lives in the
 * instrumented [BatteryDegradationForecastWidgetUiTest].
 */
class BatteryDegradationForecastWidgetTest {
    private fun parse(raw: String): JsonElement = Json.parseToJsonElement(raw)

    // ── Adapter: cached JSON → projection ─────────────────────────────────────────
    @Test
    fun parsesFullPayloadIntoProjection() {
        val forecast =
            degradationForecast(
                parse(
                    """
                    {
                      "current_health_pct": 92.4,
                      "current_health": 90.0,
                      "degradation_rate_pct_per_month": 0.08,
                      "projected_80pct_date": "2031-07-01T00:00:00Z",
                      "risk_factors": [
                        { "name": "high_temp", "score": 8, "label": "High temperatures", "detail": "Frequent heat" },
                        { "name": "fast_charging", "score": 5, "label": "Fast charging", "detail": "42% DC" }
                      ],
                      "recommendations": ["Charge to 80%", "Precondition before DC"]
                    }
                    """.trimIndent(),
                ),
            )

        // current_health_pct wins over current_health when both are present.
        assertEquals(92.4, forecast.currentHealthPct!!, EPS)
        assertEquals(0.08, forecast.degradationRatePctPerMonth, EPS)
        assertEquals("2031-07-01T00:00:00Z", forecast.projected80PctDate)
        assertEquals(2, forecast.riskFactors.size)
        assertEquals("high_temp", forecast.riskFactors[0].name)
        assertEquals(8.0, forecast.riskFactors[0].score, EPS)
        assertEquals("High temperatures", forecast.riskFactors[0].label)
        assertEquals("Frequent heat", forecast.riskFactors[0].detail)
        assertEquals(listOf("Charge to 80%", "Precondition before DC"), forecast.recommendations)
        assertTrue(forecast.hasData)
    }

    @Test
    fun currentHealthFallsBackToCurrentHealthWhenPctAbsent() {
        val forecast = degradationForecast(parse("""{ "current_health": 88.5 }"""))
        assertEquals(88.5, forecast.currentHealthPct!!, EPS)
    }

    @Test
    fun missingFieldsDefaultSafely() {
        val forecast = degradationForecast(parse("{}"))
        assertNull(forecast.currentHealthPct)
        assertEquals(0.0, forecast.degradationRatePctPerMonth, EPS)
        assertNull(forecast.projected80PctDate)
        assertTrue(forecast.riskFactors.isEmpty())
        assertTrue(forecast.recommendations.isEmpty())
        assertFalse(forecast.hasData)
    }

    @Test
    fun nonObjectAndNullJsonDecodeToEmptyForecast() {
        assertFalse(degradationForecast(null).hasData)
        assertFalse(degradationForecast(parse("[]")).hasData)
        assertFalse(degradationForecast(parse("\"oops\"")).hasData)
    }

    @Test
    fun blankAndNullProjectedDateTreatedAsAbsent() {
        assertNull(degradationForecast(parse("""{ "projected_80pct_date": null }""")).projected80PctDate)
        assertNull(degradationForecast(parse("""{ "projected_80pct_date": "" }""")).projected80PctDate)
        assertNull(degradationForecast(parse("""{ "projected_80pct_date": "   " }""")).projected80PctDate)
    }

    @Test
    fun riskFactorsSkipNamelessRowsAndDefaultOptionalFields() {
        val forecast =
            degradationForecast(
                parse(
                    """
                    {
                      "risk_factors": [
                        { "score": 9 },
                        { "name": "soc_depth" }
                      ]
                    }
                    """.trimIndent(),
                ),
            )
        // The nameless row is dropped; the named row keeps null label/detail and a 0 score default.
        assertEquals(1, forecast.riskFactors.size)
        assertEquals("soc_depth", forecast.riskFactors[0].name)
        assertEquals(0.0, forecast.riskFactors[0].score, EPS)
        assertNull(forecast.riskFactors[0].label)
        assertNull(forecast.riskFactors[0].detail)
    }

    @Test
    fun recommendationsSkipBlankEntries() {
        val forecast =
            degradationForecast(parse("""{ "recommendations": ["Keep it cool", "", "   ", "Charge slow"] }"""))
        assertEquals(listOf("Keep it cool", "Charge slow"), forecast.recommendations)
    }

    @Test
    fun hasDataGateMatchesWeb() {
        // Web hasData = currentHealthPct != null || projected_80pct_date != null.
        assertTrue(degradationForecast(parse("""{ "current_health_pct": 80 }""")).hasData)
        assertTrue(degradationForecast(parse("""{ "projected_80pct_date": "2030-01-01" }""")).hasData)
        // Risk factors / recommendations alone do NOT make the widget consider itself populated.
        assertFalse(degradationForecast(parse("""{ "recommendations": ["x"] }""")).hasData)
    }

    // ── Health tier (web healthTier thresholds) ───────────────────────────────────
    @Test
    fun healthTierFollowsWebThresholds() {
        assertEquals(DegradationHealthTier.Healthy, degradationHealthTier(0.0))
        assertEquals(DegradationHealthTier.Healthy, degradationHealthTier(0.05))
        assertEquals(DegradationHealthTier.Normal, degradationHealthTier(0.051))
        assertEquals(DegradationHealthTier.Normal, degradationHealthTier(0.12))
        assertEquals(DegradationHealthTier.Accelerated, degradationHealthTier(0.13))
    }

    // ── Risk impact (web scoreToImpact thresholds) ────────────────────────────────
    @Test
    fun riskScoreImpactFollowsWebThresholds() {
        assertEquals(RiskImpact.High, riskScoreImpact(7.0))
        assertEquals(RiskImpact.High, riskScoreImpact(10.0))
        assertEquals(RiskImpact.Medium, riskScoreImpact(4.0))
        assertEquals(RiskImpact.Medium, riskScoreImpact(6.9))
        assertEquals(RiskImpact.Low, riskScoreImpact(3.9))
        assertEquals(RiskImpact.Low, riskScoreImpact(0.0))
    }

    // ── Risk icon heuristic (web riskIcon) ────────────────────────────────────────
    @Test
    fun riskFactorIconKindMatchesWebHeuristic() {
        assertEquals(RiskIconKind.Thermal, riskFactorIconKind("High Temperature"))
        assertEquals(RiskIconKind.Thermal, riskFactorIconKind("thermal stress"))
        assertEquals(RiskIconKind.Thermal, riskFactorIconKind("excess heat"))
        assertEquals(RiskIconKind.Charge, riskFactorIconKind("Fast charging"))
        assertEquals(RiskIconKind.Charge, riskFactorIconKind("DC sessions"))
        assertEquals(RiskIconKind.Battery, riskFactorIconKind("Deep SOC depth"))
        assertEquals(RiskIconKind.Generic, riskFactorIconKind("Mystery factor"))
    }

    // ── Projected-date formatter (web Intl.DateTimeFormat year+short month) ────────
    @Test
    fun formatForecastProjectedHandlesCommonShapes() {
        assertEquals("Jul 2031", formatForecastProjected("2031-07-01T00:00:00Z", Locale.US))
        assertEquals("Jul 2031", formatForecastProjected("2031-07-01", Locale.US))
        assertEquals("Jul 2031", formatForecastProjected("2031-07-15T08:30:00+02:00", Locale.US))
        assertEquals("Jul 2031", formatForecastProjected("2031-07", Locale.US))
    }

    @Test
    fun formatForecastProjectedReturnsNullForBlankOrGarbage() {
        assertNull(formatForecastProjected(null, Locale.US))
        assertNull(formatForecastProjected("", Locale.US))
        assertNull(formatForecastProjected("not-a-date", Locale.US))
    }

    @Test
    fun formatForecastNumberIsFixedDecimal() {
        assertEquals("92.4", formatForecastNumber(92.41, 1, Locale.US))
        assertEquals("0.08", formatForecastNumber(0.08, 2, Locale.US))
        assertEquals("8", formatForecastNumber(8.0, 0, Locale.US))
        assertEquals("5", formatForecastNumber(4.6, 0, Locale.US))
    }

    // ── Size constraints + chrome selection ───────────────────────────────────────
    @Test
    fun sizeSelectsCompactAndHeaderLikeWeb() {
        // Web isCompact = size.cols <= 1 (columns only — a 1×4 strip is still compact).
        assertTrue(DashboardWidgetSize(1, 4).forecastIsCompact())
        assertFalse(DashboardWidgetSize(2, 2).forecastIsCompact())
        assertFalse(DashboardWidgetSize(2, 4).forecastShowsHeader().not())
        assertFalse(DashboardWidgetSize(1, 4).forecastShowsHeader())
    }

    @Test
    fun coerceToForecastConstraintsClampsToDescriptorBounds() {
        assertEquals(DashboardWidgetSize(4, 40), DashboardWidgetSize(9, 99).coerceToForecastConstraints())
        assertEquals(DashboardWidgetSize(1, 2), DashboardWidgetSize(0, 0).coerceToForecastConstraints())
        assertEquals(DashboardWidgetSize(2, 4), DashboardWidgetSize(2, 4).coerceToForecastConstraints())
    }

    @Test
    fun descriptorMatchesRegistryMetadata() {
        assertEquals("battery-degradation-forecast", BatteryDegradationForecastWidgetDescriptor.ID)
        assertEquals("battery", BatteryDegradationForecastWidgetDescriptor.CATEGORY)
        assertEquals(DashboardWidgetSize(2, 4), BatteryDegradationForecastWidgetDescriptor.defaultSize)
        assertEquals(DashboardWidgetSize(1, 2), BatteryDegradationForecastWidgetDescriptor.minSize)
        assertEquals(DashboardWidgetSize(4, 40), BatteryDegradationForecastWidgetDescriptor.maxSize)
    }

    // ── Diagnostics (P1/S11) ───────────────────────────────────────────────────────
    @Test
    fun viewOpenedEventCarriesSurfaceSlug() {
        val event = batteryDegradationForecastViewOpenedEvent("1.2.3")
        assertEquals("screen_view", event.name)
        assertEquals("BatteryDegradationForecastWidget", event.properties["screen"])
        assertEquals("android", event.properties["platform"])
        assertEquals("1.2.3", event.properties["app_version"])
    }

    // ── UiState empty projection (the no-vehicle / no-data branch) ─────────────────
    @Test
    fun emptyForecastStateRendersEmptyPhase() {
        val state: UiState<DegradationForecast> = UiState(phase = UiPhase.Empty)
        assertTrue(state.isEmpty)
        assertNull(state.data)
    }

    private companion object {
        const val EPS = 1e-6
    }
}
