package io.teslasync.android.featureviews.forecastdetails

import io.teslasync.android.components.charts.ChartFormat
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the ForecastDetails' pure logic — the native analogue of every derivation the web
 * component performs (web/src/features/charging/components/cost-analysis/ForecastDetails.tsx): the two fixed
 * donut slices + their proportional sweep, the per-source `formatCurrency(avg_cost_per_kwh, 3)/kWh` legend, the
 * `<AnimatedNumber>` monthly-savings figure, the annual / lifetime `<Currency precision={0} />`, the gas / EV
 * monthly `<Currency>` (default precision 2), the unit-less `fmtNumber(avg_km, 0)`, the `useFormatting`
 * currency-symbol read, and the empty-insights guard. Because the surface is purely presentational each
 * [ForecastDetailsDisplay] is exactly what the thin composable renders, so the typical / empty assertions
 * double as the per-state "snapshots" (populated and data-resolved-but-empty). Runs in the
 * :app:testReleaseUnitTest gate; [Locale.US] keeps the grouping/decimal separators deterministic.
 */
class ForecastDetailsProjectionTest {
    private val perKwh = "Per kWh"

    private val typical =
        ForecastData(
            breakdown =
                CostBreakdown(
                    home = ChargerCategory(pct = 68.0, avgCostPerKwh = 0.13),
                    supercharger = ChargerCategory(pct = 32.0, avgCostPerKwh = 0.42),
                ),
            gasComparison =
                GasComparison(
                    avgKmPerMonth = 1_540.0,
                    gasCostPerMonth = 188.0,
                    evCostPerMonth = 64.0,
                    monthlySavings = 124.0,
                    annualSavings = 1_488.0,
                    lifetimeSavings = 7_440.0,
                ),
            insights = listOf("Charge at home overnight.", "Avoid weekend Supercharging."),
        )

    private fun project(data: ForecastData): ForecastDetailsDisplay = ForecastDetailsProjection.project(data, "$", perKwh, Locale.US)

    // ── project(): the populated "snapshot" ──────────────────────────────────────

    @Test
    fun projectsTypicalPayloadIntoEveryRenderedString() {
        val display = project(typical)

        // Donut slices keep the fixed Home → Supercharger order (the web `<Pie>` cell order).
        assertEquals(listOf(ChargerKind.Home, ChargerKind.Supercharger), display.breakdown.map { it.kind })
        assertEquals(listOf(68.0, 32.0), display.breakdown.map { it.pct })
        assertEquals(
            listOf("\$0.130 Per kWh", "\$0.420 Per kWh"),
            display.breakdown.map { it.costPerKwhLabel },
        )

        // Savings: raw value for the count-up + the settled/accessible currency string.
        assertEquals(124.0, display.monthlySavings, 0.0)
        assertEquals("\$124", display.monthlySavingsText)
        assertEquals("\$1,488", display.annualText)
        assertEquals("\$7,440", display.lifetimeText)
        assertEquals("\$188.00", display.gasCostText)
        assertEquals("\$64.00", display.evCostText)
        assertEquals("1,540", display.avgKmText)

        assertEquals(2, display.insights.size)
        assertTrue(display.hasInsights)
    }

    @Test
    fun projectsEmptyPayloadAsARenderableSurfaceNeverBlank() {
        // Web renders the same structure for a zeroed payload: a $0 savings count-up, "$0.000/kWh" legend rows,
        // and an empty insights list — never a hidden or blank panel.
        val display = project(ForecastData())

        assertEquals(listOf(0.0, 0.0), display.breakdown.map { it.pct })
        assertEquals(
            listOf("\$0.000 Per kWh", "\$0.000 Per kWh"),
            display.breakdown.map { it.costPerKwhLabel },
        )
        assertEquals(0.0, display.monthlySavings, 0.0)
        assertEquals("\$0", display.monthlySavingsText)
        assertEquals("\$0", display.annualText)
        assertEquals("\$0", display.lifetimeText)
        assertEquals("\$0.00", display.gasCostText)
        assertEquals("\$0.00", display.evCostText)
        assertEquals("0", display.avgKmText)
        assertTrue(display.insights.isEmpty())
        assertFalse(display.hasInsights)
    }

