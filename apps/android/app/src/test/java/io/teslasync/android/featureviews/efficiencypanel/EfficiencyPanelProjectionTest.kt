package io.teslasync.android.featureviews.efficiencypanel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the EfficiencyPanel's pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/charging/components/charging-list/EfficiencyPanel.tsx and the
 * `lib/numberFormat` + `lib/dateFormat` helpers it calls): the `fmtPercent`/`fmtWithUnit`/`fmtNumber`
 * formatting, the `min(avg, 100)%` bar width, and the `formatDateTime` date. Because the surface is purely
 * presentational, each projected [EfficiencyPanelDisplay] is exactly what the thin composable renders, so the
 * per-state cases double as the per-state "snapshot"; [EfficiencyPanelProjection.accessibilityLabel] is
 * additionally asserted so every tile's accessible reading is non-blank and well-formed.
 */
class EfficiencyPanelProjectionTest {
    private val locale = Locale.US
    private val zone = ZoneOffset.UTC

    private val sampleStats =
        EfficiencyStats(
            avgEfficiency = 88.4,
            best = EfficiencySession(efficiency = 96.1, date = "2026-04-04T02:30:00Z"),
            worst = EfficiencySession(efficiency = 71.2, date = "2026-03-28T21:05:00Z"),
            wallLoss = 12.5,
            totalUsed = 1204.0,
            totalAdded = 1191.5,
            count = 42,
        )

    // ── project(): per-state ────────────────────────────────────────────────────

    @Test
    fun loadingProjectsToLoadingRegardlessOfStats() {
        val display = EfficiencyPanelProjection.project(sampleStats, loading = true, locale = locale, zoneId = zone)
        assertEquals(EfficiencyPanelDisplay.Loading, display)
    }

    @Test
    fun nullStatsProjectToEmpty() {
        val display = EfficiencyPanelProjection.project(null, loading = false, locale = locale, zoneId = zone)
        assertEquals(EfficiencyPanelDisplay.Empty, display)
    }

    @Test
    fun zeroCountProjectsToEmpty() {
        // Web `computeEfficiencyStats` returns null when no session carries usable data; we render Empty.
        val display =
            EfficiencyPanelProjection.project(
                sampleStats.copy(count = 0),
                loading = false,
                locale = locale,
                zoneId = zone,
            )
        assertEquals(EfficiencyPanelDisplay.Empty, display)
    }

    @Test
    fun resolvedPayloadProjectsEveryTileValue() {
        val display = EfficiencyPanelProjection.project(sampleStats, loading = false, locale = locale, zoneId = zone)

        assertTrue(display is EfficiencyPanelDisplay.Resolved)
        val resolved = display as EfficiencyPanelDisplay.Resolved
        assertEquals(42, resolved.sessionCount)
        assertEquals("88.40%", resolved.averageEfficiency)
        assertEquals(0.884f, resolved.averageBarFraction, FLOAT_TOLERANCE)
        assertEquals("96.10%", resolved.bestEfficiency)
        assertEquals("71.20%", resolved.worstEfficiency)
        assertEquals("12.50 kWh", resolved.wallLoss)
        assertEquals("1,204.00 kWh \u2192 1,191.50 kWh", resolved.wallLossDetail)
        // Dates resolve to a real, locale-formatted string (never blank / EM_DASH) for a valid timestamp.
        assertTrue(resolved.bestDate.contains("2026"))
        assertTrue(resolved.worstDate.contains("2026"))
    }

    // ── formatNumber(): web `fmtNumber` (precision 2, safeNumber, grouping, half-up) ─

    @Test
    fun formatNumberRendersTwoDecimalsWithLocaleGrouping() {
        assertEquals("85.40", EfficiencyPanelProjection.formatNumber(85.4, locale))
        assertEquals("1,204.00", EfficiencyPanelProjection.formatNumber(1204.0, locale))
        assertEquals("0.00", EfficiencyPanelProjection.formatNumber(0.0, locale))
    }

    @Test
    fun formatNumberRoundsHalfUpToMatchIntlNumberFormat() {
        // 0.125 is exactly representable in binary; HALF_UP (Intl "halfExpand") -> "0.13", not banker's "0.12".
        assertEquals("0.13", EfficiencyPanelProjection.formatNumber(0.125, locale))
    }

    @Test
    fun formatNumberCoercesNonFiniteToZeroLikeSafeNumber() {
        assertEquals("0.00", EfficiencyPanelProjection.formatNumber(Double.NaN, locale))
        assertEquals("0.00", EfficiencyPanelProjection.formatNumber(Double.POSITIVE_INFINITY, locale))
        assertEquals("0.00", EfficiencyPanelProjection.formatNumber(Double.NEGATIVE_INFINITY, locale))
    }

    @Test
    fun formatNumberUsesLocaleSpecificGroupingSeparators() {
        val german = EfficiencyPanelProjection.formatNumber(1204.0, Locale.GERMANY)
        // de-DE uses ',' as the decimal separator and differs from the US "1,204.00" rendering. Asserting the
        // decimal-comma + difference (rather than the exact grouping glyph) keeps the test robust across JDK
        // CLDR revisions while still proving the formatter is locale-aware.
        assertTrue(german.endsWith(",00"))
        assertFalse(german == "1,204.00")
    }

