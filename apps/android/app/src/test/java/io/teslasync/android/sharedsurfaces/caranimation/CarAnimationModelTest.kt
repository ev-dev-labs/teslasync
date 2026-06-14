package io.teslasync.android.sharedsurfaces.caranimation

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device verification of the CarAnimation surface's pure logic — the native mirror of the one genuine
 * data-driven derivation the web file performs before Compose paints (web/src/components/motion/CarAnimation.tsx,
 * the `BatteryFillAnimation` fill + good/warn/bad color pick). Because the composable is a thin render layer over
 * [batteryFillPlan], each projected band/fraction here doubles as the surface's per-state snapshot: the good,
 * warn and bad battery buckets and the level clamp. Runs in the :android:testReleaseUnitTest gate.
 */
class CarAnimationModelTest {
    private val tolerance = 1e-4f

    // ── good band: web `level >= 60 ? GOOD` — at or above 60% the gauge fills with the success color ─────────

    @Test
    fun goodBandAtAndAboveSixtyPercent() {
        assertEquals(BatteryFillBucket.Good, batteryFillPlan(60).bucket)
        assertEquals(BatteryFillBucket.Good, batteryFillPlan(82).bucket)
        assertEquals(BatteryFillBucket.Good, batteryFillPlan(100).bucket)
    }

    // ── warn band: web `: level >= 30 ? WARN` — 30%..59% fills with the warning color ────────────────────────

    @Test
    fun warnBandBetweenThirtyAndSixtyPercent() {
        assertEquals(BatteryFillBucket.Warn, batteryFillPlan(30).bucket)
        assertEquals(BatteryFillBucket.Warn, batteryFillPlan(45).bucket)
        assertEquals(BatteryFillBucket.Warn, batteryFillPlan(59).bucket)
    }

    // ── bad band: web `: BAD` — below 30% fills with the danger color ────────────────────────────────────────

    @Test
    fun badBandBelowThirtyPercent() {
        assertEquals(BatteryFillBucket.Bad, batteryFillPlan(29).bucket)
        assertEquals(BatteryFillBucket.Bad, batteryFillPlan(12).bucket)
        assertEquals(BatteryFillBucket.Bad, batteryFillPlan(0).bucket)
    }

    // ── level clamp: web `Math.min(level, 100)`, plus a 0 floor so a negative level never paints negative ─────

    @Test
    fun levelIsClampedIntoZeroToHundred() {
        val under = batteryFillPlan(-25)
        assertEquals(0, under.levelPercent)
        assertEquals(0f, under.fillFraction, tolerance)
        assertEquals(BatteryFillBucket.Bad, under.bucket)

        val over = batteryFillPlan(140)
        assertEquals(100, over.levelPercent)
        assertEquals(1f, over.fillFraction, tolerance)
        assertEquals(BatteryFillBucket.Good, over.bucket)
    }

    // ── fill fraction: the clamped level / 100 (web `min(level, 100) / 100`) ─────────────────────────────────

    @Test
    fun fillFractionIsTheClampedLevelOverHundred() {
        assertEquals(0.72f, batteryFillPlan(72).fillFraction, tolerance)
        assertEquals(0.30f, batteryFillPlan(30).fillFraction, tolerance)
        assertEquals(0.01f, batteryFillPlan(1).fillFraction, tolerance)
    }

    // ── band boundaries are exact (a future threshold tweak fails loudly) ────────────────────────────────────

    @Test
    fun thresholdsMatchTheWebColorBands() {
        assertEquals(60, BATTERY_GOOD_MIN_PERCENT)
        assertEquals(30, BATTERY_WARN_MIN_PERCENT)
        // one below each threshold drops to the lower band.
        assertEquals(BatteryFillBucket.Warn, batteryFillPlan(BATTERY_GOOD_MIN_PERCENT - 1).bucket)
        assertEquals(BatteryFillBucket.Bad, batteryFillPlan(BATTERY_WARN_MIN_PERCENT - 1).bucket)
    }

    // ── registration pins the surface slug the prompt mandates ───────────────────────────────────────────────

    @Test
    fun registrationExposesTheSurfaceSlug() {
        assertEquals("CarAnimation", CAR_ANIMATION_SLUG)
        assertEquals("CarAnimation", CarAnimationRegistration.SLUG)
        assertEquals("car-animation", CarAnimationRegistration.ID)
    }
}
