package io.teslasync.android.featureviews.quickmetrics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the QuickMetrics pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/charging/components/charging-list/QuickMetrics.tsx and the shared
 * `formatDurationMinutes` / `Currency` / `fmtWithUnit` / `fmtNumber` helpers): the three charger-type counts,
 * the total-time duration, the monthly-average cost, and the per-session energy. Because the surface is
 * purely presentational, each [QuickMetricsDisplay] is exactly what the thin composable renders, so these
 * assertions double as the per-state "snapshot": the resolved (`stats` present) grid and the empty
 * (`stats` absent → `null`) branch.
 */
class QuickMetricsProjectionTest {
    private val usFormatting =
        QuickMetricsFormatting(currencySymbol = "$", precision = 2, locale = Locale.US)

    // The sample the owning Charging List page would thread in (web `computeStats` output): 10 sessions
    // (5 home + 3 Supercharger + 2 DC), ~20.5h total, $240 total cost, 100 kWh added.
    private val sample =
        ChargingMetrics(
            homeCount = 5,
            scCount = 3,
            dcCount = 2,
            totalDurationMinutes = 1234.0,
            totalCost = 240.0,
            totalEnergyKwh = 100.0,
            count = 10,
        )

    // ── project(): per-state ──────────────────────────────────────────────────────

    @Test
    fun absentStatsProjectsToNullSelectingTheEmptyBranch() {
        // Web `stats ? … : <EmptyState/>`: a null prop yields no grid (the composable renders the empty state).
        assertNull(QuickMetricsProjection.project(null, usFormatting))
    }

    @Test
    fun resolvedStatsProjectsEveryCellValue() {
        val display = QuickMetricsProjection.project(sample, usFormatting)

        assertEquals(
            QuickMetricsDisplay(
                homeCount = 5,
                scCount = 3,
                dcCount = 2,
                totalTime = "20h 34m",
                monthlyAvg = "$20",
                perSession = "10.00 kWh",
            ),
            display,
        )
    }

    @Test
    fun resolvedStatsHonorsTheResolvedCurrencyAndLocale() {
        // A euro symbol + German locale: the monthly average groups with the German conventions and prefixes €.
        val display =
            QuickMetricsProjection.project(
                sample.copy(totalCost = 24_000.0),
                QuickMetricsFormatting(currencySymbol = "\u20AC", precision = 1, locale = Locale.GERMANY),
            )!!

        // 24000 / 12 = 2000 → German grouping "2.000", prefixed €.
        assertEquals("\u20AC2.000", display.monthlyAvg)
        // Per session 100 / 10 = 10.0 at precision 1, German decimal comma.
        assertEquals("10,0 kWh", display.perSession)
    }

    // ── formatTotalTime(): web formatDurationMinutes cutoffs ───────────────────────

    @Test
    fun formatTotalTimeRendersHoursAndMinutes() {
        assertEquals("0m", QuickMetricsProjection.formatTotalTime(0.0))
        assertEquals("59m", QuickMetricsProjection.formatTotalTime(59.0))
        assertEquals("1h 0m", QuickMetricsProjection.formatTotalTime(60.0))
        assertEquals("1h 30m", QuickMetricsProjection.formatTotalTime(90.0))
        assertEquals("20h 34m", QuickMetricsProjection.formatTotalTime(1234.0))
    }

    @Test
    fun formatTotalTimeRoundsTheMinuteRemainderHalfUpLikeFormatRoundedInt() {
        // Web `formatRoundedInt(59.7)` → "60", so the duration carries the web's "60m" rounding quirk verbatim.
        assertEquals("60m", QuickMetricsProjection.formatTotalTime(59.7))
    }

    @Test
    fun formatTotalTimeReturnsEmDashForNullNegativeOrNonFinite() {
        assertEquals(QUICK_METRICS_EM_DASH, QuickMetricsProjection.formatTotalTime(null))
        assertEquals(QUICK_METRICS_EM_DASH, QuickMetricsProjection.formatTotalTime(-1.0))
        assertEquals(QUICK_METRICS_EM_DASH, QuickMetricsProjection.formatTotalTime(Double.NaN))
        assertEquals(QUICK_METRICS_EM_DASH, QuickMetricsProjection.formatTotalTime(Double.POSITIVE_INFINITY))
    }

