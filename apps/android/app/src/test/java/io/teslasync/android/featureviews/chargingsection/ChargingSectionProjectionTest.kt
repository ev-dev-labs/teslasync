package io.teslasync.android.featureviews.chargingsection

import io.teslasync.android.data.UiPhase
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the ChargingSection's pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/analytics/components/weekly-digest/ChargingSection.tsx and its
 * `helpers.ts`/`useFormatting`): the four `MiniStat` value expressions, the `<BarChart data>` binding, and
 * the `<Badge>` week-over-week percent + tone. Because the surface is purely presentational, each projected
 * value is exactly what the thin composable renders, so these assertions double as the per-state "snapshot".
 * Every formatter is pinned to [Locale.US] for determinism (one locale-grouping case proves locale awareness).
 */
class ChargingSectionProjectionTest {
    private val sampleMetrics =
        ChargingDigestMetrics(
            chargeEnergyAdded = 312.4,
            prevChargeEnergy = 280.0,
            avgChargeRate = 48.6,
            chargingCost = 41.266,
            chargingSessionCount = 1_204,
        )

    // ── projectUiState(): the three lifecycle phases ─────────────────────────────

    @Test
    fun projectUiStateLoadingWinsOutright() {
        val state = ChargingSectionProjection.projectUiState(ChargingDigestData.EMPTY, isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun projectUiStatePresentDataIsContent() {
        val data = ChargingDigestData(sampleMetrics, listOf(DailyEnergyPoint("Mon", 42.0)))
        val state = ChargingSectionProjection.projectUiState(data, isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(data, state.data)
    }

    @Test
    fun projectUiStateAbsentDataIsEmpty() {
        val state = ChargingSectionProjection.projectUiState(null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
    }

    // ── statValues(): the four MiniStat value expressions ────────────────────────

    @Test
    fun statValuesFormatEveryTileLikeTheWebMiniStats() {
        val stats = ChargingSectionProjection.statValues(sampleMetrics, ChargingCurrencyPrefs("$"), Locale.US)
        // fmtInt(1204) → grouped integer.
        assertEquals("1,204", stats.sessions)
        // `${fmtNumber(312.4, 1)} kWh`.
        assertEquals("312.4 kWh", stats.totalEnergyAdded)
        // `${fmtNumber(48.6, 1)} kW`.
        assertEquals("48.6 kW", stats.avgChargeRate)
        // formatCurrency(41.266, 2) → `$` + half-up 2-decimal.
        assertEquals("$41.27", stats.totalCost)
    }

    @Test
    fun statValuesZeroMetricsRenderZerosNeverBlank() {
        val stats = ChargingSectionProjection.statValues(ChargingDigestMetrics.ZERO, ChargingCurrencyPrefs("$"), Locale.US)
        assertEquals("0", stats.sessions)
        assertEquals("0.0 kWh", stats.totalEnergyAdded)
        assertEquals("0.0 kW", stats.avgChargeRate)
        assertEquals("$0.00", stats.totalCost)
    }

    @Test
    fun statValuesHonorTheCurrencySymbolFromSettings() {
        val stats = ChargingSectionProjection.statValues(sampleMetrics, ChargingCurrencyPrefs("€"), Locale.US)
        assertEquals("€41.27", stats.totalCost)
    }

    // ── barData(): the <BarChart data> binding ───────────────────────────────────

    @Test
    fun barDataPreservesDayOrderAndValues() {
        val points = listOf(DailyEnergyPoint("Mon", 42.0), DailyEnergyPoint("Tue", 0.0), DailyEnergyPoint("Wed", 61.5))
        val bar = ChargingSectionProjection.barData(points)
        assertEquals(listOf("Mon", "Tue", "Wed"), bar.labels)
        assertEquals(listOf(42.0, 0.0, 61.5), bar.values)
        assertFalse(bar.isEmpty)
    }

    @Test
    fun barDataNormalizesNonFiniteSamplesToZero() {
        val points = listOf(DailyEnergyPoint("Mon", Double.NaN), DailyEnergyPoint("Tue", Double.POSITIVE_INFINITY))
        val bar = ChargingSectionProjection.barData(points)
        assertEquals(listOf(0.0, 0.0), bar.values)
    }

    @Test
    fun barDataIsEmptyForNoDays() {
        val bar = ChargingSectionProjection.barData(emptyList())
        assertTrue(bar.isEmpty)
        assertTrue(bar.labels.isEmpty())
        assertTrue(bar.values.isEmpty())
    }

    // ── energyTrend(): the <Badge> content + variant ─────────────────────────────

    @Test
    fun energyTrendUpWeekIsPositiveWithSignedPercent() {
        val trend = ChargingSectionProjection.energyTrend(sampleMetrics, Locale.US)
        // (312.4 - 280) / 280 * 100 = 11.571…% → 1-decimal half-up.
        assertEquals("11.6%", trend.text)
        assertTrue(trend.positive)
    }

    @Test
    fun energyTrendDownWeekIsNegativeAndWarning() {
        val down = sampleMetrics.copy(chargeEnergyAdded = 200.0, prevChargeEnergy = 280.0)
        val trend = ChargingSectionProjection.energyTrend(down, Locale.US)
        // (200 - 280) / 280 * 100 = -28.571…% → "-28.6%".
        assertEquals("-28.6%", trend.text)
        assertFalse(trend.positive)
    }

    @Test
    fun energyTrendWithoutPriorBaselineShowsDashAndStaysPositive() {
        val noBaseline = sampleMetrics.copy(chargeEnergyAdded = 50.0, prevChargeEnergy = 0.0)
        val trend = ChargingSectionProjection.energyTrend(noBaseline, Locale.US)
        // Web `prevChargeEnergy > 0 ? … : '—'`; 50 >= 0 keeps the success tone.
        assertEquals(EM_DASH, trend.text)
        assertTrue(trend.positive)
    }

    @Test
    fun energyTrendEmptyWeekShowsDash() {
        val trend = ChargingSectionProjection.energyTrend(ChargingDigestMetrics.ZERO, Locale.US)
        assertEquals(EM_DASH, trend.text)
        assertTrue(trend.positive)
    }

    // ── pctChange(): verbatim web helper ─────────────────────────────────────────

    @Test
    fun pctChangeZeroBaselineYields100WhenCurrentPositiveElse0() {
        assertEquals(100.0, ChargingSectionProjection.pctChange(5.0, 0.0), 0.0)
        assertEquals(0.0, ChargingSectionProjection.pctChange(0.0, 0.0), 0.0)
        assertEquals(0.0, ChargingSectionProjection.pctChange(-5.0, 0.0), 0.0)
    }

    @Test
    fun pctChangeUsesAbsoluteBaselineLikeTheWeb() {
        assertEquals(50.0, ChargingSectionProjection.pctChange(150.0, 100.0), 1e-9)
        // Web `Math.abs(previous)`: a negative baseline still divides by its magnitude.
        assertEquals(300.0, ChargingSectionProjection.pctChange(10.0, -5.0), 1e-9)
    }

    // ── fmtNumber()/formatInt()/formatCurrency(): web fmtNumber parity ───────────

    @Test
    fun fmtNumberRoundsHalfAwayFromZeroToMatchIntlNumberFormat() {
        // Intl.NumberFormat halfExpand: 62.5 → "63", not banker's "62".
        assertEquals("63", ChargingSectionProjection.fmtNumber(62.5, 0, Locale.US))
        assertEquals("1,234.6", ChargingSectionProjection.fmtNumber(1234.56, 1, Locale.US))
        assertEquals("-12.3", ChargingSectionProjection.fmtNumber(-12.34, 1, Locale.US))
    }

    @Test
    fun fmtNumberCoercesNonFiniteToZeroLikeSafeNumber() {
        assertEquals("0.0", ChargingSectionProjection.fmtNumber(Double.NaN, 1, Locale.US))
        assertEquals("0", ChargingSectionProjection.fmtNumber(Double.POSITIVE_INFINITY, 0, Locale.US))
    }

    @Test
    fun fmtNumberAppliesLocaleGrouping() {
        assertEquals("1,234,567.0", ChargingSectionProjection.fmtNumber(1_234_567.0, 1, Locale.US))
        val german = ChargingSectionProjection.fmtNumber(1234.5, 1, Locale.GERMANY)
        // German uses '.' grouping + ',' decimal — must differ from the US "1,234.5".
        assertEquals("1.234,5", german)
    }

    @Test
    fun formatIntGroupsWithoutDecimals() {
        assertEquals("0", ChargingSectionProjection.formatInt(0, Locale.US))
        assertEquals("1,204", ChargingSectionProjection.formatInt(1_204, Locale.US))
    }

    @Test
    fun formatCurrencyFallsBackToDollarForABlankSymbol() {
        assertEquals("$10.00", ChargingSectionProjection.formatCurrency(10.0, "", 2, Locale.US))
        assertEquals("€10.00", ChargingSectionProjection.formatCurrency(10.0, "€", 2, Locale.US))
    }

    // ── parse(): tolerant decode of the digest document ──────────────────────────

    @Test
    fun parseReadsMetricsAndDailySeriesFromADigestDocument() {
        val doc =
            buildJsonObject {
                put(
                    "metrics",
                    buildJsonObject {
                        put("chargeEnergyAdded", 312.4)
                        put("prevChargeEnergy", 280.0)
                        put("avgChargeRate", 48.6)
                        put("chargingCost", 41.27)
                        put("chargingSessionCount", 12)
                    },
                )
                put(
                    "dailyEnergyData",
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("day", "Mon")
                                put("energy", 42.0)
                            },
                        )
                        add(
                            buildJsonObject {
                                put("day", "Tue")
                                put("energy", 0.0)
                            },
                        )
                    },
                )
            }
        val data = ChargingSectionProjection.parse(doc)
        assertEquals(312.4, data.metrics.chargeEnergyAdded, 0.0)
        assertEquals(280.0, data.metrics.prevChargeEnergy, 0.0)
        assertEquals(48.6, data.metrics.avgChargeRate, 0.0)
        assertEquals(41.27, data.metrics.chargingCost, 0.0)
        assertEquals(12L, data.metrics.chargingSessionCount)
        assertEquals(listOf("Mon", "Tue"), data.dailyEnergy.map { it.day })
        assertEquals(listOf(42.0, 0.0), data.dailyEnergy.map { it.energy })
    }

    @Test
    fun parseDegradesToEmptyForMissingOrMalformedInput() {
        assertEquals(ChargingDigestData.EMPTY, ChargingSectionProjection.parse(null))
        assertEquals(ChargingDigestData.EMPTY, ChargingSectionProjection.parse(JsonNull))
        // An object with neither a `metrics` object nor any recognizable field yields zeros + no days.
        val partial = ChargingSectionProjection.parse(buildJsonObject { put("unrelated", true) })
        assertEquals(ChargingDigestMetrics.ZERO, partial.metrics)
        assertTrue(partial.dailyEnergy.isEmpty())
    }

    @Test
    fun parseReadsMetricsFromTheRootWhenThereIsNoMetricsObject() {
        val doc =
            buildJsonObject {
                put("chargeEnergyAdded", 100.0)
                put("chargingSessionCount", 3)
            }
        val data = ChargingSectionProjection.parse(doc)
        assertEquals(100.0, data.metrics.chargeEnergyAdded, 0.0)
        assertEquals(3L, data.metrics.chargingSessionCount)
    }

    // ── ChargingCurrencyPrefs.fromSettings(): web useFormatting symbol read ───────

    @Test
    fun currencyPrefsResolvesTheSymbolOrFallsBackToDollar() {
        val euro = ChargingCurrencyPrefs.fromSettings(buildJsonObject { put("currency_symbol", "€") })
        assertEquals("€", euro.currencySymbol)
        // Blank/whitespace and missing both fall back to '$'.
        val blank = ChargingCurrencyPrefs.fromSettings(buildJsonObject { put("currency_symbol", "  ") })
        assertEquals(DEFAULT_CURRENCY, blank.currencySymbol)
        assertEquals(DEFAULT_CURRENCY, ChargingCurrencyPrefs.fromSettings(null).currencySymbol)
    }
}
