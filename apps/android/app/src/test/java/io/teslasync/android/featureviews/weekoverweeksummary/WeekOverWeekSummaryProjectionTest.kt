package io.teslasync.android.featureviews.weekoverweeksummary

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the WeekOverWeekSummary pure projection — the native port of the web component's
 * inline derivations and formatting
 * (web/src/features/analytics/components/weekly-digest/WeekOverWeekSummary.tsx): the ordered six-tile value
 * list with the web `fmtNumber(_, 1)` / `fmtInt` / `formatCurrency(_, 2)` formatting and hardcoded unit
 * symbols, the per-card `trendFor(current, previous, invertPositive?)` comparison (flat / up / down arrow,
 * signed percentage, good/bad tone with inversion for energy / cost / efficiency), the `pctChange`
 * zero-previous branch, the `safeNumber` non-finite guard, the always-render empty-week contract, and the
 * currency-symbol read from `/settings`. Runs in the :app:testReleaseUnitTest gate; no Compose, no device.
 * Locale is pinned to US for deterministic grouping / separators.
 */
class WeekOverWeekSummaryProjectionTest {
    private val locale = Locale.US

    private val sample =
        WeekOverWeekMetrics(
            distance = WeekComparison(current = 412.6, previous = 380.2),
            drives = WeekComparison(current = 23.0, previous = 25.0),
            energy = WeekComparison(current = 78.4, previous = 81.0),
            cost = WeekComparison(current = 14.27, previous = 12.5),
            efficiency = WeekComparison(current = 168.3, previous = 171.0),
            co2 = WeekComparison(current = 31.7, previous = 29.1),
        )

    private fun project(
        metrics: WeekOverWeekMetrics = sample,
        currency: WeekDigestCurrencyPrefs = WeekDigestCurrencyPrefs.DEFAULT,
        loading: Boolean = false,
    ) = WeekOverWeekSummaryProjection.project(metrics, currency, loading, locale)

    private fun tile(metric: WeekMetric): WeekMetricTile = project().tiles.single { it.metric == metric }

    // ── tile set: order, values, units (web source's six StatCards) ───────────────────────────────────────

    @Test
    fun projectProducesSixTilesInWebSourceOrder() {
        val metrics = project().tiles.map { it.metric }
        assertEquals(
            listOf(
                WeekMetric.Distance,
                WeekMetric.Drives,
                WeekMetric.Energy,
                WeekMetric.Cost,
                WeekMetric.Efficiency,
                WeekMetric.Co2,
            ),
            metrics,
        )
    }

    @Test
    fun distanceTileFormatsOneDecimalWithKmUnit() {
        val distance = tile(WeekMetric.Distance)
        assertEquals("412.6", distance.value)
        assertEquals("km", distance.unit)
    }

    @Test
    fun drivesTileFormatsGroupedIntegerWithNoUnit() {
        val drives =
            WeekOverWeekSummaryProjection
                .project(sample.copy(drives = WeekComparison(1234.0, 25.0)), WeekDigestCurrencyPrefs.DEFAULT, false, locale)
                .tiles
                .single { it.metric == WeekMetric.Drives }
        assertEquals("1,234", drives.value)
        assertEquals(null, drives.unit)
    }

    @Test
    fun energyTileFormatsOneDecimalWithKwhUnit() {
        val energy = tile(WeekMetric.Energy)
        assertEquals("78.4", energy.value)
        assertEquals("kWh", energy.unit)
    }

    @Test
    fun costTileFormatsCurrencyWithSymbolAndTwoDecimalsNoUnit() {
        val cost = tile(WeekMetric.Cost)
        assertEquals("$14.27", cost.value)
        assertEquals(null, cost.unit)
    }

    @Test
    fun efficiencyTileFormatsOneDecimalWithWhPerKmUnit() {
        val efficiency = tile(WeekMetric.Efficiency)
        assertEquals("168.3", efficiency.value)
        assertEquals("Wh/km", efficiency.unit)
    }

