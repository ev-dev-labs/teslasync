package io.teslasync.android.sharedsurfaces.fadein

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the FadeIn's pure entrance logic — the native mirror of every decision the web
 * component makes (web/src/components/motion/FadeIn.tsx) before Compose paints. Because the composable is a thin
 * render layer over [fadePlan], the per-state assertions here double as the surface's per-state snapshot: the
 * animated reveal, the immediate reduced-motion state, and the clamped degenerate inputs. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class FadeInModelTest {
    // ── animated: the element starts hidden + slid down and reveals over the full duration (web initial y:12) ──

    @Test
    fun planRevealsFromHiddenWhenAnimated() {
        val plan = fadePlan(reduce = false, durationMs = 400, delayMs = 0, slideDp = 12)

        assertEquals(400, plan.durationMs)
        assertEquals(0, plan.delayMs)
        assertEquals(12, plan.slideDp)
        assertTrue(plan.animates)
        assertEquals(0f, plan.initialAlpha, 0f)
        assertEquals(12, plan.initialOffsetDp)
        assertEquals(400, plan.totalDurationMs)
        assertFalse(plan.isInstant)
    }

    // ── reduced motion: the web `initial={false}` branch — final state at once, delay + slide ignored ─────────

    @Test
    fun planCollapsesUnderReducedMotion() {
        val plan = fadePlan(reduce = true, durationMs = 400, delayMs = 120, slideDp = 12)

        assertEquals(0, plan.durationMs)
        assertEquals(0, plan.delayMs)
        assertEquals(0, plan.slideDp)
        assertFalse(plan.animates)
        assertEquals(1f, plan.initialAlpha, 0f)
        assertEquals(0, plan.initialOffsetDp)
        assertEquals(0, plan.totalDurationMs)
        assertTrue(plan.isInstant)
    }

    // ── the web `delay: reduce ? 0 : delay` — honoured when animated, dropped under reduced motion ────────────

    @Test
    fun delayIsHonouredWhenAnimatedAndIgnoredWhenReduced() {
        val animated = fadePlan(reduce = false, durationMs = 400, delayMs = 200)
        assertEquals(200, animated.delayMs)
        assertEquals(600, animated.totalDurationMs)

        val reduced = fadePlan(reduce = true, durationMs = 400, delayMs = 200)
        assertEquals(0, reduced.delayMs)
        assertEquals(0, reduced.totalDurationMs)
    }

    // ── negative inputs are clamped to 0 so a caller can never schedule a negative reveal ─────────────────────

    @Test
    fun negativeInputsAreClampedToZero() {
        val plan = fadePlan(reduce = false, durationMs = -10, delayMs = -5, slideDp = -3)

        assertEquals(0, plan.durationMs)
        assertEquals(0, plan.delayMs)
        assertEquals(0, plan.slideDp)
        assertTrue(plan.animates)
        assertEquals(0f, plan.initialAlpha, 0f)
        assertTrue(plan.isInstant)
    }

    // ── defaults pin the web parity entrance (slide-up over the token duration, no delay) ─────────────────────

    @Test
    fun defaultsMatchTheAtomTokens() {
        assertTrue(DEFAULT_FADE_DURATION_MS > 0)
        assertEquals(0, DEFAULT_FADE_DELAY_MS)
        assertTrue(DEFAULT_FADE_SLIDE_DP > 0)

        val plan = fadePlan(reduce = false)
        assertEquals(DEFAULT_FADE_DURATION_MS, plan.durationMs)
        assertEquals(DEFAULT_FADE_DELAY_MS, plan.delayMs)
        assertEquals(DEFAULT_FADE_SLIDE_DP, plan.slideDp)
        assertEquals(DEFAULT_FADE_SLIDE_DP, plan.initialOffsetDp)
    }
}