    // ── formatMonthlyAvg(): web Currency(totalCost / 12, precision 0) ──────────────

    @Test
    fun formatMonthlyAvgDividesByTwelveAndPrefixesTheSymbol() {
        assertEquals("$20", QuickMetricsProjection.formatMonthlyAvg(240.0, "$", Locale.US))
        assertEquals("$0", QuickMetricsProjection.formatMonthlyAvg(0.0, "$", Locale.US))
        // 1234 / 12 = 102.83… → HALF_UP at 0 decimals → 103.
        assertEquals("$103", QuickMetricsProjection.formatMonthlyAvg(1234.0, "$", Locale.US))
    }

    @Test
    fun formatMonthlyAvgCoercesNullCostToZeroLikeSafeNumber() {
        assertEquals("$0", QuickMetricsProjection.formatMonthlyAvg(null, "$", Locale.US))
    }

    // ── formatPerSession(): web fmtWithUnit(totalEnergy / count, 'kWh') ─────────────

    @Test
    fun formatPerSessionDividesByCountAndAppendsKwh() {
        assertEquals("10.00 kWh", QuickMetricsProjection.formatPerSession(100.0, 10, 2, Locale.US))
        assertEquals("39.20 kWh", QuickMetricsProjection.formatPerSession(78.4, 2, 2, Locale.US))
        assertEquals("10.0 kWh", QuickMetricsProjection.formatPerSession(100.0, 10, 1, Locale.US))
    }

    @Test
    fun formatPerSessionCoercesAZeroDivisorToZeroLikeFmtNumber() {
        // Web `fmtNumber(Infinity)` → safeNumber → 0; a zero divisor never renders "NaN"/"Infinity".
        assertEquals("0.00 kWh", QuickMetricsProjection.formatPerSession(100.0, 0, 2, Locale.US))
    }

    // ── formatCount(): web <AnimatedNumber> static rendering ───────────────────────

    @Test
    fun formatCountGroupsThousandsPerLocale() {
        assertEquals("5", QuickMetricsProjection.formatCount(5, Locale.US))
        assertEquals("1,234", QuickMetricsProjection.formatCount(1234, Locale.US))
        // German grouping uses a dot, never a comma.
        assertFalse(QuickMetricsProjection.formatCount(1234, Locale.GERMANY).contains(","))
    }

    // ── formatNumber()/safeNumber(): web fmtNumber/safeNumber semantics ─────────────

    @Test
    fun formatNumberRoundsHalfUpToMatchIntlNumberFormat() {
        // Intl.NumberFormat's default "halfExpand": 0.5 → "1", 2.5 → "3" (not banker's "0"/"2").
        assertEquals("1", QuickMetricsProjection.formatNumber(0.5, 0, Locale.US))
        assertEquals("3", QuickMetricsProjection.formatNumber(2.5, 0, Locale.US))
        assertEquals("1,234.57", QuickMetricsProjection.formatNumber(1234.567, 2, Locale.US))
    }

    @Test
    fun safeNumberCoercesNonFiniteAndNullToZero() {
        assertEquals(5.5, QuickMetricsProjection.safeNumber(5.5), 0.0)
        assertEquals(0.0, QuickMetricsProjection.safeNumber(null), 0.0)
        assertEquals(0.0, QuickMetricsProjection.safeNumber(Double.NaN), 0.0)
        assertEquals(0.0, QuickMetricsProjection.safeNumber(Double.NEGATIVE_INFINITY), 0.0)
    }

    @Test
    fun resolvedDisplayCarriesEveryCellNonBlankForAccessibility() {
        // Every rendered figure must be a non-blank, TalkBack-readable string in the resolved state.
        val display = QuickMetricsProjection.project(sample, usFormatting)!!
        listOf(display.totalTime, display.monthlyAvg, display.perSession).forEach { value ->
            assertTrue("value must not be blank", value.isNotBlank())
        }
        assertEquals("5", QuickMetricsProjection.formatCount(display.homeCount, Locale.US))
    }
}