    @Test
    fun co2TileFormatsOneDecimalWithKgUnit() {
        val co2 = tile(WeekMetric.Co2)
        assertEquals("31.7", co2.value)
        assertEquals("kg", co2.unit)
    }

    // ── per-card trends: direction, signed text, good/bad tone (web `trendFor`) ───────────────────────────

    @Test
    fun distanceTrendRisesAndReadsPositive() {
        val trend = tile(WeekMetric.Distance).trend
        assertEquals(TrendDirection.Up, trend.direction)
        assertEquals("+8.5%", trend.text)
        assertTrue(trend.positive)
    }

    @Test
    fun drivesTrendFallsAndReadsNegativeWhenNotInverted() {
        val trend = tile(WeekMetric.Drives).trend
        assertEquals(TrendDirection.Down, trend.direction)
        assertEquals("-8.0%", trend.text)
        assertFalse(trend.positive)
    }

    @Test
    fun energyTrendFallingReadsPositiveBecauseInverted() {
        val trend = tile(WeekMetric.Energy).trend
        assertEquals(TrendDirection.Down, trend.direction)
        assertEquals("-3.2%", trend.text)
        assertTrue(trend.positive)
    }

    @Test
    fun costTrendRisingReadsNegativeBecauseInverted() {
        val trend = tile(WeekMetric.Cost).trend
        assertEquals(TrendDirection.Up, trend.direction)
        assertEquals("+14.2%", trend.text)
        assertFalse(trend.positive)
    }

    @Test
    fun efficiencyTrendFallingReadsPositiveBecauseInverted() {
        val trend = tile(WeekMetric.Efficiency).trend
        assertEquals(TrendDirection.Down, trend.direction)
        assertEquals("-1.6%", trend.text)
        assertTrue(trend.positive)
    }

    @Test
    fun co2TrendRisingReadsPositive() {
        val trend = tile(WeekMetric.Co2).trend
        assertEquals(TrendDirection.Up, trend.direction)
        assertEquals("+8.9%", trend.text)
        assertTrue(trend.positive)
    }

    // ── trendFor / pctChange edge cases (web helpers) ─────────────────────────────────────────────────────

    @Test
    fun trendIsFlatZeroPercentWhenDeltaUnderEpsilon() {
        val trend = WeekOverWeekSummaryProjection.trendFor(100.0, 100.005, invertPositive = false, locale)
        assertEquals(TrendDirection.Flat, trend.direction)
        assertEquals("0%", trend.text)
        assertTrue(trend.positive)
    }

    @Test
    fun trendFlatStaysPositiveEvenWhenInverted() {
        val trend = WeekOverWeekSummaryProjection.trendFor(5.0, 5.0, invertPositive = true, locale)
        assertEquals(TrendDirection.Flat, trend.direction)
        assertTrue(trend.positive)
    }

    @Test
    fun trendRisingDownInversionFlipsToneNotArrow() {
        val rising = WeekOverWeekSummaryProjection.trendFor(120.0, 100.0, invertPositive = true, locale)
        assertEquals(TrendDirection.Up, rising.direction)
        assertEquals("+20.0%", rising.text)
        assertFalse(rising.positive)
    }

    @Test
    fun pctChangeZeroPreviousIsHundredWhenCurrentPositive() {
        assertEquals(100.0, WeekOverWeekSummaryProjection.pctChange(5.0, 0.0), 1e-9)
    }

    @Test
    fun pctChangeZeroPreviousIsZeroWhenCurrentNotPositive() {
        assertEquals(0.0, WeekOverWeekSummaryProjection.pctChange(0.0, 0.0), 1e-9)
    }

    @Test
    fun pctChangeUsesMagnitudeOfPreviousForNegativeBase() {
        assertEquals(-50.0, WeekOverWeekSummaryProjection.pctChange(-15.0, -10.0), 1e-9)
    }

