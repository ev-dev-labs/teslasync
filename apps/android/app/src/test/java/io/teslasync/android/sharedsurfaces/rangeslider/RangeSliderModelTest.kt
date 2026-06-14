package io.teslasync.android.sharedsurfaces.rangeslider

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device verification of the RangeSlider surface's pure logic — the native mirror of every decision the web
 * component makes before it paints (web/src/components/ui/RangeSlider.tsx): the `step → steps` fold, the
 * thumb-swap normalization, the SI-free `String(n)` default value text, the `low – high` summary, and the
 * `minThumbLabel ?? t(...)` precedence. Because the composable is a thin render layer over these functions, the
 * assertions here double as the surface's per-state snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class RangeSliderModelTest {
    // ── rangeSliderSteps: web `step` increment → Material 3 `steps` count (stops strictly between min/max) ──

    @Test
    fun stepOneOverAHundredYieldsNinetyNineInteriorStops() {
        // 100 unit intervals ⇒ 99 interior stops ⇒ snapping identical to the web step=1 slider.
        assertEquals(99, rangeSliderSteps(0f, 100f, 1f))
    }

    @Test
    fun stepEvenlyDividesTheSpan() {
        // 0..10 by 2 ⇒ {0,2,4,6,8,10} = 5 intervals ⇒ 4 interior stops.
        assertEquals(4, rangeSliderSteps(0f, 10f, 2f))
    }

    @Test
    fun fractionalStepIsSupported() {
        // 0..1 by 0.1 ⇒ 10 intervals ⇒ 9 interior stops.
        assertEquals(9, rangeSliderSteps(0f, 1f, 0.1f))
    }

    @Test
    fun nonPositiveOrNonFiniteStepIsContinuous() {
        assertEquals(0, rangeSliderSteps(0f, 100f, 0f))
        assertEquals(0, rangeSliderSteps(0f, 100f, -1f))
        assertEquals(0, rangeSliderSteps(0f, 100f, Float.NaN))
        assertEquals(0, rangeSliderSteps(0f, 100f, Float.POSITIVE_INFINITY))
    }

    @Test
    fun nonPositiveSpanIsContinuous() {
        assertEquals(0, rangeSliderSteps(50f, 50f, 1f))
        assertEquals(0, rangeSliderSteps(80f, 20f, 1f))
    }

    @Test
    fun stepAtLeastAsLargeAsTheSpanHasNoInteriorStop() {
        assertEquals(0, rangeSliderSteps(0f, 1f, 1f))
        assertEquals(0, rangeSliderSteps(0f, 1f, 2f))
    }

    // ── sortedBounds: the web thumb-swap (onChange always receives a sorted [low, high]) ──────────────────

    @Test
    fun sortedBoundsKeepsAnAlreadySortedPair() {
        val range = sortedBounds(20f, 80f)
        assertEquals(20f, range.start, 0f)
        assertEquals(80f, range.endInclusive, 0f)
    }

    @Test
    fun sortedBoundsSwapsAnInvertedPair() {
        val range = sortedBounds(80f, 20f)
        assertEquals(20f, range.start, 0f)
        assertEquals(80f, range.endInclusive, 0f)
    }

    @Test
    fun sortedBoundsHandlesEqualThumbs() {
        val range = sortedBounds(50f, 50f)
        assertEquals(50f, range.start, 0f)
        assertEquals(50f, range.endInclusive, 0f)
    }

    // ── coerceRangeIntoBounds: clamp into min..max AND re-sort (defensive native guard + web normalization) ─

    @Test
    fun coerceClampsBelowAndAboveTheBounds() {
        val range = coerceRangeIntoBounds(-10f..150f, 0f..100f)
        assertEquals(0f, range.start, 0f)
        assertEquals(100f, range.endInclusive, 0f)
    }

    @Test
    fun coerceLeavesAnInBoundsRangeUntouched() {
        val range = coerceRangeIntoBounds(25f..75f, 0f..100f)
        assertEquals(25f, range.start, 0f)
        assertEquals(75f, range.endInclusive, 0f)
    }

    // ── defaultBoundText: web `String(n)` (integral ⇒ no decimal, fractional ⇒ as-is) ─────────────────────

    @Test
    fun integralValuesRenderWithoutADecimal() {
        assertEquals("3", defaultBoundText(3f))
        assertEquals("0", defaultBoundText(0f))
        assertEquals("-5", defaultBoundText(-5f))
        assertEquals("100", defaultBoundText(100f))
    }

    @Test
    fun fractionalValuesRenderAsIs() {
        assertEquals("3.5", defaultBoundText(3.5f))
        assertEquals("0.1", defaultBoundText(0.1f))
    }

    // ── formatBound / formatRangeSummary: the displayed values + the `low – high` summary ─────────────────

    @Test
    fun formatBoundUsesTheCallerFormatterWhenSupplied() {
        assertEquals("42%", formatBound(42f) { "${it.toInt()}%" })
    }

    @Test
    fun formatBoundFallsBackToTheDefaultTextWhenNoFormatter() {
        assertEquals("42", formatBound(42f, null))
    }

    @Test
    fun summaryJoinsBothBoundsWithTheEnDashSeparator() {
        // web `{displayLow}{' – '}{displayHigh}` — space, U+2013, space.
        assertEquals("20 \u2013 80", formatRangeSummary(20f, 80f, null))
        assertEquals(" \u2013 ", RANGE_SUMMARY_SEPARATOR)
    }

    @Test
    fun summaryAppliesTheFormatterToBothBounds() {
        assertEquals("20% \u2013 80%", formatRangeSummary(20f, 80f) { "${it.toInt()}%" })
    }

    // ── resolveThumbLabel: web `minThumbLabel ?? t('slider.thumbMin', '{{label}} minimum', { label })` ─────

    @Test
    fun thumbLabelOverrideWinsWhenPresent() {
        assertEquals("Low end", resolveThumbLabel("Low end", "Battery range minimum"))
    }

    @Test
    fun thumbLabelFallsBackToTheI18nDefaultWhenNull() {
        assertEquals("Battery range minimum", resolveThumbLabel(null, "Battery range minimum"))
    }

    @Test
    fun thumbLabelHonoursAnExplicitEmptyOverrideLikeTheWebNullishCoalescing() {
        // web `??` only falls back on null/undefined — an explicit empty string is used verbatim.
        assertEquals("", resolveThumbLabel("", "Battery range minimum"))
    }

    // ── registration / slug contract ─────────────────────────────────────────────────────────────────────

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("RangeSlider", RANGE_SLIDER_SLUG)
        assertEquals("RangeSlider", RangeSliderRegistration.SLUG)
        assertEquals("range-slider", RangeSliderRegistration.ID)
        assertEquals(1f, RangeSliderRegistration.DEFAULT_STEP, 0f)
    }
}
