package io.teslasync.android.sharedsurfaces.routetransition

import io.teslasync.android.components.motion.MotionDefaults
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the RouteTransition surface's pure logic — the native mirror of the per-render
 * decision the web component makes (web/src/components/motion/RouteTransition.tsx) before Compose paints:
 * `skipForList = matchesSkip(prev) || matchesSkip(next)`, then `effectiveDurationMs = reduce || skipForList ? 0
 * : durationMs`, plus the `key={location.pathname}` (search excluded). Because the composable is a thin render
 * layer over [transitionPlan], each projected plan here doubles as the surface's per-state snapshot: the animated
 * cross-fade, the reduced-motion instant swap, and the list↔detail skip in both directions. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class RouteTransitionModelTest {
    // ── animated: a non-skip page-to-page navigation with motion enabled fades at the base duration ───────────

    @Test
    fun pageToPageNavigationAnimatesAtTheBaseDuration() {
        val plan = transitionPlan(previousRoute = "/dashboard", nextRoute = "/analytics", reduce = false)

        assertEquals(DEFAULT_TRANSITION_DURATION_MS, plan.effectiveDurationMs)
        assertTrue(plan.animates)
        assertFalse(plan.instant)
        assertFalse(plan.skippedForListDetail)
        assertFalse(plan.reduce)
    }

    @Test
    fun explicitDurationIsHonouredWhenAnimating() {
        val plan = transitionPlan(previousRoute = "/a", nextRoute = "/b", reduce = false, durationMs = 250)

        assertEquals(250, plan.effectiveDurationMs)
        assertTrue(plan.animates)
    }

    // ── reduced motion: the web `reduce ? 0` branch — an instant swap that is NOT a list-detail skip ──────────

    @Test
    fun reducedMotionCollapsesToAnInstantSwap() {
        val plan = transitionPlan(previousRoute = "/dashboard", nextRoute = "/analytics", reduce = true)

        assertEquals(0, plan.effectiveDurationMs)
        assertTrue(plan.instant)
        assertFalse(plan.animates)
        // it is instant because of the motion preference, not because of a skip pattern.
        assertFalse(plan.skippedForListDetail)
        assertTrue(plan.reduce)
    }

    // ── list↔detail skip: drilling IN (next matches `/drives/:id`) suppresses the fade ───────────────────────

    @Test
    fun drillingIntoADetailRouteSkipsTheFade() {
        val plan = transitionPlan(previousRoute = "/drives", nextRoute = "/drives/123", reduce = false)

        assertEquals(0, plan.effectiveDurationMs)
        assertTrue(plan.instant)
        assertTrue(plan.skippedForListDetail)
        assertFalse(plan.reduce)
    }

    // ── list↔detail skip: drilling BACK OUT (previous matches) also suppresses the fade ──────────────────────

    @Test
    fun drillingBackOutOfADetailRouteSkipsTheFade() {
        val plan = transitionPlan(previousRoute = "/vehicles/7", nextRoute = "/vehicles", reduce = false)

        assertEquals(0, plan.effectiveDurationMs)
        assertTrue(plan.skippedForListDetail)
    }

    // ── custom skip patterns override the default set (web `skipPattern` prop) ────────────────────────────────

    @Test
    fun customSkipPatternsAreHonoured() {
        val skipped = transitionPlan("/b", "/b", reduce = false, skipPatterns = listOf("/b"))
        assertTrue(skipped.skippedForListDetail)
        assertEquals(0, skipped.effectiveDurationMs)

        // the same route under the default patterns is NOT a skip route, so it animates.
        val animated = transitionPlan("/b", "/b", reduce = false)
        assertFalse(animated.skippedForListDetail)
        assertTrue(animated.animates)
    }

    // ── re-key by pathname ONLY: a search/hash change must never produce a different key (web parity) ─────────

    @Test
    fun keyIgnoresSearchAndHash() {
        assertEquals("/drives", routeTransitionKey(pathname = "/drives", search = "?sort=date"))
        assertEquals(
            routeTransitionKey(pathname = "/drives", search = ""),
            routeTransitionKey(pathname = "/drives", search = "?sort=date&dir=desc"),
        )
    }

    // ── defaults pin web parity (the 120 ms cross-fade + the shared list-detail skip set) ─────────────────────

    @Test
    fun defaultsMatchTheWebAndTheMotionAtom() {
        assertEquals(MotionDefaults.TRANSITION_MS, DEFAULT_TRANSITION_DURATION_MS)
        assertTrue(DEFAULT_TRANSITION_DURATION_MS > 0)
        assertTrue(DEFAULT_ROUTE_SKIP_PATTERNS.contains("/drives/:id"))
        assertTrue(DEFAULT_ROUTE_SKIP_PATTERNS.contains("/charging/:id"))
        assertTrue(DEFAULT_ROUTE_SKIP_PATTERNS.contains("/vehicles/:id/access"))
    }

    // ── registration pins the surface slug the prompt mandates ────────────────────────────────────────────────

    @Test
    fun registrationExposesTheSurfaceSlug() {
        assertEquals("RouteTransition", ROUTE_TRANSITION_SLUG)
        assertEquals("RouteTransition", RouteTransitionRegistration.SLUG)
        assertEquals("route-transition", RouteTransitionRegistration.ID)
    }
}
