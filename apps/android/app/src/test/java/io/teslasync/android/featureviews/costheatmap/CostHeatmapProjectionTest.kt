package io.teslasync.android.featureviews.costheatmap

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the CostHeatmap pure projection — the native port of the web component's inline
 * derivations and formatting (web/src/features/charging/components/charging-list/CostHeatmap.tsx): the
 * `peakCostPerKwh || 0.30` fallback, the per-cell `intensity`, the cheap→expensive `rgba` channel ramp with
 * JS `Math.round` rounding, the busy-cell alpha (`min(0.9, 0.15 + sessions * 0.12)`), the faint empty cell,
 * the legend swatches, the hour-axis labels, the localized weekday labels, the 7×24 grid build with sparse
 * bucket lookup + the always-render empty contract, the per-cell accessible label, and the
 * `formatCurrency(cost, 3)` currency formatting. Runs in the :app:testReleaseUnitTest gate; no Compose, no
 * device. Locale is pinned to US for deterministic grouping / separators / weekday names.
 */
class CostHeatmapProjectionTest {
    private companion object {
        const val EPS: Double = 1e-9
    }

    private val locale = Locale.US
    private val dayLabels = CostHeatmapProjection.weekdayLabels(locale)
    private val formatCost: (Double) -> String = { CostHeatmapProjection.formatCurrency(it, "$", locale) }
    private val words = CostHeatmapTooltipWords(sessionsWord = "sessions", perKwhWord = "Per kWh")

    private fun project(data: CostHeatmapData): CostHeatmapDisplay =
        CostHeatmapProjection.project(
            data = data,
            dayLabels = dayLabels,
            formatCost = formatCost,
            words = words,
        )

    // ── maxCost (web `peakCostPerKwh || 0.30`) ────────────────────────────────────────────────────────────

    @Test
    fun maxCostFallsBackOnFalsyPeak() {
        assertEquals(DEFAULT_MAX_COST, CostHeatmapProjection.maxCost(0.0), EPS)
        assertEquals(DEFAULT_MAX_COST, CostHeatmapProjection.maxCost(Double.NaN), EPS)
        assertEquals(DEFAULT_MAX_COST, CostHeatmapProjection.maxCost(Double.POSITIVE_INFINITY), EPS)
    }

    @Test
    fun maxCostKeepsTruthyPeakIncludingNegative() {
        assertEquals(0.42, CostHeatmapProjection.maxCost(0.42), EPS)
        // JS treats a negative number as truthy, so it is kept verbatim (and yields a 0 intensity downstream).
        assertEquals(-0.10, CostHeatmapProjection.maxCost(-0.10), EPS)
    }

    // ── intensity (web `maxCost > 0 ? min(1, cost / maxCost) : 0`) ─────────────────────────────────────────

    @Test
    fun intensityScalesAndCapsAtOne() {
        assertEquals(0.0, CostHeatmapProjection.intensity(0.0, 0.30), EPS)
        assertEquals(0.5, CostHeatmapProjection.intensity(0.15, 0.30), EPS)
        assertEquals(1.0, CostHeatmapProjection.intensity(0.30, 0.30), EPS)
        // cost above the peak is capped at full intensity.
        assertEquals(1.0, CostHeatmapProjection.intensity(0.50, 0.30), EPS)
    }

    @Test
    fun intensityIsZeroWhenMaxCostNonPositive() {
        assertEquals(0.0, CostHeatmapProjection.intensity(0.20, 0.0), EPS)
        assertEquals(0.0, CostHeatmapProjection.intensity(0.20, -0.10), EPS)
    }

    // ── cellColor (web cell `backgroundColor` rgba ramp) ──────────────────────────────────────────────────

    @Test
    fun cellColorForEmptyBucketIsFaintWhite() {
        val color = CostHeatmapProjection.cellColor(sessions = 0, intensity = 1.0)
        assertEquals(EMPTY_CELL_CHANNEL, color.red)
        assertEquals(EMPTY_CELL_CHANNEL, color.green)
        assertEquals(EMPTY_CELL_CHANNEL, color.blue)
        assertEquals(EMPTY_CELL_ALPHA, color.alpha, EPS)
    }

    @Test
    fun cellColorRampsCheapToExpensiveWithRounding() {
        // intensity 0 → fully "cheap" green/blue, no red.
        val cheap = CostHeatmapProjection.cellColor(sessions = 1, intensity = 0.0)
        assertEquals(0, cheap.red)
        assertEquals(187, cheap.green)
        assertEquals(100, cheap.blue)

        // intensity 0.5 → half ramp; channels use JS Math.round (half up): 119.5→120, 93.5→94, 50→50.
        val mid = CostHeatmapProjection.cellColor(sessions = 1, intensity = 0.5)
        assertEquals(120, mid.red)
        assertEquals(94, mid.green)
        assertEquals(50, mid.blue)

        // intensity 1 → fully "expensive" red, no green/blue.
        val expensive = CostHeatmapProjection.cellColor(sessions = 1, intensity = 1.0)
        assertEquals(239, expensive.red)
        assertEquals(0, expensive.green)
        assertEquals(0, expensive.blue)
    }

