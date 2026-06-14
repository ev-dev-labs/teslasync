package io.teslasync.android.sharedsurfaces.swiperow

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SwipeRow's pure logic — the native mirror of every value the web component
 * derives before returning JSX (web/src/components/mobile/SwipeRow.tsx): the active gate, the per-side drag
 * clamping, the axis-lock + vertical-abort guards, the reveal-threshold haptic gate, the panel-reveal predicates,
 * the render phase, the release cascade (auto-fire / peek / close with its precedence + unwired guards), the
 * release-target offset, and the fire predicates. Because the composable is a thin render layer over these
 * reducers, the per-branch assertions here double as the surface's per-state snapshot. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class SwipeRowModelTest {
    private val tolerance = 0.0001f

    // ── isSwipeActive (web `(enabled ?? useIsCoarsePointer()) && (rightAction || leftAction)`) ───────────

    @Test
    fun activeWhenTouchPointerAndAnActionIsWired() {
        assertTrue(isSwipeActive(enabled = null, coarsePointer = true, hasLeftAction = false, hasRightAction = true))
        assertTrue(isSwipeActive(enabled = null, coarsePointer = true, hasLeftAction = true, hasRightAction = false))
    }

    @Test
    fun finePointerWithNoExplicitEnableIsInactive() {
        assertFalse(isSwipeActive(enabled = null, coarsePointer = false, hasLeftAction = true, hasRightAction = true))
    }

    @Test
    fun enabledFlagOverridesThePointerDefaultBothWays() {
        // Explicit enable opts a fine pointer in; explicit disable opts a touch pointer out.
        assertTrue(isSwipeActive(enabled = true, coarsePointer = false, hasLeftAction = false, hasRightAction = true))
        assertFalse(isSwipeActive(enabled = false, coarsePointer = true, hasLeftAction = true, hasRightAction = true))
    }

    @Test
    fun noWiredActionIsNeverActive() {
        // Web `&& (rightAction != null || leftAction != null)` — a row with no actions always renders through.
        assertFalse(isSwipeActive(enabled = true, coarsePointer = true, hasLeftAction = false, hasRightAction = false))
    }

    // ── clampDragOffsetPx (web `onTouchMove` per-side gate + ±width clamp) ────────────────────────────────

    @Test
    fun dragTracksTheFingerWhenTheEdgeIsWired() {
        assertEquals(50f, clampDragOffsetPx(50f, hasLeftAction = true, hasRightAction = true, rowWidthPx = 320f), tolerance)
        assertEquals(-50f, clampDragOffsetPx(-50f, hasLeftAction = true, hasRightAction = true, rowWidthPx = 320f), tolerance)
    }

    @Test
    fun dragTowardAnUnwiredEdgeIsPinnedToZero() {
        // Web `if (next < 0 && !rightAction) next = 0` / `if (next > 0 && !leftAction) next = 0`.
        assertEquals(0f, clampDragOffsetPx(-50f, hasLeftAction = true, hasRightAction = false, rowWidthPx = 320f), tolerance)
        assertEquals(0f, clampDragOffsetPx(50f, hasLeftAction = false, hasRightAction = true, rowWidthPx = 320f), tolerance)
    }

    @Test
    fun dragIsCeilingedToTheRowWidth() {
        // Web `maxAbs = width` clamp so the row never disappears.
        assertEquals(-320f, clampDragOffsetPx(-1000f, hasLeftAction = true, hasRightAction = true, rowWidthPx = 320f), tolerance)
        assertEquals(320f, clampDragOffsetPx(1000f, hasLeftAction = true, hasRightAction = true, rowWidthPx = 320f), tolerance)
    }

    @Test
    fun dragUsesTheFallbackWidthWhenUnmeasured() {
        // Web `getBoundingClientRect().width || 320`.
        assertEquals(-100f, clampDragOffsetPx(-100f, hasLeftAction = true, hasRightAction = true, rowWidthPx = 0f), tolerance)
        assertEquals(
            -FALLBACK_ROW_WIDTH_PX,
            clampDragOffsetPx(-9000f, hasLeftAction = true, hasRightAction = true, rowWidthPx = 0f),
            tolerance,
        )
    }

    // ── axis guards (web `Math.abs(dy) > 16 && > Math.abs(dx)` / `Math.abs(dx) < 8`) ─────────────────────

    @Test
    fun verticalAbortMirrorsTheWebGuard() {
        assertTrue(shouldAbortForVertical(dxPx = 5f, dyPx = 20f))
        // Not aborted when the drift is mostly horizontal even if it exceeds the tolerance.
        assertFalse(shouldAbortForVertical(dxPx = 25f, dyPx = 20f))
        // Not aborted below the vertical tolerance.
        assertFalse(shouldAbortForVertical(dxPx = 2f, dyPx = 10f))
    }

    @Test
    fun horizontalSlopMirrorsTheWebDeadZone() {
        assertTrue(isWithinHorizontalSlop(7f))
        assertTrue(isWithinHorizontalSlop(-7f))
        assertFalse(isWithinHorizontalSlop(8f))
        assertFalse(isWithinHorizontalSlop(8.5f))
    }

    // ── crossedRevealThreshold (web `Math.abs(next) >= revealThreshold` haptic gate) ─────────────────────

    @Test
    fun revealCrossingIsSymmetricAndInclusive() {
        assertTrue(crossedRevealThreshold(64f, 64f))
        assertTrue(crossedRevealThreshold(-64f, 64f))
        assertFalse(crossedRevealThreshold(63.9f, 64f))
        // A degenerate threshold never crosses (divide-by-zero / always-on guard).
        assertFalse(crossedRevealThreshold(40f, 0f))
    }

    // ── panel reveal predicates (web `offset < 0` / `offset > 0`) ─────────────────────────────────────────

    @Test
    fun panelsRevealOnTheSwipedSideOnly() {
        assertTrue(rightActionRevealed(-1f))
        assertFalse(rightActionRevealed(0f))
        assertFalse(rightActionRevealed(1f))
        assertTrue(leftActionRevealed(1f))
        assertFalse(leftActionRevealed(0f))
        assertFalse(leftActionRevealed(-1f))
    }

    // ── swipePhase (web render-time control flow) ─────────────────────────────────────────────────────────

    @Test
    fun phaseResolvesEveryWebBranch() {
        // A fine pointer renders children straight through (web `!active` early return).
        assertEquals(SwipePhase.Inactive, swipePhase(active = false, offsetPx = -90f))
        // Rest.
        assertEquals(SwipePhase.Closed, swipePhase(active = true, offsetPx = 0f))
        // Dragging right reveals the left-edge action.
        assertEquals(SwipePhase.RevealingLeftAction, swipePhase(active = true, offsetPx = 30f))
        // Dragging left reveals the right-edge action.
        assertEquals(SwipePhase.RevealingRightAction, swipePhase(active = true, offsetPx = -30f))
    }

    // ── resolveRelease (web `onTouchEnd` cascade) ─────────────────────────────────────────────────────────

    @Test
    fun longSwipePastHalfWidthAutoFires() {
        // Web `finalOffset <= -halfWidth && rightAction` / `finalOffset >= halfWidth && leftAction`.
        val right = resolveRelease(-200f, rowWidthPx = 320f, revealPx = 64f, hasLeftAction = true, hasRightAction = true)
        val left = resolveRelease(200f, rowWidthPx = 320f, revealPx = 64f, hasLeftAction = true, hasRightAction = true)
        assertEquals(SwipeRelease.FireRightAction, right)
        assertEquals(SwipeRelease.FireLeftAction, left)
    }

    @Test
    fun shortSwipePastTheRevealThresholdPeeks() {
        // Web `finalOffset <= -revealThreshold && rightAction` / `finalOffset >= revealThreshold && leftAction`.
        val right = resolveRelease(-100f, rowWidthPx = 320f, revealPx = 64f, hasLeftAction = true, hasRightAction = true)
        val left = resolveRelease(100f, rowWidthPx = 320f, revealPx = 64f, hasLeftAction = true, hasRightAction = true)
        assertEquals(SwipeRelease.PeekRightAction, right)
        assertEquals(SwipeRelease.PeekLeftAction, left)
    }

    @Test
    fun releaseBelowTheRevealThresholdCloses() {
        val close = resolveRelease(-40f, rowWidthPx = 320f, revealPx = 64f, hasLeftAction = true, hasRightAction = true)
        assertEquals(SwipeRelease.Close, close)
    }

    @Test
    fun releaseTowardAnUnwiredEdgeCloses() {
        // No right action wired → even a long left swipe closes (the underlay was never draggable).
        val noRight = resolveRelease(-200f, rowWidthPx = 320f, revealPx = 64f, hasLeftAction = true, hasRightAction = false)
        val noLeft = resolveRelease(200f, rowWidthPx = 320f, revealPx = 64f, hasLeftAction = false, hasRightAction = true)
        assertEquals(SwipeRelease.Close, noRight)
        assertEquals(SwipeRelease.Close, noLeft)
    }

    @Test
    fun autoFireTakesPrecedenceOverPeek() {
        // At -200 (past both -64 reveal and -160 half-width) the auto-fire branch wins (web cascade order).
        val release = resolveRelease(-200f, rowWidthPx = 320f, revealPx = 64f, hasLeftAction = false, hasRightAction = true)
        assertEquals(SwipeRelease.FireRightAction, release)
    }

    @Test
    fun releaseUsesTheFallbackWidthWhenUnmeasured() {
        // Web `width || 320` → half-width 160; -100 peeks, -200 fires.
        val peek = resolveRelease(-100f, rowWidthPx = 0f, revealPx = 64f, hasLeftAction = true, hasRightAction = true)
        val fire = resolveRelease(-200f, rowWidthPx = 0f, revealPx = 64f, hasLeftAction = true, hasRightAction = true)
        assertEquals(SwipeRelease.PeekRightAction, peek)
        assertEquals(SwipeRelease.FireRightAction, fire)
    }

    // ── releaseTargetOffsetPx / releaseFires / firedSide ─────────────────────────────────────────────────

    @Test
    fun peekReleasesRestAtTheActionWidth() {
        assertEquals(-96f, releaseTargetOffsetPx(SwipeRelease.PeekRightAction, actionWidthPx = 96f), tolerance)
        assertEquals(96f, releaseTargetOffsetPx(SwipeRelease.PeekLeftAction, actionWidthPx = 96f), tolerance)
    }

    @Test
    fun fireAndCloseReleasesSnapToZero() {
        assertEquals(0f, releaseTargetOffsetPx(SwipeRelease.FireRightAction, actionWidthPx = 96f), tolerance)
        assertEquals(0f, releaseTargetOffsetPx(SwipeRelease.FireLeftAction, actionWidthPx = 96f), tolerance)
        assertEquals(0f, releaseTargetOffsetPx(SwipeRelease.Close, actionWidthPx = 96f), tolerance)
    }

    @Test
    fun onlyAutoFireReleasesFireAndCarryTheirSide() {
        assertTrue(releaseFires(SwipeRelease.FireRightAction))
        assertTrue(releaseFires(SwipeRelease.FireLeftAction))
        assertFalse(releaseFires(SwipeRelease.PeekRightAction))
        assertFalse(releaseFires(SwipeRelease.PeekLeftAction))
        assertFalse(releaseFires(SwipeRelease.Close))

        assertEquals(SwipeSide.Right, firedSide(SwipeRelease.FireRightAction))
        assertEquals(SwipeSide.Left, firedSide(SwipeRelease.FireLeftAction))
        assertNull(firedSide(SwipeRelease.PeekRightAction))
        assertNull(firedSide(SwipeRelease.Close))
    }

    // ── constants pinned to the web contract ─────────────────────────────────────────────────────────────

    @Test
    fun constantsMatchTheWebContract() {
        assertEquals(64f, DEFAULT_REVEAL_PX, tolerance)
        assertEquals(16f, VERTICAL_TOLERANCE_PX, tolerance)
        assertEquals(96f, ACTION_WIDTH_PX, tolerance)
        assertEquals(8f, HORIZONTAL_SLOP_PX, tolerance)
        assertEquals(320f, FALLBACK_ROW_WIDTH_PX, tolerance)
        assertEquals(0.5f, AUTO_FIRE_WIDTH_FRACTION, tolerance)
    }
}
