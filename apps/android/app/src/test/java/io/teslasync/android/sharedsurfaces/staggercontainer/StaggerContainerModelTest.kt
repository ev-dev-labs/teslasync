package io.teslasync.android.sharedsurfaces.staggercontainer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the StaggerContainer's pure cadence logic — the native mirror of every decision the
 * web component makes (web/src/components/motion/StaggerContainer.tsx) before Compose paints. Because the
 * composable is a thin render layer over [staggerPlan], the per-cadence assertions here double as the surface's
 * per-state snapshot: the animated stagger, the collapsed reduced-motion state, the single-item / empty
 * pass-through. Runs in the :android:testReleaseUnitTest gate.
 */
class StaggerContainerModelTest {
    // ── animated: per-index delays scale by the step, total settles after the last child finishes ──────────

    @Test
    fun planDelaysScaleByIndexWhenAnimated() {
        val plan = staggerPlan(itemCount = 4, reduce = false, stepMs = 60, itemDurationMs = 200)

        assertEquals(listOf(0, 60, 120, 180), plan.delaysMs)
        assertEquals(4, plan.itemCount)
        assertFalse(plan.isEmpty)
        assertTrue(plan.animates)
        // last child starts at 180 ms and runs for 200 ms.
        assertEquals(380, plan.totalDurationMs)
    }

    // ── reduced motion: the web `staggerChildren: 0` branch — every child starts at once, instantly ────────

    @Test
    fun planCollapsesUnderReducedMotion() {
        val plan = staggerPlan(itemCount = 4, reduce = true, stepMs = 60, itemDurationMs = 200)

        assertEquals(listOf(0, 0, 0, 0), plan.delaysMs)
        assertFalse(plan.animates)
        assertEquals(0, plan.itemDurationMs)
        assertEquals(0, plan.totalDurationMs)
    }

    // ── empty: a transparent pass-through with no children and nothing to animate (web empty motion.div) ───

    @Test
    fun emptyPlanHasNoItemsAndZeroDuration() {
        val plan = staggerPlan(itemCount = 0, reduce = false)

        assertTrue(plan.isEmpty)
        assertFalse(plan.animates)
        assertEquals(0, plan.itemCount)
        assertEquals(0, plan.totalDurationMs)
    }

    // ── a single child never visibly staggers (its only delay is 0) but still plays its entrance ───────────

    @Test
    fun singleItemDoesNotVisiblyStagger() {
        val plan = staggerPlan(itemCount = 1, reduce = false, stepMs = 60, itemDurationMs = 200)

        assertEquals(listOf(0), plan.delaysMs)
        assertFalse(plan.animates)
        assertEquals(200, plan.totalDurationMs)
    }

    @Test
    fun negativeCountIsClampedToEmpty() {
        assertTrue(staggerPlan(itemCount = -3, reduce = false).isEmpty)
    }

    // ── defaults pin the web parity cadence (staggerChildren 0.06s = 60 ms) ────────────────────────────────

    @Test
    fun defaultsMatchTheWebCadence() {
        assertEquals(60, DEFAULT_STAGGER_STEP_MS)
        assertTrue(DEFAULT_ITEM_DURATION_MS > 0)
    }

    @Test
    fun reducedItemDurationOverrideIsStillCollapsed() {
        // an explicit per-item length is ignored under reduced motion — the whole entrance is instant.
        val plan = staggerPlan(itemCount = 3, reduce = true, stepMs = 90, itemDurationMs = 1000)
        assertEquals(0, plan.itemDurationMs)
        assertEquals(0, plan.totalDurationMs)
    }
}