    @Test
    fun cellColorAlphaGrowsPerSessionThenCaps() {
        assertEquals(0.15 + 0.12, CostHeatmapProjection.cellColor(1, 0.0).alpha, EPS)
        assertEquals(0.15 + 3 * 0.12, CostHeatmapProjection.cellColor(3, 0.0).alpha, EPS)
        // 0.15 + 10 * 0.12 = 1.35, clamped to the 0.9 ceiling.
        assertEquals(ALPHA_MAX, CostHeatmapProjection.cellColor(10, 0.0).alpha, EPS)
    }

    // ── legendColor + legend (web legend swatch ramp at alpha 0.6) ─────────────────────────────────────────

    @Test
    fun legendColorUsesRampAtFixedAlpha() {
        val low = CostHeatmapProjection.legendColor(0.15)
        assertEquals(36, low.red) // round(0.15 * 239 = 35.85)
        assertEquals(159, low.green) // round(0.85 * 187 = 158.95)
        assertEquals(85, low.blue) // round(0.85 * 100 = 85)
        assertEquals(LEGEND_ALPHA, low.alpha, EPS)

        val high = CostHeatmapProjection.legendColor(0.9)
        assertEquals(215, high.red) // round(0.9 * 239 = 215.1)
        assertEquals(19, high.green) // round(0.1 * 187 = 18.7)
        assertEquals(10, high.blue) // round(0.1 * 100 = 10)
        assertEquals(LEGEND_ALPHA, high.alpha, EPS)
    }

    @Test
    fun projectBuildsFiveLegendSwatchesFromTheCanonicalOpacities() {
        val legend = project(CostHeatmapData.EMPTY).legend
        assertEquals(LEGEND_OPACITIES, legend.map { it.opacity })
        assertTrue(legend.all { it.color.alpha == LEGEND_ALPHA })
    }

    // ── hourLabels (web `i % 3 === 0 ? i : ''`) ───────────────────────────────────────────────────────────

    @Test
    fun hourLabelsLabelEveryThirdHour() {
        val labels = CostHeatmapProjection.hourLabels()
        assertEquals(HOURS_PER_DAY, labels.size)
        assertEquals("0", labels[0])
        assertEquals("", labels[1])
        assertEquals("", labels[2])
        assertEquals("3", labels[3])
        assertEquals("21", labels[21])
        assertEquals("", labels[23])
    }

    // ── weekdayLabels (localized replacement for the web hardcoded Sun…Sat) ───────────────────────────────

    @Test
    fun weekdayLabelsAreSevenSundayFirstLocalizedNames() {
        assertEquals(DAYS_PER_WEEK, dayLabels.size)
        assertTrue(dayLabels.none { it.isBlank() })
        assertEquals("Sun", dayLabels[0])
        assertEquals("Sat", dayLabels[6])
    }

    // ── project: grid shape, sparse lookup, empty contract ────────────────────────────────────────────────

    @Test
    fun projectBuildsSevenRowsOfTwentyFourCells() {
        val display = project(CostHeatmapData.EMPTY)
        assertEquals(DAYS_PER_WEEK, display.rows.size)
        assertTrue(display.rows.all { it.cells.size == HOURS_PER_DAY })
        assertEquals(dayLabels, display.rows.map { it.label })
        assertEquals(HOURS_PER_DAY, display.hourLabels.size)
    }

    @Test
    fun projectIsEmptyWhenNoBucketHasSessions() {
        assertTrue(project(CostHeatmapData.EMPTY).isEmpty)
        // A bucket that exists but has zero sessions still counts as empty (nothing to visualize).
        val zeroSessions = CostHeatmapData(listOf(CostHeatmapEntry(day = 0, hour = 0, sessions = 0, avgCostPerKwh = 0.2)), 0.30)
        assertTrue(project(zeroSessions).isEmpty)
    }

    @Test
    fun projectIsNotEmptyWhenAnyBucketHasSessions() {
        val data = CostHeatmapData(listOf(CostHeatmapEntry(day = 2, hour = 9, sessions = 1, avgCostPerKwh = 0.10)), 0.30)
        assertFalse(project(data).isEmpty)
    }

