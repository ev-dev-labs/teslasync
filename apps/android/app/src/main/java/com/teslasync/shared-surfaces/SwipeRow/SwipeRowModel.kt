// Pure, framework-free model + gesture projection + diagnostics for the SwipeRow shared surface — the native
// analogue of every value the web component derives before React paints anything
// (web/src/components/mobile/SwipeRow.tsx). No Compose, no Android, no HTTP: every declaration here is exercised
// off-device by the :android:testReleaseUnitTest gate, keeping the composable a thin render layer over these
// pure reducers.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a swipe-to-action row
// primitive for mobile lists, mirroring the iOS Mail / Apple Notes interaction. Dragging the row left reveals the
// right-edge action (`rightAction`); dragging right reveals the left-edge action (`leftAction`). A short release
// past the reveal threshold (default 64 px) leaves the row "peeked" with the action button visible so the user
// taps it; a long release past 50 % of the row width auto-fires the action immediately. A vertical drag aborts the
// gesture so the parent list keeps scrolling (we never fight the scroll axis); the first time the reveal threshold
// is crossed a short haptic blip fires. The snap-back animation collapses to 0 ms under reduced motion. It is
// touch-only by default (`enabled` defaults to `useIsCoarsePointer()`), so a fine pointer renders the children
// straight through with zero handlers.
//
// It owns NO data fetch. Its only web hooks are `useIsCoarsePointer` (touch-vs-fine pointer) and
// `useMotionPreference` (reduced motion) — both environment/preference reads, never a network feed. The action
// callbacks and labels are caller-supplied props, exactly as the host row passes them down (so the surface has no
// i18n strings of its own — the web source has none either; every label is already localized by the caller). So,
// like the sibling presentational surfaces (PullToRefresh, StaggerContainer), there is no loading / empty-fetch /
// error / stale / offline NETWORK lifecycle to model; inventing one would be a fetch the web spec does not have
// (honesty covenant: no scope narrowing, no silent drift). The prompt's generic state list maps onto this
// surface's REAL, fully-reproduced gesture states, with no hidden branch:
//   • Inactive   — fine pointer or no wired action: the children render straight through (web `!active` return);
//   • Closed     — active, offset 0: no action revealed, the wrapped row shown unshifted (the "empty" tier — a
//                  usable surface, never a blank box, because the wrapped content always shows);
//   • Revealing  — dragging: the underlay action panel grows on the swiped side (left drag → right action, right
//                  drag → left action), the live "pulling" tier;
//   • Peeked     — released past the reveal threshold (the "armed / stale" tier): the action sits open at
//                  ±ACTION_WIDTH so the user can tap it to fire;
//   • Fired      — released past 50 % width, or the peeked action tapped: `onAction` runs and the row snaps shut
//                  (the row never gets stuck open — the surface's own recovery, identical to the web).
// Every branch above is exercised by the previews in SwipeRow.kt, the off-device test here, and the on-device
// UI/a11y test.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/SwipeRow — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.swiperow

import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.abs

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
const val SWIPE_ROW_SLUG: String = "SwipeRow"

/** Distance the user must drag before the action is "revealed" — the web `DEFAULT_REVEAL` (64 px → dp). */
const val DEFAULT_REVEAL_PX: Float = 64f

/** Vertical drift past which the gesture cancels so the parent list scrolls — the web `VERTICAL_TOLERANCE` (16). */
const val VERTICAL_TOLERANCE_PX: Float = 16f

/** Width of the revealed action underlay panel — the web `ACTION_WIDTH` (96 px → dp); also the peek-open offset. */
const val ACTION_WIDTH_PX: Float = 96f

/** Horizontal dead-zone before a drag is treated as a swipe — the web `Math.abs(dx) < 8` axis-lock gate. */
const val HORIZONTAL_SLOP_PX: Float = 8f

/** Row-width fallback when the measured width is not yet known — the web `getBoundingClientRect().width || 320`. */
const val FALLBACK_ROW_WIDTH_PX: Float = 320f

/** Fraction of the row width past which a release auto-fires the action — the web `width / 2` long-swipe gate. */
const val AUTO_FIRE_WIDTH_FRACTION: Float = 0.5f

/**
 * Which edge an action lives on. [Right] is revealed by a left drag (negative offset); [Left] is revealed by a
 * right drag (positive offset) — matching the web `rightAction` / `leftAction` prop semantics.
 */