    // ── formatPercent / formatWithUnit / wallLossDetail ──────────────────────────

    @Test
    fun formatPercentAppendsPercentSign() {
        assertEquals("88.40%", EfficiencyPanelProjection.formatPercent(88.4, locale))
    }

    @Test
    fun formatWithUnitAppendsUnitAfterASpace() {
        assertEquals("12.50 kWh", EfficiencyPanelProjection.formatWithUnit(12.5, "kWh", locale))
    }

    @Test
    fun wallLossDetailJoinsUsedAndAddedWithAnArrow() {
        assertEquals(
            "1,204.00 kWh \u2192 1,191.50 kWh",
            EfficiencyPanelProjection.wallLossDetail(1204.0, 1191.5, locale),
        )
    }

    // ── barFraction(): web `min(avg, 100)%` clamped to the track ──────────────────

    @Test
    fun barFractionDividesByOneHundredForInRangeValues() {
        assertEquals(0.884f, EfficiencyPanelProjection.barFraction(88.4), FLOAT_TOLERANCE)
        assertEquals(0f, EfficiencyPanelProjection.barFraction(0.0), FLOAT_TOLERANCE)
        assertEquals(1f, EfficiencyPanelProjection.barFraction(100.0), FLOAT_TOLERANCE)
    }

    @Test
    fun barFractionClampsAboveOneHundredAndBelowZero() {
        assertEquals(1f, EfficiencyPanelProjection.barFraction(142.0), FLOAT_TOLERANCE)
        assertEquals(0f, EfficiencyPanelProjection.barFraction(-5.0), FLOAT_TOLERANCE)
    }

    @Test
    fun barFractionCoercesNonFiniteToZero() {
        assertEquals(0f, EfficiencyPanelProjection.barFraction(Double.NaN), FLOAT_TOLERANCE)
        assertEquals(0f, EfficiencyPanelProjection.barFraction(Double.POSITIVE_INFINITY), FLOAT_TOLERANCE)
    }

    // ── parseIsoMillis(): tolerant RFC-3339 parsing ──────────────────────────────

    @Test
    fun parseIsoMillisHandlesZuluOffsetAndZonedShapes() {
        val expected = Instant.parse("2026-04-04T02:30:00Z").toEpochMilli()
        assertEquals(expected, EfficiencyPanelProjection.parseIsoMillis("2026-04-04T02:30:00Z"))
        // Same instant expressed with a +02:00 offset.
        assertEquals(expected, EfficiencyPanelProjection.parseIsoMillis("2026-04-04T04:30:00+02:00"))
    }

    @Test
    fun parseIsoMillisReturnsNullForBlankOrUnparseableInput() {
        assertNull(EfficiencyPanelProjection.parseIsoMillis(null))
        assertNull(EfficiencyPanelProjection.parseIsoMillis(""))
        assertNull(EfficiencyPanelProjection.parseIsoMillis("   "))
        assertNull(EfficiencyPanelProjection.parseIsoMillis("not-a-timestamp"))
    }

    // ── formatDateTime(): web `formatDateTime` (localized, '—' fallback) ──────────

    @Test
    fun formatDateTimeFallsBackToEmDashForMissingOrUnparseableInput() {
        assertEquals(EM_DASH, EfficiencyPanelProjection.formatDateTime(null, locale, zone))
        assertEquals(EM_DASH, EfficiencyPanelProjection.formatDateTime("", locale, zone))
        assertEquals(EM_DASH, EfficiencyPanelProjection.formatDateTime("garbage", locale, zone))
    }

    @Test
    fun formatDateTimeRendersADeterministicLocalizedStringForAValidTimestamp() {
        val first = EfficiencyPanelProjection.formatDateTime("2026-04-04T02:30:00Z", locale, zone)
        val second = EfficiencyPanelProjection.formatDateTime("2026-04-04T02:30:00Z", locale, zone)
        assertFalse(first == EM_DASH)
        assertTrue(first.isNotBlank())
        assertTrue(first.contains("2026"))
        // Deterministic for the same inputs (no hidden dependence on the system clock/zone).
        assertEquals(first, second)
    }

    // ── accessibilityLabel(): merged TalkBack reading per tile ───────────────────

    @Test
    fun accessibilityLabelJoinsLabelValueAndDetailWhenPresent() {
        assertEquals(
            "Best Session: 96.10%, Apr 4, 2026",
            EfficiencyPanelProjection.accessibilityLabel("Best Session", "96.10%", "Apr 4, 2026"),
        )
    }

    @Test
    fun accessibilityLabelOmitsDetailWhenAbsentOrBlank() {
        assertEquals(
            "Average Efficiency: 88.40%",
            EfficiencyPanelProjection.accessibilityLabel("Average Efficiency", "88.40%", null),
        )
        assertEquals(
            "Average Efficiency: 88.40%",
            EfficiencyPanelProjection.accessibilityLabel("Average Efficiency", "88.40%", "   "),
        )
    }

    private companion object {
        const val FLOAT_TOLERANCE = 0.0001f
    }
}