    @Test
    fun projectPlacesEachBucketAtItsDayHourCoordinate() {
        val data =
            CostHeatmapData(
                heatmap = listOf(CostHeatmapEntry(day = 1, hour = 2, sessions = 3, avgCostPerKwh = 0.15)),
                peakCostPerKwh = 0.30,
            )
        val display = project(data)

        val cell = display.rows[1].cells[2]
        assertEquals(1, cell.day)
        assertEquals(2, cell.hour)
        assertEquals(3, cell.sessions)
        assertEquals(0.15, cell.cost, EPS)
        assertEquals(0.5, cell.intensity, EPS)
        // intensity 0.5 ramp + per-session alpha 0.15 + 3*0.12 = 0.51.
        assertEquals(120, cell.color.red)
        assertEquals(94, cell.color.green)
        assertEquals(50, cell.color.blue)
        assertEquals(0.51, cell.color.alpha, EPS)

        // Every other cell is empty (sparse buckets default to 0 sessions / cost).
        val untouched = display.rows[0].cells[0]
        assertEquals(0, untouched.sessions)
        assertEquals(EMPTY_CELL_CHANNEL, untouched.color.red)
    }

    // ── cellLabel (localized native analogue of the web cell `title`) ─────────────────────────────────────

    @Test
    fun cellLabelForBusyBucketReadsDayHourSessionsAndCost() {
        val label =
            CostHeatmapProjection.cellLabel(
                dayLabel = "Mon",
                hour = 2,
                sessions = 3,
                costText = "$0.150",
                words = words,
            )
        assertEquals("Mon 2:00, 3 sessions, $0.150 Per kWh", label)
    }

    @Test
    fun cellLabelForEmptyBucketReadsOnlyDayAndHour() {
        val label =
            CostHeatmapProjection.cellLabel(
                dayLabel = "Mon",
                hour = 14,
                sessions = 0,
                costText = "$0.000",
                words = words,
            )
        assertEquals("Mon 14:00", label)
    }

    @Test
    fun projectAttachesAccessibilityLabelsToCells() {
        val data =
            CostHeatmapData(
                heatmap = listOf(CostHeatmapEntry(day = 1, hour = 2, sessions = 3, avgCostPerKwh = 0.15)),
                peakCostPerKwh = 0.30,
            )
        val display = project(data)
        assertEquals("Mon 2:00, 3 sessions, $0.150 Per kWh", display.rows[1].cells[2].accessibilityLabel)
        assertEquals("Sun 0:00", display.rows[0].cells[0].accessibilityLabel)
    }

    // ── formatCurrency + safe (web `useFormatting` / `safeNumber`) ────────────────────────────────────────

    @Test
    fun formatCurrencyPrefixesSymbolWithThreeDecimals() {
        assertEquals("$0.123", CostHeatmapProjection.formatCurrency(0.123, "$", locale))
        assertEquals("$0.100", CostHeatmapProjection.formatCurrency(0.1, "$", locale))
        assertEquals("$1,234.500", CostHeatmapProjection.formatCurrency(1_234.5, "$", locale))
        assertEquals("\u20ac0.123", CostHeatmapProjection.formatCurrency(0.123, "\u20ac", locale))
    }

    @Test
    fun formatCurrencyFallsBackOnBlankSymbolAndNonFiniteAmount() {
        assertEquals("$0.250", CostHeatmapProjection.formatCurrency(0.25, "", locale))
        assertEquals("$0.000", CostHeatmapProjection.formatCurrency(Double.NaN, "$", locale))
        assertEquals("$0.000", CostHeatmapProjection.formatCurrency(Double.POSITIVE_INFINITY, "$", locale))
    }

    @Test
    fun safeCoercesNonFiniteToZero() {
        assertEquals(0.0, CostHeatmapProjection.safe(Double.NaN), EPS)
        assertEquals(0.0, CostHeatmapProjection.safe(Double.NEGATIVE_INFINITY), EPS)
        assertEquals(12.5, CostHeatmapProjection.safe(12.5), EPS)
    }

    // ── currency prefs (web `useFormatting` settings read) ────────────────────────────────────────────────

    @Test
    fun currencyPrefsDefaultsToDollarWhenAbsent() {
        assertEquals(DEFAULT_CURRENCY, CostHeatmapCurrencyPrefs.fromSettings(null).currencySymbol)
    }

    @Test
    fun currencyPrefsReadsSymbolFromSettingsDocument() {
        val settings = buildJsonObject { put("currency_symbol", "\u20ac") }
        assertEquals("\u20ac", CostHeatmapCurrencyPrefs.fromSettings(settings).currencySymbol)
    }

    @Test
    fun currencyPrefsFallsBackWhenSymbolIsBlank() {
        val settings = buildJsonObject { put("currency_symbol", "  ") }
        assertEquals(DEFAULT_CURRENCY, CostHeatmapCurrencyPrefs.fromSettings(settings).currencySymbol)
    }
}