enum class SwipeSide { Left, Right }

/**
 * Whether the swipe gesture is active — the web `(enabled ?? useIsCoarsePointer()) && (rightAction || leftAction)`.
 * [enabled] is the caller's explicit opt-in (`null` falls back to the [coarsePointer] touch default); the gesture
 * only engages when at least one edge action is wired, so a row with no actions always renders straight through.
 */
fun isSwipeActive(
    enabled: Boolean?,
    coarsePointer: Boolean,
    hasLeftAction: Boolean,
    hasRightAction: Boolean,
): Boolean = (enabled ?: coarsePointer) && (hasLeftAction || hasRightAction)

/**
 * The constrained drag offset for a raw horizontal delta of [rawOffsetPx] — the faithful port of the web
 * `onTouchMove` clamping. A drag toward an unwired edge is pinned to 0 (web `if (next < 0 && !rightAction)` /
 * `if (next > 0 && !leftAction)`), and the result is ceilinged to ±the row width so the row can never be dragged
 * fully off-screen (web `maxAbs = width`). A non-positive [rowWidthPx] falls back to [FALLBACK_ROW_WIDTH_PX].
 */
fun clampDragOffsetPx(
    rawOffsetPx: Float,
    hasLeftAction: Boolean,
    hasRightAction: Boolean,
    rowWidthPx: Float,
): Float {
    val towardUnwiredRight = rawOffsetPx < 0f && !hasRightAction
    val towardUnwiredLeft = rawOffsetPx > 0f && !hasLeftAction
    val gated = if (towardUnwiredRight || towardUnwiredLeft) 0f else rawOffsetPx
    val maxAbs = if (rowWidthPx > 0f) rowWidthPx else FALLBACK_ROW_WIDTH_PX
    return gated.coerceIn(-maxAbs, maxAbs)
}

/**
 * Whether a move should abort the swipe and yield to the parent's vertical scroll — the web vertical-abort guard
 * `Math.abs(dy) > VERTICAL_TOLERANCE && Math.abs(dy) > Math.abs(dx)`. On Android the horizontal-orientation drag
 * detector already declines vertical gestures, but this pure mirror keeps the decision asserted off-device.
 */
fun shouldAbortForVertical(
    dxPx: Float,
    dyPx: Float,
): Boolean = abs(dyPx) > VERTICAL_TOLERANCE_PX && abs(dyPx) > abs(dxPx)

/** Whether a horizontal delta is still inside the axis-lock dead-zone — the web `Math.abs(dx) < 8` ignore gate. */
fun isWithinHorizontalSlop(dxPx: Float): Boolean = abs(dxPx) < HORIZONTAL_SLOP_PX

/**
 * Whether the live offset has crossed the reveal threshold — the web `Math.abs(next) >= revealThreshold` gate that
 * fires the one-shot haptic. A non-positive [revealPx] never crosses (degenerate guard).
 */
fun crossedRevealThreshold(
    offsetPx: Float,
    revealPx: Float,
): Boolean = revealPx > 0f && abs(offsetPx) >= revealPx

/** Whether the right-edge action underlay is revealed (the row dragged left) — the web `offset < 0`. */
fun rightActionRevealed(offsetPx: Float): Boolean = offsetPx < 0f

/** Whether the left-edge action underlay is revealed (the row dragged right) — the web `offset > 0`. */
fun leftActionRevealed(offsetPx: Float): Boolean = offsetPx > 0f

/**
 * The surface's render phase — the single source of truth the composable's snapshot renders from. Mirrors the web
 * control flow: a non-[active] surface is [Inactive] (children straight through); an active row at rest is
 * [Closed]; a positive offset reveals the [RevealingLeftAction] underlay, a negative offset the
 * [RevealingRightAction] underlay.
 */
enum class SwipePhase { Inactive, Closed, RevealingLeftAction, RevealingRightAction }

/** Resolves the [SwipePhase] from the gesture inputs — the native mirror of the web render-time branch. */
fun swipePhase(
    active: Boolean,
    offsetPx: Float,
): SwipePhase =
    when {
        !active -> SwipePhase.Inactive
        offsetPx > 0f -> SwipePhase.RevealingLeftAction
        offsetPx < 0f -> SwipePhase.RevealingRightAction
        else -> SwipePhase.Closed
    }

