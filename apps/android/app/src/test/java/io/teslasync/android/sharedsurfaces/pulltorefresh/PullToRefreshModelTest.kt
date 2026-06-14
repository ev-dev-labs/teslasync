package io.teslasync.android.sharedsurfaces.pulltorefresh

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the PullToRefresh's pure logic — the native mirror of every value the web
 * component derives before returning JSX (web/src/components/mobile/PullToRefresh.tsx): the rubber-banded,
 * ceilinged pull, the 0..1 progress with its refreshing pin and divide-by-zero guard, the threshold/ready
 * gate, the indicator strip height + content offset, the opacity/scale/rotation transforms, the spin +
 * prevent-scroll gates, the release-fire decision, and the phase/label resolvers. Because the composable is a
 * thin render layer over these reducers, the per-branch assertions here double as the surface's per-state
 * snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class PullToRefreshModelTest {
    private val tolerance = 0.0001f

    // ── resistedPull (web `resisted` + MAX_PULL clamp) ───────────────────────────────────────────────

    @Test
    fun pullTracksTheFingerBelowTheThreshold() {
        assertEquals(0f, resistedPull(0f, 80f), tolerance)
        assertEquals(40f, resistedPull(40f, 80f), tolerance)
        // At the threshold the rubber band has not engaged yet (web `delta < threshold` is false → +0).
        assertEquals(80f, resistedPull(80f, 80f), tolerance)
    }

    @Test
    fun pullIsHalfResistedPastTheThreshold() {
        // Web `threshold + (delta - threshold) * 0.5`.
        assertEquals(100f, resistedPull(120f, 80f), tolerance)
        assertEquals(140f, resistedPull(200f, 80f), tolerance)
    }

    @Test
    fun pullIsCeilingedAtMaxPull() {
        assertEquals(MAX_PULL_PX, resistedPull(400f, 80f), tolerance)
        assertEquals(MAX_PULL_PX, resistedPull(10_000f, 80f), tolerance)
    }

    @Test
    fun nonPositiveOrNaNDragYieldsNoPull() {
        assertEquals(0f, resistedPull(-12f, 80f), tolerance)
        assertEquals(0f, resistedPull(Float.NaN, 80f), tolerance)
    }

    // ── pullProgress (web `refreshing ? 1 : Math.min(pull / threshold, 1)`) ──────────────────────────

    @Test
    fun progressIsTheClampedPullOverThresholdRatio() {
        assertEquals(0f, pullProgress(0f, 80f, refreshing = false), tolerance)
        assertEquals(0.5f, pullProgress(40f, 80f, refreshing = false), tolerance)
        assertEquals(1f, pullProgress(80f, 80f, refreshing = false), tolerance)
        // Clamped at 1 even when the (resisted) pull exceeds the threshold.
        assertEquals(1f, pullProgress(140f, 80f, refreshing = false), tolerance)
    }

    @Test
    fun progressIsPinnedToFullWhileRefreshing() {
        assertEquals(1f, pullProgress(0f, 80f, refreshing = true), tolerance)
    }

    @Test
    fun progressGuardsADegenerateThreshold() {
        // A non-positive threshold can never divide by zero → 0 (still 1 while refreshing).
        assertEquals(0f, pullProgress(40f, 0f, refreshing = false), tolerance)
        assertEquals(1f, pullProgress(40f, 0f, refreshing = true), tolerance)
    }

    // ── isReady (web `pull >= threshold`) ────────────────────────────────────────────────────────────

    @Test
    fun readyOnlyOnceTheThresholdIsReached() {
        assertTrue(isReady(80f, 80f))
        assertTrue(isReady(140f, 80f))
        assertFalse(isReady(79.9f, 80f))
        // A non-positive threshold is never "ready" (degenerate guard).
        assertFalse(isReady(80f, 0f))
    }

    // ── indicatorHeightPx / contentOffsetPx (web `refreshing ? threshold * 0.6 : pull`) ──────────────

    @Test
    fun indicatorHeightTracksPullOrRestsWhileRefreshing() {
        assertEquals(40f, indicatorHeightPx(40f, 80f, refreshing = false), tolerance)
        assertEquals(0f, indicatorHeightPx(0f, 80f, refreshing = false), tolerance)
        // Web `threshold * 0.6` resting height while refreshing, regardless of the live pull.
        assertEquals(48f, indicatorHeightPx(0f, 80f, refreshing = true), tolerance)
        assertEquals(48f, indicatorHeightPx(140f, 80f, refreshing = true), tolerance)
    }

    @Test
    fun indicatorHeightNeverGoesNegative() {
        assertEquals(0f, indicatorHeightPx(-25f, 80f, refreshing = false), tolerance)
    }

    @Test
    fun contentOffsetMirrorsTheIndicatorHeight() {
        // Web content `translate3d(0, refreshing ? threshold * 0.6 : pull, 0)` matches the strip height exactly.
        assertEquals(indicatorHeightPx(55f, 80f, false), contentOffsetPx(55f, 80f, false), tolerance)
        assertEquals(indicatorHeightPx(0f, 80f, true), contentOffsetPx(0f, 80f, true), tolerance)
    }

    // ── indicatorVisible (web `pull > 0 || refreshing`) ──────────────────────────────────────────────

    @Test
    fun indicatorShowsOnlyWhilePullingOrRefreshing() {
        assertFalse(indicatorVisible(0f, refreshing = false))
        assertTrue(indicatorVisible(1f, refreshing = false))
        assertTrue(indicatorVisible(0f, refreshing = true))
    }

    // ── opacity / scale / rotation transforms ────────────────────────────────────────────────────────

    @Test
    fun opacityFloorsAtTheWebMinimum() {
        // Web `Math.max(0.4, progress)`.
        assertEquals(MIN_INDICATOR_OPACITY, indicatorOpacity(0f), tolerance)
        assertEquals(MIN_INDICATOR_OPACITY, indicatorOpacity(0.2f), tolerance)
        assertEquals(0.5f, indicatorOpacity(0.5f), tolerance)
        assertEquals(1f, indicatorOpacity(1f), tolerance)
    }

    @Test
    fun scaleGrowsFromTheWebBase() {
        // Web `scale(0.8 + progress * 0.2)`.
        assertEquals(0.8f, indicatorScale(0f), tolerance)
        assertEquals(0.9f, indicatorScale(0.5f), tolerance)
        assertEquals(1f, indicatorScale(1f), tolerance)
    }

    @Test
    fun rotationSpansTheWebArc() {
        // Web `rotate(progress * 270deg)`.
        assertEquals(0f, spinnerRotationDeg(0f), tolerance)
        assertEquals(135f, spinnerRotationDeg(0.5f), tolerance)
        assertEquals(SPINNER_MAX_ROTATION_DEG, spinnerRotationDeg(1f), tolerance)
    }

    // ── shouldSpin (web `refreshing && !reduce`) ─────────────────────────────────────────────────────

    @Test
    fun arcSpinsOnlyWhileRefreshingAndMotionIsAllowed() {
        assertTrue(shouldSpin(refreshing = true, reduceMotion = false))
        assertFalse(shouldSpin(refreshing = true, reduceMotion = true))
        assertFalse(shouldSpin(refreshing = false, reduceMotion = false))
    }

    // ── shouldPreventScroll (web `e.cancelable && delta > 8`) ─────────────────────────────────────────

    @Test
    fun scrollIsPreemptedOnlyPastTheWebDeadZone() {
        assertFalse(shouldPreventScroll(8f))
        assertTrue(shouldPreventScroll(8.5f))
        assertTrue(shouldPreventScroll(40f))
    }

    // ── shouldFireRefresh (web `wasArmed && distance >= threshold`) ───────────────────────────────────

    @Test
    fun refreshFiresOnlyWhenArmedAndPastTheThreshold() {
        assertTrue(shouldFireRefresh(armed = true, pullPx = 80f, thresholdPx = 80f))
        assertTrue(shouldFireRefresh(armed = true, pullPx = 140f, thresholdPx = 80f))
        // Below the threshold → snap back without firing (web `distance < threshold`).
        assertFalse(shouldFireRefresh(armed = true, pullPx = 79f, thresholdPx = 80f))
        // Disarmed (the finger travelled back above the start) → never fires (web `!wasArmed`).
        assertFalse(shouldFireRefresh(armed = false, pullPx = 120f, thresholdPx = 80f))
        // Degenerate threshold guard.
        assertFalse(shouldFireRefresh(armed = true, pullPx = 80f, thresholdPx = 0f))
    }

    // ── refreshPhase (web render-time control flow) ──────────────────────────────────────────────────

    @Test
    fun phaseResolvesEveryWebBranchInPrecedence() {
        // A fine pointer renders children straight through (web `!active` early return).
        assertEquals(RefreshPhase.Inactive, refreshPhase(active = false, pullPx = 90f, thresholdPx = 80f, refreshing = true))
        // Refreshing wins over any pull value.
        assertEquals(RefreshPhase.Refreshing, refreshPhase(active = true, pullPx = 0f, thresholdPx = 80f, refreshing = true))
        // Rest.
        assertEquals(RefreshPhase.Idle, refreshPhase(active = true, pullPx = 0f, thresholdPx = 80f, refreshing = false))
        // Armed at/past the threshold.
        assertEquals(RefreshPhase.Ready, refreshPhase(active = true, pullPx = 80f, thresholdPx = 80f, refreshing = false))
        // Pulling below the threshold.
        assertEquals(RefreshPhase.Pulling, refreshPhase(active = true, pullPx = 30f, thresholdPx = 80f, refreshing = false))
    }

    // ── refreshLabel (web indicator-label ternary) ───────────────────────────────────────────────────

    @Test
    fun labelMatchesTheWebTernary() {
        // Web `refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'`.
        assertEquals(RefreshLabel.Refreshing, refreshLabel(refreshing = true, ready = true))
        assertEquals(RefreshLabel.Refreshing, refreshLabel(refreshing = true, ready = false))
        assertEquals(RefreshLabel.Release, refreshLabel(refreshing = false, ready = true))
        assertEquals(RefreshLabel.Pull, refreshLabel(refreshing = false, ready = false))
    }

    // ── constants pinned to the web contract ─────────────────────────────────────────────────────────

    @Test
    fun constantsMatchTheWebContract() {
        assertEquals(80f, DEFAULT_THRESHOLD_PX, tolerance)
        assertEquals(140f, MAX_PULL_PX, tolerance)
        assertEquals(0.5f, PULL_RESISTANCE, tolerance)
        assertEquals(0.6f, INDICATOR_HEIGHT_FACTOR, tolerance)
        assertEquals(8f, PREVENT_SCROLL_DELTA_PX, tolerance)
        assertEquals(0.4f, MIN_INDICATOR_OPACITY, tolerance)
        assertEquals(0.8f, INDICATOR_SCALE_BASE, tolerance)
        assertEquals(0.2f, INDICATOR_SCALE_RANGE, tolerance)
        assertEquals(270f, SPINNER_MAX_ROTATION_DEG, tolerance)
    }
}
