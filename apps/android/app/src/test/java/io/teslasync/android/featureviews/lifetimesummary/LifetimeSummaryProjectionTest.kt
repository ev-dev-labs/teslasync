package io.teslasync.android.featureviews.lifetimesummary

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the LifetimeSummary pure projection — the native port of the web component's
 * inline derivations and formatting
 * (web/src/features/charging/components/cost-analysis/LifetimeSummary.tsx): the ordered seven-tile value list
 * with the web `formatCurrency(_, 2)` / `fmtWithUnit(_, 'kWh', 1)` / `fmtInt` / `fmtNumber(_, 0) + ' min'`
 * formatting and the free-sessions composite, the `safeNumber` non-finite guard, the
 * `lifetimeMetrics && coreStats` data gate (grid vs "No data"), the host loading flag, and the
 * currency-symbol read from `/settings`. Runs in the :android:testReleaseUnitTest gate; no Compose, no
 * device. Locale is pinned to US for deterministic grouping / separators.
 */
class LifetimeSummaryProjectionTest {
    private val locale = Locale.US

    private val core =
        LifetimeCoreStats(totalCost = 1284.57, totalEnergy = 4210.6, count = 312.0)

    private val metrics =
        LifetimeMetricsData(
            avgSessionCost = 4.12,
            avgSessionEnergy = 13.5,
            avgDuration = 42.0,
            freeCount = 18.0,
            freeEnergy = 210.4,
        )

    private fun project(
        coreStats: LifetimeCoreStats? = core,
        lifetimeMetrics: LifetimeMetricsData? = metrics,
        currency: LifetimeCurrencyPrefs = LifetimeCurrencyPrefs.DEFAULT,
        loading: Boolean = false,
    ) = LifetimeSummaryProjection.project(coreStats, lifetimeMetrics, currency, loading, locale)

    private fun tile(kind: LifetimeMetricKind): LifetimeTile = project().tiles.single { it.kind == kind }

    // ── tile set: order + formatted values (web source's seven LifetimeMetrics) ───────────────────────────

    @Test
    fun projectProducesSevenTilesInWebSourceOrder() {
        val kinds = project().tiles.map { it.kind }
        assertEquals(
            listOf(
                LifetimeMetricKind.TotalSpent,
                LifetimeMetricKind.TotalEnergy,
                LifetimeMetricKind.TotalSessions,
                LifetimeMetricKind.AvgSessionCost,
                LifetimeMetricKind.AvgEnergy,
                LifetimeMetricKind.AvgDuration,
                LifetimeMetricKind.FreeSessions,
            ),
            kinds,
        )
    }

    @Test
    fun totalSpentFormatsCurrencyWithTwoDecimals() {
        assertEquals("$1,284.57", tile(LifetimeMetricKind.TotalSpent).value)
    }

    @Test
    fun totalEnergyFormatsOneDecimalWithKwhUnit() {
        assertEquals("4,210.6 kWh", tile(LifetimeMetricKind.TotalEnergy).value)
    }

    @Test
    fun totalSessionsFormatsGroupedInteger() {
        val value =
            LifetimeSummaryProjection
                .project(core.copy(count = 1234.0), metrics, LifetimeCurrencyPrefs.DEFAULT, false, locale)
                .tiles
                .single { it.kind == LifetimeMetricKind.TotalSessions }
                .value
        assertEquals("1,234", value)
    }

    @Test
    fun avgSessionCostFormatsCurrencyWithTwoDecimals() {
        assertEquals("$4.12", tile(LifetimeMetricKind.AvgSessionCost).value)
    }

    @Test
    fun avgEnergyFormatsOneDecimalWithKwhUnit() {
        assertEquals("13.5 kWh", tile(LifetimeMetricKind.AvgEnergy).value)
    }

    @Test
    fun avgDurationFormatsWholeMinutesWithMinUnit() {
        assertEquals("42 min", tile(LifetimeMetricKind.AvgDuration).value)
    }

    @Test
    fun freeSessionsFormatsCountWithParenthesizedEnergy() {
        assertEquals("18 (210.4 kWh)", tile(LifetimeMetricKind.FreeSessions).value)
    }

    // ── data gate: web `lifetimeMetrics && coreStats ? grid : "No data"` ──────────────────────────────────

    @Test
    fun bothPropsPresentResolvesToSevenTiles() {
        val display = project()
        assertTrue(display.hasData)
        assertEquals(TILE_SET_SIZE, display.tiles.size)
    }

    @Test
    fun missingCoreStatsResolvesToNoData() {
        val display = project(coreStats = null)
        assertFalse(display.hasData)
        assertTrue(display.tiles.isEmpty())
    }

    @Test
    fun missingLifetimeMetricsResolvesToNoData() {
        val display = project(lifetimeMetrics = null)
        assertFalse(display.hasData)
        assertTrue(display.tiles.isEmpty())
    }

    @Test
    fun bothPropsMissingResolvesToNoData() {
        val display = project(coreStats = null, lifetimeMetrics = null)
        assertFalse(display.hasData)
        assertTrue(display.tiles.isEmpty())
    }

