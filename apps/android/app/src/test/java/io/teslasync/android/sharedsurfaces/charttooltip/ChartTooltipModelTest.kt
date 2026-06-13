package io.teslasync.android.sharedsurfaces.charttooltip

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the ChartTooltip's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/charts/ChartTooltip.tsx): the visibility guard (`!active || !payload`),
 * the label heuristic (ISO → datetime, otherwise passthrough, null → empty), the value projection (number →
 * locale fmtNumber, absent → empty, otherwise its string form, with the dimmed unit), and the merged
 * accessibility announcement. Because the composable is a thin render layer over these reducers, the per-branch
 * assertions here double as the surface's per-state snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class ChartTooltipModelTest {
    // ── visibility (web `!active || !payload?.length` → null) ─────────────────────────────────────────

    @Test
    fun tooltipHiddenWhenInactive() {
        assertFalse(isTooltipVisible(active = false, seriesCount = 2))
    }

    @Test
    fun tooltipHiddenWhenNoRows() {
        assertFalse(isTooltipVisible(active = true, seriesCount = 0))
    }

    @Test
    fun tooltipVisibleWhenActiveWithRows() {
        assertTrue(isTooltipVisible(active = true, seriesCount = 1))
    }

    // ── ISO heuristic (web `ISO_TS_RE.test`) ──────────────────────────────────────────────────────────

    @Test
    fun isoHeuristicMatchesTimestampsOnly() {
        assertTrue(isIsoTimestamp("2026-04-30T13:30:15Z"))
        assertTrue(isIsoTimestamp("2026-04-30T13:30"))
        assertFalse(isIsoTimestamp("14:25"))
        assertFalse(isIsoTimestamp("Apr 4"))
        assertFalse(isIsoTimestamp(null))
        assertFalse(isIsoTimestamp(1234))
    }

    // ── label formatting (web `defaultLabelFormatter`) ────────────────────────────────────────────────

    @Test
    fun nullLabelRendersEmpty() {
        assertEquals("", formatTooltipLabel(null))
    }

    @Test
    fun plainStringLabelPassesThrough() {
        assertEquals("14:25", formatTooltipLabel("14:25"))
    }

    @Test
    fun numberLabelRendersItsStringForm() {
        assertEquals("42", formatTooltipLabel(42))
    }

    @Test
    fun isoLabelIsFormattedAwayFromTheRawString() {
        val raw = "2026-04-30T13:30:15Z"
        val formatted = formatTooltipLabel(raw, Locale.US, ZoneId.of("UTC"))
        assertNotEquals(raw, formatted)
        assertTrue("expected the formatted year", formatted.contains("2026"))
    }

    @Test
    fun unparseableIsoLabelFallsBackToEmDash() {
        assertEquals(
            CHART_TOOLTIP_INVALID_LABEL,
            formatTooltipLabel("2026-13-45T99:99Z", Locale.US, ZoneId.of("UTC")),
        )
    }

    // ── value formatting (web `defaultValueFormatter` + `fmtNumber`) ──────────────────────────────────

    @Test
    fun numericValueIsLocaleFormattedAtPrecision() {
        assertEquals("65.00", formatTooltipValue(65, unit = null, precision = 2, locale = Locale.US).text)
        assertEquals("12.50", formatTooltipValue(12.5, unit = null, precision = 2, locale = Locale.US).text)
    }

    @Test
    fun numericValueGroupsThousands() {
        assertEquals("1,234.50", formatTooltipValue(1234.5, unit = null, precision = 2, locale = Locale.US).text)
    }

    @Test
    fun nonFiniteNumberCollapsesToZero() {
        assertEquals("0.00", formatTooltipValue(Double.NaN, unit = null, precision = 2, locale = Locale.US).text)
    }

    @Test
    fun textualValuePassesThrough() {
        assertEquals("driving", formatTooltipValue("driving", unit = null, precision = 2, locale = Locale.US).text)
    }

    @Test
    fun absentValueRendersEmpty() {
        assertEquals("", formatTooltipValue(null, unit = null, precision = 2, locale = Locale.US).text)
    }

    @Test
    fun blankUnitIsDropped() {
        assertNull(formatTooltipValue(1, unit = "   ", precision = 2, locale = Locale.US).unit)
    }

    @Test
    fun presentUnitIsCarried() {
        assertEquals("km/h", formatTooltipValue(65, unit = "km/h", precision = 2, locale = Locale.US).unit)
    }

    @Test
    fun precisionIsHonoredAndClamped() {
        assertEquals("65.0", formatNumber(65.0, precision = 1, locale = Locale.US))
        assertEquals("65", formatNumber(65.0, precision = 0, locale = Locale.US))
    }

    // ── merged accessibility announcement (web `aria-live="polite"` region) ───────────────────────────

    @Test
    fun accessibilityLabelJoinsLabelAndRows() {
        val a11y =
            tooltipAccessibilityLabel(
                "14:25",
                listOf(
                    TooltipRowText("Speed", "65.00", "km/h"),
                    TooltipRowText("Power", "12.50", "kW"),
                ),
            )
        assertEquals("14:25. Speed: 65.00 km/h, Power: 12.50 kW", a11y)
    }

    @Test
    fun accessibilityLabelOmitsEmptyLabelLead() {
        val a11y = tooltipAccessibilityLabel("", listOf(TooltipRowText("Mode", "driving", null)))
        assertEquals("Mode: driving", a11y)
    }
}