    // ── sweepFractions(): proportional donut sizing ──────────────────────────────

    @Test
    fun sweepFractionsAreProportionalAndSumToOne() {
        val fractions = ForecastDetailsProjection.sweepFractions(project(typical).breakdown)

        assertEquals(2, fractions.size)
        assertEquals(0.68, fractions[0], FRACTION_DELTA)
        assertEquals(0.32, fractions[1], FRACTION_DELTA)
        assertEquals(1.0, fractions.sum(), FRACTION_DELTA)
    }

    @Test
    fun sweepFractionsGuardZeroAndNonPositiveTotals() {
        // Both shares zero → an empty ring (matching Recharts' zero-total pie), never a divide-by-zero.
        assertEquals(listOf(0.0, 0.0), ForecastDetailsProjection.sweepFractions(project(ForecastData()).breakdown))

        // A negative share contributes nothing; the positive sibling takes the whole ring.
        val mixed =
            project(
                ForecastData(
                    breakdown =
                        CostBreakdown(
                            home = ChargerCategory(pct = -5.0),
                            supercharger = ChargerCategory(pct = 40.0),
                        ),
                ),
            )
        assertEquals(listOf(0.0, 1.0), ForecastDetailsProjection.sweepFractions(mixed.breakdown))
    }

    // ── percent(): web Math.round parity + non-finite guard ──────────────────────

    @Test
    fun percentRoundsHalvesTowardsPositiveInfinityLikeMathRound() {
        assertEquals(68, ForecastDetailsProjection.percent(67.5))
        assertEquals(1, ForecastDetailsProjection.percent(0.5))
        assertEquals(32, ForecastDetailsProjection.percent(32.4))
    }

    @Test
    fun percentFoldsNonFiniteToZero() {
        assertEquals(0, ForecastDetailsProjection.percent(Double.NaN))
        assertEquals(0, ForecastDetailsProjection.percent(Double.POSITIVE_INFINITY))
    }

    // ── formatCurrency(): web <Currency> (symbol + grouped number, '—' fallback) ──

    @Test
    fun formatCurrencyAppliesSymbolPrecisionAndGrouping() {
        assertEquals("\$0.130", ForecastDetailsProjection.formatCurrency(0.13, "$", 3, Locale.US))
        assertEquals("\$1,488", ForecastDetailsProjection.formatCurrency(1_488.0, "$", 0, Locale.US))
        assertEquals("\$64.00", ForecastDetailsProjection.formatCurrency(64.0, "$", 2, Locale.US))
    }

    @Test
    fun formatCurrencyHonorsACustomSymbolAndFallsBackWhenBlank() {
        assertEquals("\u20AC10", ForecastDetailsProjection.formatCurrency(10.0, "\u20AC", 0, Locale.US))
        // A blank symbol falls back to the web `useFormatting` default `$`.
        assertEquals("\$10", ForecastDetailsProjection.formatCurrency(10.0, "  ", 0, Locale.US))
    }

    @Test
    fun formatCurrencyRendersTheBareFallbackForNonFiniteValues() {
        // Web `Currency`: `!Number.isFinite(value)` → the bare `'—'` fallback, with no currency symbol.
        assertEquals(ChartFormat.EMPTY, ForecastDetailsProjection.formatCurrency(Double.NaN, "$", 2, Locale.US))
        assertEquals(
            ChartFormat.EMPTY,
            ForecastDetailsProjection.formatCurrency(Double.POSITIVE_INFINITY, "$", 2, Locale.US),
        )
    }

    @Test
    fun formatNumberGroupsWithoutACurrencySymbol() {
        assertEquals("1,540", ForecastDetailsProjection.formatNumber(1_540.0, 0, Locale.US))
        assertEquals(ChartFormat.EMPTY, ForecastDetailsProjection.formatNumber(Double.NaN, 0, Locale.US))
    }

    // ── ForecastDetailsCurrencyPrefs.fromSettings(): web useFormatting read ───────

