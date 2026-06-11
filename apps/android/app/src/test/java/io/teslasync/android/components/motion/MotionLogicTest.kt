package io.teslasync.android.components.motion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the framework-free motion logic in `MotionPreference.kt` and
 * `RouteTransition.kt`. These run in the `:android:testDebugUnitTest` gate and pin the
 * reduced-motion duration math, the stagger cadence, and the route-pattern skip rules —
 * the deterministic clock the composables animate against.
 */
class MotionLogicTest {
    @Test
    fun effectiveDurationCollapsesUnderReducedMotion() {
        assertEquals(0, effectiveDurationMs(reduce = true, requestedMs = 250))
        assertEquals(250, effectiveDurationMs(reduce = false, requestedMs = 250))
        assertEquals(0, effectiveDurationMs(reduce = false, requestedMs = -5))
    }

    @Test
    fun staggerDelayScalesByIndex() {
        assertEquals(0, staggerDelayMs(index = 0, stepMs = 60, reduce = false))
        assertEquals(180, staggerDelayMs(index = 3, stepMs = 60, reduce = false))
        assertEquals(0, staggerDelayMs(index = 3, stepMs = 60, reduce = true))
    }

    @Test
    fun routePatternMatchesExactAndWildcardSegments() {
        assertTrue(matchesRoutePattern("/drives/:id", "/drives/123"))
        assertTrue(matchesRoutePattern("/vehicles/:id/access", "/vehicles/7/access"))
        assertFalse(matchesRoutePattern("/drives/:id", "/drives/123/replay"))
        assertFalse(matchesRoutePattern("/drives/:id", "/charging/123"))
    }

    @Test
    fun skipTransitionFiresForPreviousOrNext() {
        assertTrue(shouldSkipTransition("/drives", "/drives/9"))
        assertTrue(shouldSkipTransition("/drives/9", "/drives"))
        assertFalse(shouldSkipTransition("/drives", "/charging"))
        assertFalse(shouldSkipTransition("/dashboard", "/analytics"))
    }
}