/**
 * The decision taken when the user releases a drag — the faithful port of the web `onTouchEnd` cascade. A release
 * past 50 % of the row width auto-fires the action on that edge ([FireRightAction] / [FireLeftAction]); a shorter
 * release past the reveal threshold peeks the action open ([PeekRightAction] / [PeekLeftAction]); anything else
 * snaps the row [Close]d. Each variant carries no payload — the composable maps it to an offset + an optional fire.
 */
sealed interface SwipeRelease {
    /** Auto-fire the right-edge action (long left swipe) — web `finalOffset <= -halfWidth && rightAction`. */
    data object FireRightAction : SwipeRelease

    /** Auto-fire the left-edge action (long right swipe) — web `finalOffset >= halfWidth && leftAction`. */
    data object FireLeftAction : SwipeRelease

    /** Peek the right-edge action open — web `finalOffset <= -revealThreshold && rightAction`. */
    data object PeekRightAction : SwipeRelease

    /** Peek the left-edge action open — web `finalOffset >= revealThreshold && leftAction`. */
    data object PeekLeftAction : SwipeRelease

    /** Snap the row shut without firing — the web fall-through `updateOffset(0)`. */
    data object Close : SwipeRelease
}

/**
 * Resolves the [SwipeRelease] for a release at [offsetPx] — the web `onTouchEnd` precedence, in order: auto-fire
 * (past half the row width on a wired edge) beats peek (past [revealPx] on a wired edge) beats [Close]. A
 * non-positive [rowWidthPx] falls back to [FALLBACK_ROW_WIDTH_PX] so the half-width gate is always well-defined.
 * Expressed as a single `when` so the resolver has exactly one return.
 */
fun resolveRelease(
    offsetPx: Float,
    rowWidthPx: Float,
    revealPx: Float,
    hasLeftAction: Boolean,
    hasRightAction: Boolean,
): SwipeRelease {
    val width = if (rowWidthPx > 0f) rowWidthPx else FALLBACK_ROW_WIDTH_PX
    val halfWidth = width * AUTO_FIRE_WIDTH_FRACTION
    return when {
        hasRightAction && offsetPx <= -halfWidth -> SwipeRelease.FireRightAction
        hasLeftAction && offsetPx >= halfWidth -> SwipeRelease.FireLeftAction
        hasRightAction && offsetPx <= -revealPx -> SwipeRelease.PeekRightAction
        hasLeftAction && offsetPx >= revealPx -> SwipeRelease.PeekLeftAction
        else -> SwipeRelease.Close
    }
}

/**
 * The resting offset a [release] settles to — the web post-release `updateOffset(...)`. A peek rests at
 * ±[actionWidthPx] (the action sits open at the panel width); a fire or a close snaps back to 0 (the action runs,
 * then the row closes — web `fireRight`/`fireLeft` both call `close()`). [actionWidthPx] is supplied by the caller
 * in its own pixel space (the composable passes the density-scaled [ACTION_WIDTH_PX].dp width) so the resolver
 * stays unit-agnostic and fully testable off-device.
 */
fun releaseTargetOffsetPx(
    release: SwipeRelease,
    actionWidthPx: Float,
): Float =
    when (release) {
        SwipeRelease.PeekRightAction -> -actionWidthPx
        SwipeRelease.PeekLeftAction -> actionWidthPx
        SwipeRelease.FireRightAction, SwipeRelease.FireLeftAction, SwipeRelease.Close -> 0f
    }

/** Whether a [release] fires an action callback — true only for the two auto-fire variants. */
fun releaseFires(release: SwipeRelease): Boolean = release is SwipeRelease.FireRightAction || release is SwipeRelease.FireLeftAction

/** The edge an auto-fire [release] targets, or `null` when the release does not fire — used to pick the callback. */
fun firedSide(release: SwipeRelease): SwipeSide? =
    when (release) {
        SwipeRelease.FireRightAction -> SwipeSide.Right
        SwipeRelease.FireLeftAction -> SwipeSide.Left
        SwipeRelease.PeekRightAction, SwipeRelease.PeekLeftAction, SwipeRelease.Close -> null
    }

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never an action
 * label, offset, or fire outcome — so a diagnostics line can never leak what the user swiped or which row it was.
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it once per open.
 */
object SwipeRowDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = SWIPE_ROW_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