    @Test
    fun currencyPrefsReadTheSymbolFromSettingsOrDefaultToDollar() {
        assertEquals(DEFAULT_CURRENCY, ForecastDetailsCurrencyPrefs.fromSettings(null).currencySymbol)
        assertEquals(
            "\u20AC",
            ForecastDetailsCurrencyPrefs.fromSettings(settingsWithSymbol("\u20AC")).currencySymbol,
        )
        // A blank/whitespace symbol and an absent key both fall back to `$`.
        assertEquals(DEFAULT_CURRENCY, ForecastDetailsCurrencyPrefs.fromSettings(settingsWithSymbol("   ")).currencySymbol)
        assertEquals(DEFAULT_CURRENCY, ForecastDetailsCurrencyPrefs.fromSettings(JsonObject(emptyMap())).currencySymbol)
    }

    // ── adapter: decode straight off the cached cost-forecast JSON ────────────────

    @Test
    fun projectsStraightOffCachedForecastJsonIgnoringOtherColumns() {
        // The data-adapter path: the owning page caches the full CostForecastData payload, which also carries
        // the `historical` / `forecast` time-series + the unused `monthly_avg` column this surface never reads.
        // Decoding + projecting must yield the rendered view from just breakdown / gas_comparison / insights.
        val json =
            """
            {
              "historical": [{ "month": "2025-01", "cost": 40.0, "kwh": 300.0, "sessions": 12, "cost_per_kwh": 0.13 }],
              "forecast": [{ "month": "2025-07", "cost": 42.0, "cost_low": 38.0, "cost_high": 46.0, "kwh": 310.0 }],
              "breakdown": {
                "home": { "pct": 68.0, "avg_cost_per_kwh": 0.13, "monthly_avg": 40.0 },
                "supercharger": { "pct": 32.0, "avg_cost_per_kwh": 0.42, "monthly_avg": 22.0 }
              },
              "gas_comparison": {
                "avg_km_per_month": 1540.0, "gas_cost_per_month": 188.0, "ev_cost_per_month": 64.0,
                "monthly_savings": 124.0, "annual_savings": 1488.0, "lifetime_savings": 7440.0
              },
              "insights": ["Charge at home overnight.", "Avoid weekend Supercharging."]
            }
            """.trimIndent()

        val decoded = LENIENT.decodeFromString<ForecastData>(json)
        assertEquals(68.0, decoded.breakdown.home.pct, 0.0)
        assertEquals(0.42, decoded.breakdown.supercharger.avgCostPerKwh, 0.0)
        assertEquals(124.0, decoded.gasComparison.monthlySavings, 0.0)
        assertEquals(2, decoded.insights.size)

        val display = project(decoded)
        assertEquals("\$0.130 Per kWh", display.breakdown[0].costPerKwhLabel)
        assertEquals("\$124", display.monthlySavingsText)
        assertEquals("1,540", display.avgKmText)
        assertTrue(display.hasInsights)
    }

    @Test
    fun decodesMissingFieldsAsZeroLikeWebOptionalChaining() {
        // A partial payload (no gas_comparison, no insights) must decode without error, every absent field
        // collapsing to its 0 / empty default — the web `data?.x ?? 0` / `?? []` behaviour.
        val decoded = LENIENT.decodeFromString<ForecastData>("""{ "breakdown": { "home": { "pct": 100.0 } } }""")

        assertEquals(100.0, decoded.breakdown.home.pct, 0.0)
        assertEquals(0.0, decoded.breakdown.supercharger.pct, 0.0)
        assertEquals(0.0, decoded.gasComparison.monthlySavings, 0.0)
        assertTrue(decoded.insights.isEmpty())

        val display = project(decoded)
        assertEquals("\$0", display.monthlySavingsText)
        assertFalse(display.hasInsights)
    }

    private fun settingsWithSymbol(symbol: String): JsonObject = JsonObject(mapOf("currency_symbol" to JsonPrimitive(symbol)))

    private companion object {
        const val FRACTION_DELTA: Double = 1e-9
        val LENIENT: Json = Json { ignoreUnknownKeys = true }
    }
}