    @Test
    fun loadingFlagThreadsIntoDisplayIndependentOfData() {
        assertTrue(project(loading = true).loading)
        assertFalse(project(loading = false).loading)
        // The loading flag does not suppress the projected tiles; the composable chooses the skeleton branch.
        assertEquals(TILE_SET_SIZE, project(loading = true).tiles.size)
    }

    // ── always-render contract: zeros format, never a blank tile ──────────────────────────────────────────

    @Test
    fun zeroValuesFormatRatherThanBlanking() {
        val display =
            LifetimeSummaryProjection.project(
                LifetimeCoreStats(totalCost = 0.0, totalEnergy = 0.0, count = 0.0),
                LifetimeMetricsData(0.0, 0.0, 0.0, 0.0, 0.0),
                LifetimeCurrencyPrefs.DEFAULT,
                false,
                locale,
            )
        assertEquals("$0.00", display.tiles.single { it.kind == LifetimeMetricKind.TotalSpent }.value)
        assertEquals("0.0 kWh", display.tiles.single { it.kind == LifetimeMetricKind.TotalEnergy }.value)
        assertEquals("0", display.tiles.single { it.kind == LifetimeMetricKind.TotalSessions }.value)
        assertEquals("0 min", display.tiles.single { it.kind == LifetimeMetricKind.AvgDuration }.value)
        assertEquals("0 (0.0 kWh)", display.tiles.single { it.kind == LifetimeMetricKind.FreeSessions }.value)
        assertTrue(display.tiles.none { it.value.isBlank() })
    }

    // ── formatters: web `fmtNumber` / `fmtInt` / `formatCurrency` / `fmtWithUnit` / `safeNumber` ───────────

    @Test
    fun formatNumberGroupsThousandsAndFixesDecimals() {
        assertEquals("1,234.6", LifetimeSummaryProjection.formatNumber(1_234.56, 1, locale))
    }

    @Test
    fun formatNumberCoercesNonFiniteToZero() {
        assertEquals("0.0", LifetimeSummaryProjection.formatNumber(Double.NaN, 1, locale))
        assertEquals("0.0", LifetimeSummaryProjection.formatNumber(Double.POSITIVE_INFINITY, 1, locale))
    }

    @Test
    fun formatWithUnitAppendsUnitAfterSpace() {
        assertEquals("42.6 kWh", LifetimeSummaryProjection.formatWithUnit(42.567, "kWh", 1, locale))
        assertEquals("30 min", LifetimeSummaryProjection.formatWithUnit(30.0, "min", 0, locale))
    }

    @Test
    fun formatCountFormatsGroupedInteger() {
        assertEquals("12,345", LifetimeSummaryProjection.formatCount(12_345.0, locale))
        assertEquals("0", LifetimeSummaryProjection.formatCount(0.0, locale))
    }

    @Test
    fun formatCurrencyAppliesSymbolPrecisionGroupingAndBlankFallback() {
        assertEquals("$1,234.50", LifetimeSummaryProjection.formatCurrency(1_234.5, "$", 2, locale))
        assertEquals("\u20AC9.99", LifetimeSummaryProjection.formatCurrency(9.99, "\u20AC", 2, locale))
        assertEquals("$5.00", LifetimeSummaryProjection.formatCurrency(5.0, "   ", 2, locale))
        assertEquals("$0.00", LifetimeSummaryProjection.formatCurrency(Double.NaN, "$", 2, locale))
    }

    @Test
    fun formatFreeSessionsComposesCountAndEnergy() {
        assertEquals("0 (0.0 kWh)", LifetimeSummaryProjection.formatFreeSessions(0.0, 0.0, locale))
        assertEquals(
            "1,200 (3,400.5 kWh)",
            LifetimeSummaryProjection.formatFreeSessions(1_200.0, 3_400.5, locale),
        )
    }

    @Test
    fun safeNormalizesNonFiniteToZero() {
        assertEquals(0.0, LifetimeSummaryProjection.safe(Double.NaN), 0.0)
        assertEquals(0.0, LifetimeSummaryProjection.safe(Double.NEGATIVE_INFINITY), 0.0)
        assertEquals(7.5, LifetimeSummaryProjection.safe(7.5), 0.0)
    }

    @Test
    fun customCurrencySymbolFormatsTheCostTiles() {
        val display = project(currency = LifetimeCurrencyPrefs("\u00A3"))
        assertEquals("\u00A31,284.57", display.tiles.single { it.kind == LifetimeMetricKind.TotalSpent }.value)
        assertEquals("\u00A34.12", display.tiles.single { it.kind == LifetimeMetricKind.AvgSessionCost }.value)
    }

    // ── currency prefs: web `useFormatting` currency-symbol read ──────────────────────────────────────────

    @Test
    fun currencyPrefsReadSymbolWithDollarFallback() {
        val withSymbol = Json.parseToJsonElement("""{ "currency_symbol": "\u00A3" }""")
        assertEquals("\u00A3", LifetimeCurrencyPrefs.fromSettings(withSymbol).currencySymbol)
        val blank = Json.parseToJsonElement("""{ "currency_symbol": "  " }""")
        assertEquals("$", LifetimeCurrencyPrefs.fromSettings(blank).currencySymbol)
        assertEquals("$", LifetimeCurrencyPrefs.fromSettings(null).currencySymbol)
    }

    private companion object {
        const val TILE_SET_SIZE = 7
    }
}
