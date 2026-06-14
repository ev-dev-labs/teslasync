package io.teslasync.android.sharedsurfaces.slider

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Slider surface's pure logic — the native mirror of the derivations the web
 * component makes before it paints its track (web/src/components/ui/Slider.tsx): the discrete-step translation of
 * the `step` increment, the value coercion into `[min, max]`, and the `display = formatValue ? formatValue(value)
 * : String(value)` text. Because the composable is a thin render layer over [SliderProjection], the per-branch
 * assertions here double as the surface's per-state snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class SliderModelTest {
    // ── discreteStepCount: the web `step` increment → Material 3 intermediate-stop count ──────────────────

    @Test
    fun stepOfOneOverATenWideSpanYieldsNineIntermediateStops() {
        // span/step = 10 selectable intervals → 11 points (0..10) → 9 stops between the endpoints.
        assertEquals(9, SliderProjection.discreteStepCount(min = 0f, max = 10f, step = 1f))
    }

    @Test
    fun aCoarseStepYieldsTheRightStopCount() {
        // 0,25,50,75,100 = 5 points → 3 intermediate stops.
        assertEquals(3, SliderProjection.discreteStepCount(min = 0f, max = 100f, step = 25f))
    }

    @Test
    fun aNonPositiveStepIsAContinuousTrack() {
        assertEquals(0, SliderProjection.discreteStepCount(min = 0f, max = 10f, step = 0f))
        assertEquals(0, SliderProjection.discreteStepCount(min = 0f, max = 10f, step = -1f))
    }

    @Test
    fun aNonPositiveSpanIsAContinuousTrack() {
        assertEquals(0, SliderProjection.discreteStepCount(min = 5f, max = 5f, step = 1f))
    }

    @Test
    fun aStepWiderThanTheSpanNeverGoesNegative() {
        assertEquals(0, SliderProjection.discreteStepCount(min = 0f, max = 10f, step = 20f))
    }

    // ── defaultValueText: the native port of web `String(value)` ──────────────────────────────────────────

    @Test
    fun aWholeNumberRendersWithoutAFractionalTail() {
        assertEquals("32", SliderProjection.defaultValueText(32f))
        assertEquals("0", SliderProjection.defaultValueText(0f))
        assertEquals("-5", SliderProjection.defaultValueText(-5f))
    }

    @Test
    fun aFractionalValueKeepsItsDecimals() {
        assertEquals("12.5", SliderProjection.defaultValueText(12.5f))
    }

    // ── project: value coercion, ordered range, and formatted text ───────────────────────────────────────

    @Test
    fun projectClampsTheThumbIntoTheRangeWithoutChangingTheDisplayedRawValue() {
        val above = SliderProjection.project(value = 150f, min = 0f, max = 100f, step = 1f, formatValue = null)
        assertEquals(100f, above.thumbValue)
        // The web formats the raw prop, not the clamped value.
        assertEquals("150", above.valueText)

        val below = SliderProjection.project(value = -20f, min = 0f, max = 100f, step = 1f, formatValue = null)
        assertEquals(0f, below.thumbValue)
    }

    @Test
    fun projectOrdersReversedBoundsSoTheTrackStaysValid() {
        val display = SliderProjection.project(value = 30f, min = 100f, max = 0f, step = 10f, formatValue = null)
        assertEquals(0f, display.valueRange.start)
        assertEquals(100f, display.valueRange.endInclusive)
        assertEquals(30f, display.thumbValue)
        assertEquals(9, display.steps)
    }

    @Test
    fun projectUsesTheCustomFormatterForTheDisplayText() {
        val display =
            SliderProjection.project(value = 80f, min = 0f, max = 100f, step = 5f) { "${it.toInt()}%" }
        assertEquals("80%", display.valueText)
        assertEquals(80f, display.thumbValue)
        assertEquals(19, display.steps)
    }

    // ── registration / slug contract ─────────────────────────────────────────────────────────────────────

    @Test
    fun slugAndRegistrationMatchTheSurfaceContract() {
        assertEquals("Slider", SLIDER_SLUG)
        assertEquals("Slider", SliderRegistration.SLUG)
        assertEquals("slider", SliderRegistration.ID)
        assertEquals("slider", SLIDER_TEST_TAG)
        assertTrue("the web step default is 1", SliderRegistration.DEFAULT_STEP == 1f)
    }
}
