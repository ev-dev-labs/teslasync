package io.teslasync.android.sharedsurfaces.progressring

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ProgressRing's pure logic — the native mirror of every derivation the web
 * component performs (web/src/components/data-display/ProgressRing.tsx): the `clamped = max(0, min(value,
 * max))` fill, the `Math.round(progress * 100)` percentage fed to the accessibility announcement, the
 * proportional centre-text sizing (`mainSize = max(10, round(size * 0.32))`, `subSize = max(8, round(size *
 * 0.18))`), and the `hasCenter` switch. Because the surface is purely presentational each
 * [ProgressRingGeometry] is exactly what the thin composable draws, so these assertions double as the
 * per-state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class ProgressRingProjectionTest {
    private val fractionTolerance = 1e-6f
    private val angleTolerance = 1e-3f

    // ── Fill fraction (web `clamped / max`, clamped to 0..max) ─────────────────────

    @Test
    fun fractionIsZeroForAnEmptyOrNegativeValue() {
        // Empty state: web `Math.max(0, Math.min(value, max))` floors a zero/negative value at 0, so only
        // the track is drawn — never a blank box.
        assertEquals(0f, ProgressRingProjection.fraction(0.0, 100.0), fractionTolerance)
        assertEquals(0f, ProgressRingProjection.fraction(-25.0, 100.0), fractionTolerance)
    }

    @Test
    fun fractionTracksAPartialValue() {
        assertEquals(0.5f, ProgressRingProjection.fraction(50.0, 100.0), fractionTolerance)
        assertEquals(0.25f, ProgressRingProjection.fraction(2.0, 8.0), fractionTolerance)
    }

    @Test
    fun fractionSaturatesAtFullAndClampsOverMax() {
        // Web `Math.min(value, max)` never lets the arc overdraw past a full ring.
        assertEquals(1f, ProgressRingProjection.fraction(100.0, 100.0), fractionTolerance)
        assertEquals(1f, ProgressRingProjection.fraction(150.0, 100.0), fractionTolerance)
    }

    @Test
    fun fractionFoldsTheDivideByZeroAndNonFiniteEdgesToZero() {
        // Web `value / 0` is NaN/Infinity; a non-positive or non-finite max (and a non-finite value) folds
        // to an empty ring instead of an undefined arc.
        assertEquals(0f, ProgressRingProjection.fraction(50.0, 0.0), fractionTolerance)
        assertEquals(0f, ProgressRingProjection.fraction(50.0, -10.0), fractionTolerance)
        assertEquals(0f, ProgressRingProjection.fraction(Double.NaN, 100.0), fractionTolerance)
        assertEquals(0f, ProgressRingProjection.fraction(Double.POSITIVE_INFINITY, 100.0), fractionTolerance)
    }

    // ── Sweep angle (web fills clockwise from the top) ─────────────────────────────

    @Test
    fun sweepAngleIsThreeSixtyTimesTheFraction() {
        assertEquals(0f, ProgressRingProjection.sweepAngle(0.0, 100.0), angleTolerance)
        assertEquals(180f, ProgressRingProjection.sweepAngle(50.0, 100.0), angleTolerance)
        assertEquals(360f, ProgressRingProjection.sweepAngle(100.0, 100.0), angleTolerance)
    }

    @Test
    fun ringFillsClockwiseFromTwelveOClock() {
        // Web `-rotate-90`: the arc starts at the top and sweeps a full positive (clockwise) revolution.
        assertEquals(-90f, ProgressRingProjection.START_ANGLE_DEGREES, angleTolerance)
        assertEquals(360f, ProgressRingProjection.FULL_SWEEP_DEGREES, angleTolerance)
    }

    // ── Percentage (web `Math.round(progress * 100)`) — drives the spoken a11y label ─

    @Test
    fun percentRoundsTheFractionToTheNearestWholePercent() {
        assertEquals(0, ProgressRingProjection.percent(0.0, 100.0))
        assertEquals(50, ProgressRingProjection.percent(50.0, 100.0))
        assertEquals(46, ProgressRingProjection.percent(45.6, 100.0))
        assertEquals(100, ProgressRingProjection.percent(100.0, 100.0))
        assertEquals(100, ProgressRingProjection.percent(120.0, 100.0))
    }

    @Test
    fun percentRoundsHalvesTowardsPositiveInfinityLikeMathRound() {
        // 12.5% -> 13, 87.5% -> 88 (JS Math.round + Kotlin roundToInt agree for positive ties).
        assertEquals(13, ProgressRingProjection.percent(12.5, 100.0))
        assertEquals(88, ProgressRingProjection.percent(87.5, 100.0))
    }

    // ── Proportional centre-text sizing (web `mainSize` / `subSize`) ────────────────

    @Test
    fun centerLabelSizeIsProportionalWithAFloor() {
        // Web `Math.max(10, Math.round(size * 0.32))`: 48 -> 15, 100 -> 32, but a tiny ring floors at 10.
        assertEquals(15, ProgressRingProjection.centerLabelSp(48.0))
        assertEquals(32, ProgressRingProjection.centerLabelSp(100.0))
        assertEquals(10, ProgressRingProjection.centerLabelSp(24.0))
    }

    @Test
    fun centerSubLabelSizeIsProportionalWithAFloor() {
        // Web `Math.max(8, Math.round(size * 0.18))`: 48 -> 9, 100 -> 18, but a tiny ring floors at 8.
        assertEquals(9, ProgressRingProjection.centerSubLabelSp(48.0))
        assertEquals(18, ProgressRingProjection.centerSubLabelSp(100.0))
        assertEquals(8, ProgressRingProjection.centerSubLabelSp(24.0))
    }

    // ── hasCenter switch (web `centerLabel != null || centerSubLabel != null`) ──────

    @Test
    fun hasCenterIsTrueWhenEitherCentreTextIsPresent() {
        assertFalse(ProgressRingProjection.hasCenter(null, null))
        assertTrue(ProgressRingProjection.hasCenter("72%", null))
        assertTrue(ProgressRingProjection.hasCenter(null, "kWh"))
        assertTrue(ProgressRingProjection.hasCenter("72%", "SOC"))
    }

    // ── Composite projection — each [ProgressRingGeometry] doubles as a per-state snapshot ──

    @Test
    fun projectsTheEmptyState() {
        val geometry = ProgressRingProjection.project(value = 0.0, sizeDp = 48.0)

        assertEquals(0f, geometry.fraction, fractionTolerance)
        assertEquals(0, geometry.percent)
        assertEquals(0f, geometry.sweepAngleDegrees, angleTolerance)
        assertEquals(15, geometry.centerLabelSp)
        assertEquals(9, geometry.centerSubLabelSp)
    }

    @Test
    fun projectsThePartialState() {
        val geometry = ProgressRingProjection.project(value = 50.0, sizeDp = 48.0)

        assertEquals(0.5f, geometry.fraction, fractionTolerance)
        assertEquals(50, geometry.percent)
        assertEquals(180f, geometry.sweepAngleDegrees, angleTolerance)
    }

    @Test
    fun projectsTheFullState() {
        val geometry = ProgressRingProjection.project(value = 100.0, sizeDp = 96.0)

        assertEquals(1f, geometry.fraction, fractionTolerance)
        assertEquals(100, geometry.percent)
        assertEquals(360f, geometry.sweepAngleDegrees, angleTolerance)
        assertEquals(31, geometry.centerLabelSp)
        assertEquals(17, geometry.centerSubLabelSp)
    }

    @Test
    fun projectsTheClampedOverMaxState() {
        // value past max clamps to a full ring (web `Math.min(value, max)`).
        val geometry = ProgressRingProjection.project(value = 9.0, sizeDp = 72.0, max = 6.0)

        assertEquals(1f, geometry.fraction, fractionTolerance)
        assertEquals(100, geometry.percent)
        assertEquals(360f, geometry.sweepAngleDegrees, angleTolerance)
    }

    @Test
    fun projectDefaultsMaxToOneHundred() {
        // Web `max = 100` default.
        val geometry = ProgressRingProjection.project(value = 25.0, sizeDp = 48.0)

        assertEquals(0.25f, geometry.fraction, fractionTolerance)
        assertEquals(25, geometry.percent)
    }

    @Test
    fun diagnosticsSlugIsTheSurfaceName() {
        assertEquals("ProgressRing", ProgressRingDiagnostics.SLUG)
    }
}