    @Test
    fun zeroPreviousProducesPlusHundredTrend() {
        val trend = WeekOverWeekSummaryProjection.trendFor(10.0, 0.0, invertPositive = false, locale)
        assertEquals(TrendDirection.Up, trend.direction)
        assertEquals("+100.0%", trend.text)
        assertTrue(trend.positive)
    }

    // ── formatters: web `fmtNumber` / `fmtInt` / `formatCurrency` / `safeNumber` ───────────────────────────

    @Test
    fun formatNumberGroupsThousandsAndFixesDecimals() {
        assertEquals("1,234.6", WeekOverWeekSummaryProjection.formatNumber(1_234.56, 1, locale))
    }

    @Test
    fun formatNumberCoercesNonFiniteToZero() {
        assertEquals("0.0", WeekOverWeekSummaryProjection.formatNumber(Double.NaN, 1, locale))
        assertEquals("0.0", WeekOverWeekSummaryProjection.formatNumber(Double.POSITIVE_INFINITY, 1, locale))
    }

    @Test
    fun formatCurrencyAppliesSymbolPrecisionGroupingAndBlankFallback() {
        assertEquals("$1,234.50", WeekOverWeekSummaryProjection.formatCurrency(1_234.5, "$", 2, locale))
        assertEquals("\u20AC9.99", WeekOverWeekSummaryProjection.formatCurrency(9.99, "\u20AC", 2, locale))
        assertEquals("$5.00", WeekOverWeekSummaryProjection.formatCurrency(5.0, "   ", 2, locale))
        assertEquals("$0.00", WeekOverWeekSummaryProjection.formatCurrency(Double.NaN, "$", 2, locale))
    }

    @Test
    fun safeNormalizesNonFiniteToZero() {
        assertEquals(0.0, WeekOverWeekSummaryProjection.safe(Double.NaN), 0.0)
        assertEquals(7.5, WeekOverWeekSummaryProjection.safe(7.5), 0.0)
    }

    // ── loading flag + always-render empty-week contract ──────────────────────────────────────────────────

    @Test
    fun loadingFlagThreadsIntoDisplay() {
        assertTrue(project(loading = true).loading)
        assertFalse(project(loading = false).loading)
    }

    @Test
    fun emptyWeekRendersZerosNotBlankCards() {
        val display = project(metrics = WeekOverWeekMetrics.EMPTY)
        assertEquals(6, display.tiles.size)
        assertEquals("0.0", display.tiles.single { it.metric == WeekMetric.Distance }.value)
        assertEquals("0", display.tiles.single { it.metric == WeekMetric.Drives }.value)
        assertEquals("$0.00", display.tiles.single { it.metric == WeekMetric.Cost }.value)
        // A flat zero-vs-zero week reads as a flat "0%" trend on every card, never a hidden card.
        assertTrue(display.tiles.all { it.trend.direction == TrendDirection.Flat })
    }

    @Test
    fun customCurrencySymbolFormatsTheCostCard() {
        val cost =
            WeekOverWeekSummaryProjection
                .project(sample, WeekDigestCurrencyPrefs("\u00A3"), false, locale)
                .tiles
                .single { it.metric == WeekMetric.Cost }
        assertEquals("\u00A314.27", cost.value)
    }

    // ── currency prefs: web `useFormatting` currency-symbol read ──────────────────────────────────────────

    @Test
    fun currencyPrefsReadSymbolWithDollarFallback() {
        val withSymbol = Json.parseToJsonElement("""{ "currency_symbol": "\u00A3" }""")
        assertEquals("\u00A3", WeekDigestCurrencyPrefs.fromSettings(withSymbol).currencySymbol)
        val blank = Json.parseToJsonElement("""{ "currency_symbol": "  " }""")
        assertEquals("$", WeekDigestCurrencyPrefs.fromSettings(blank).currencySymbol)
        assertEquals("$", WeekDigestCurrencyPrefs.fromSettings(null).currencySymbol)
    }
}
