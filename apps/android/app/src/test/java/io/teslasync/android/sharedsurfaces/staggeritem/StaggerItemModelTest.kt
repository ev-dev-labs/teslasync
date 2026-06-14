package io.teslasync.android.sharedsurfaces.staggeritem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the StaggerItem's pure entrance logic — the native mirror of every decision the web
 * component makes (web/src/components/motion/StaggerItem.tsx) before Compose paints. Because the composable is a
 * thin render layer over [staggerItemPlan], the per-variant assertions here double as the surface's per-state
 * snapshot: the animated entrance (web `hidden` → `show`), the collapsed reduced-motion frame (web `hidden = show`),
 * the first item's zero-delay entry, and the input clamps. Runs in the :android:testReleaseUnitTest gate.
 */
class StaggerItemModelTest {
    // ── animated: the child fades up from the offset, delayed by its ordinal (web hidden → show) ────────────

    @Test
    fun animatedPlanFadesAndSlidesFromBelow() {
        val plan = staggerItemPlan(index = 3, reduce = false, stepMs = 60, itemDurationMs = 200, slideDp = 15)

        assertEquals(3, plan.index)
        assertEquals(180, plan.delayMs)
        assertEquals(200, plan.durationMs)
        assertEquals(15, plan.startOffsetDp)
        assertEquals(0f, plan.startAlpha, 0f)
        assertTrue(plan.animates)
        assertTrue(plan.startsHidden)
        // the child settles 200 ms after it starts, which is 180 ms after the container's first frame.
        assertEquals(380, plan.totalDurationMs)
    }

    // ── reduced motion: the web `hidden = { opacity: 1, y: 0 }` branch — final frame, no fade or slide ──────

    @Test
    fun reducedMotionRendersFinalFrameImmediately() {
        val plan = staggerItemPlan(index = 3, reduce = true, stepMs = 60, itemDurationMs = 200, slideDp = 15)

        assertEquals(0, plan.delayMs)
        assertEquals(0, plan.durationMs)
        assertEquals(0, plan.startOffsetDp)
        assertEquals(1f, plan.startAlpha, 0f)
        assertFalse(plan.animates)
        assertFalse(plan.startsHidden)
        assertEquals(0, plan.totalDurationMs)
    }

    // ── the first child has no preceding siblings, so it enters at once but still plays its fade/slide ──────

    @Test
    fun firstItemEntersWithoutStaggerDelay() {
        val plan = staggerItemPlan(index = 0, reduce = false, stepMs = 60, itemDurationMs = 200)

        assertEquals(0, plan.delayMs)
        assertTrue(plan.animates)
        assertTrue(plan.startsHidden)
        assertEquals(200, plan.totalDurationMs)
    }

    @Test
    fun negativeIndexIsClampedToFirst() {
        val plan = staggerItemPlan(index = -5, reduce = false, stepMs = 60, itemDurationMs = 200)

        assertEquals(0, plan.index)
        assertEquals(0, plan.delayMs)
    }

    @Test
    fun negativeSlideIsClampedToZero() {
        val plan = staggerItemPlan(index = 1, reduce = false, slideDp = -10)

        assertEquals(0, plan.startOffsetDp)
        // it still fades (alpha 0 → 1) even with no slide.
        assertTrue(plan.startsHidden)
    }

    @Test
    fun explicitDurationIsStillCollapsedUnderReducedMotion() {
        val plan = staggerItemPlan(index = 2, reduce = true, stepMs = 90, itemDurationMs = 1000, slideDp = 40)

        assertEquals(0, plan.durationMs)
        assertEquals(0, plan.startOffsetDp)
        assertEquals(0, plan.totalDurationMs)
    }

    // ── defaults pin the web parity cadence (staggerChildren 0.06s = 60 ms) + non-zero entrance length ─────

    @Test
    fun defaultsMatchTheNativeMotionTokens() {
        assertEquals(60, DEFAULT_STAGGER_STEP_MS)
        assertTrue(DEFAULT_ITEM_DURATION_MS > 0)
        assertTrue(DEFAULT_SLIDE_DP > 0)
    }
}
