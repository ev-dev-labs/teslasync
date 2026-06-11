package io.teslasync.android.featureviews.chargingdetailsection

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the ChargingDetailSection pure projection — the native port of the web
 * component's inline derivations and formatting
 * (web/src/features/analytics/components/analytics/ChargingDetailSection.tsx): the `(data, isLoading)`
 * lifecycle adapter, the brand-leaderboard fractions (web `pct = count / maxCount`), the charger-type
 * share bars (web `{count} ({fmtInt(pct)}%)`), the four `formatCurrency(safe(x), 2)` cost values, the
 * monthly chart series, the null-safe `/analytics/fleet` decode, and the PII-safe `view.opened`
 * diagnostic. Runs in the :app:testReleaseUnitTest gate; no Compose, no device. Locale is pinned for
 * deterministic grouping/separators.
 */
class ChargingDetailSectionProjectionTest {
    private val locale = Locale.US

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    // ── (data, isLoading) → lifecycle UiState adapter ───────────────────────────────────────────────────

    @Test
    fun loadingTakesPrecedenceEvenWithData() {
        val state = ChargingDetailSectionProjection.projectUiState(ChargingAnalyticsData.EMPTY, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun contentWhenDataPresentAndNotLoading() {
        val data = ChargingAnalyticsData(emptyList(), emptyList(), emptyList(), null)
        val state = ChargingDetailSectionProjection.projectUiState(data, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(data, state.data)
    }

    @Test
    fun emptyWhenNoDataAndNotLoading() {
        val state = ChargingDetailSectionProjection.projectUiState(data = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
    }

    // ── brandLeaderboard: order, rank, grouped count, fraction (web `pct = count / maxCount`) ────────────

    @Test
    fun brandLeaderboardKeepsOrderRanksAndScalesToMax() {
        val brands =
            listOf(
                ChargerBrand("Tesla Supercharger", 1_204),
                ChargerBrand("Home", 877),
                ChargerBrand("Electrify America", 132),
            )
        val bars = ChargingDetailSectionProjection.brandLeaderboard(brands, locale)
        assertEquals(listOf(1, 2, 3), bars.map { it.rank })
        assertEquals(listOf("Tesla Supercharger", "Home", "Electrify America"), bars.map { it.brand })
        // Grouped count (web `fmtInt`).
        assertEquals("1,204", bars[0].countText)
        // The bar fills count ÷ maxCount; max is the leader's count for every row.
        assertEquals(1_204.0, bars[0].max, 0.0)
        assertEquals(1_204.0, bars[0].value, 0.0)
        assertEquals(877.0, bars[1].value, 0.0)
        assertEquals(1_204.0, bars[1].max, 0.0)
    }

    @Test
    fun brandLeaderboardFloorsMaxAtOneWhenAllZero() {
        // Web `... || 1` guard: a zero leader must not divide by zero.
        val bars = ChargingDetailSectionProjection.brandLeaderboard(listOf(ChargerBrand("A", 0), ChargerBrand("B", 0)), locale)
        assertEquals(1.0, bars[0].max, 0.0)
        assertEquals(0.0, bars[0].value, 0.0)
    }

    @Test
    fun brandLeaderboardIsEmptyForNoBrands() {
        assertTrue(ChargingDetailSectionProjection.brandLeaderboard(emptyList(), locale).isEmpty())
    }

    // ── chargerTypeBars: raw count + grouped percent, share fraction (web `count / totalSessions`) ───────

    @Test
    fun chargerTypeBarsComputeSharePercentAndRawCountLabel() {
        val types =
            listOf(
                ChargerType("DC Fast", 612),
                ChargerType("Level 2", 1_388),
                ChargerType("Level 1", 213),
            )
        val bars = ChargingDetailSectionProjection.chargerTypeBars(types, locale)
        // total = 2213. Web label is the raw count then the grouped, rounded percentage.
        assertEquals("612 (28%)", bars[0].valueText)
        assertEquals("1388 (63%)", bars[1].valueText)
        assertEquals("213 (10%)", bars[2].valueText)
        // Bars scale to the session total; the color index is the source position.
        assertEquals(2_213.0, bars[0].max, 0.0)
        assertEquals(612.0, bars[0].value, 0.0)
        assertEquals(listOf(0, 1, 2), bars.map { it.colorIndex })
    }

    @Test
    fun chargerTypeBarsZeroTotalYieldsZeroPercent() {
        val bars = ChargingDetailSectionProjection.chargerTypeBars(listOf(ChargerType("DC", 0)), locale)
        assertEquals("0 (0%)", bars[0].valueText)
        assertEquals(0.0, bars[0].max, 0.0)
    }

    // ── costCards: presence gate + web `formatCurrency(safe(x), 2)` ──────────────────────────────────────

    @Test
    fun costCardsFormatFourValuesWithCurrencyAndTwoDecimals() {
        val cards =
            ChargingDetailSectionProjection.costCards(
                CostStats(min = 1.24, avg = 8.97, median = 7.5, max = 42.1),
                ChargingCurrencyPrefs("$"),
                locale,
            )
        assertEquals("$1.24", cards?.min)
        assertEquals("$8.97", cards?.avg)
        assertEquals("$7.50", cards?.median)
        assertEquals("$42.10", cards?.max)
    }

    @Test
    fun costCardsAreNullWhenStatsMissing() {
        assertNull(ChargingDetailSectionProjection.costCards(null, ChargingCurrencyPrefs("$"), locale))
    }

    @Test
    fun costCardsHonorCustomCurrencySymbol() {
        val cards =
            ChargingDetailSectionProjection.costCards(
                CostStats(min = 1.0, avg = 2.0, median = 3.0, max = 4.0),
                ChargingCurrencyPrefs("\u20AC"),
                locale,
            )
        assertEquals("\u20AC1.00", cards?.min)
    }

    // ── monthlyChart: labels + series, empty guard ──────────────────────────────────────────────────────

    @Test
    fun monthlyChartProjectsLabelsAndSeriesInOrder() {
        val points =
            listOf(
                MonthlyChargingPoint("Jan", energy = 412.0, avgPower = 48.0, sessions = 22),
                MonthlyChargingPoint("Feb", energy = 388.0, avgPower = 51.0, sessions = 19),
            )
        val chart = ChargingDetailSectionProjection.monthlyChart(points)
        assertEquals(listOf("Jan", "Feb"), chart.labels)
        assertEquals(listOf(412.0, 388.0), chart.energy)
        assertEquals(listOf(48.0, 51.0), chart.avgPower)
        assertEquals(listOf(22.0, 19.0), chart.sessions)
        assertTrue(!chart.isEmpty)
    }

    @Test
    fun monthlyChartIsEmptyForNoPoints() {
        assertTrue(ChargingDetailSectionProjection.monthlyChart(emptyList()).isEmpty)
    }

    // ── formatCount / formatCurrency / safeValue (web `fmtInt` / `formatCurrency` / `safe`) ──────────────

    @Test
    fun formatCountGroupsThousandsAndRoundsHalfUp() {
        assertEquals("1,204", ChargingDetailSectionProjection.formatCount(1_204.0, locale))
        assertEquals("28", ChargingDetailSectionProjection.formatCount(27.654, locale))
        assertEquals("3", ChargingDetailSectionProjection.formatCount(2.5, locale))
        assertEquals("0", ChargingDetailSectionProjection.formatCount(0.0, locale))
    }

    @Test
    fun formatCurrencyAppliesSymbolPrecisionGroupingAndSafeFallbacks() {
        assertEquals("$1,234.50", ChargingDetailSectionProjection.formatCurrency(1_234.5, "$", 2, locale))
        assertEquals("\u20AC9.999", ChargingDetailSectionProjection.formatCurrency(9.999, "\u20AC", 3, locale))
        // Blank symbol falls back to `$` (web default).
        assertEquals("$5.00", ChargingDetailSectionProjection.formatCurrency(5.0, "   ", 2, locale))
        // Non-finite amount is normalized to 0 (web `safe`).
        assertEquals("$0.00", ChargingDetailSectionProjection.formatCurrency(Double.NaN, "$", 2, locale))
    }

    @Test
    fun safeValueZeroesNonFiniteInput() {
        assertEquals(0.0, safeValue(Double.NaN), 0.0)
        assertEquals(0.0, safeValue(Double.POSITIVE_INFINITY), 0.0)
        assertEquals(12.5, safeValue(12.5), 0.0)
    }

    // ── parse: null-safe decode of the raw /analytics/fleet document ─────────────────────────────────────

    @Test
    fun parseDecodesChargingAnalyticsSlice() {
        val doc =
            Json.parseToJsonElement(
                """
                {
                  "charging_analytics": {
                    "charger_brands": [
                      { "brand": "Tesla", "count": 1204 },
                      { "brand": "Home", "count": 877 }
                    ],
                    "charger_types": [ { "type": "DC Fast", "count": 612 } ],
                    "monthly_trend": [
                      { "month": "Jan", "energy": 412.0, "avg_power": 48.0, "sessions": 22, "cost": 3.0 }
                    ],
                    "cost_stats": { "min": 1.24, "avg": 8.97, "median": 7.5, "max": 42.1, "p95": 40.0, "count": 100 }
                  }
                }
                """.trimIndent(),
            )
        val data = ChargingDetailSectionProjection.parse(doc)
        assertEquals(2, data.brands.size)
        assertEquals(ChargerBrand("Tesla", 1_204), data.brands[0])
        assertEquals(1, data.chargerTypes.size)
        assertEquals(ChargerType("DC Fast", 612), data.chargerTypes[0])
        assertEquals(1, data.monthlyTrend.size)
        assertEquals(MonthlyChargingPoint("Jan", 412.0, 48.0, 22), data.monthlyTrend[0])
        assertEquals(CostStats(1.24, 8.97, 7.5, 42.1), data.costStats)
    }

    @Test
    fun parseDegradesToEmptyOnMissingOrNullDocument() {
        assertEquals(ChargingAnalyticsData.EMPTY, ChargingDetailSectionProjection.parse(null))
        val noSlice = Json.parseToJsonElement("""{ "drive_analytics": {} }""")
        val data = ChargingDetailSectionProjection.parse(noSlice)
        assertTrue(data.brands.isEmpty())
        assertTrue(data.chargerTypes.isEmpty())
        assertTrue(data.monthlyTrend.isEmpty())
        assertNull(data.costStats)
    }

    @Test
    fun parseToleratesPartialPayloadWithoutThrowing() {
        val partial =
            Json.parseToJsonElement(
                """{ "charging_analytics": { "charger_brands": [ { "brand": "Tesla" } ] } }""",
            )
        val data = ChargingDetailSectionProjection.parse(partial)
        // A brand with no count decodes to 0; the other slices stay empty / null.
        assertEquals(ChargerBrand("Tesla", 0), data.brands.single())
        assertNull(data.costStats)
    }

    // ── currency prefs (web `useFormatting` currency symbol) ─────────────────────────────────────────────

    @Test
    fun currencyPrefsReadSymbolWithDollarFallback() {
        val withSymbol = Json.parseToJsonElement("""{ "currency_symbol": "\u00A3" }""")
        assertEquals("\u00A3", ChargingCurrencyPrefs.fromSettings(withSymbol).currencySymbol)
        val blank = Json.parseToJsonElement("""{ "currency_symbol": "  " }""")
        assertEquals("$", ChargingCurrencyPrefs.fromSettings(blank).currencySymbol)
        assertEquals("$", ChargingCurrencyPrefs.fromSettings(null).currencySymbol)
    }

    // ── Diagnostics (P1/S11 view.opened) ─────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordChargingDetailSectionOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "ChargingDetailSection"), opened.single().second)
        assertEquals("ChargingDetailSection", ChargingDetailSectionRegistration.SLUG)
    }
}
