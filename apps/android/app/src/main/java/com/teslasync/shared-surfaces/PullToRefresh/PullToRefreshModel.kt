// Pure, framework-free model + projection + diagnostics for the PullToRefresh shared surface — the native
// analogue of every value the web component derives before returning JSX
// (web/src/components/mobile/PullToRefresh.tsx). No Compose, no Android, no HTTP: every declaration here is
// exercised off-device by the :android:testReleaseUnitTest gate, keeping the composable a thin render layer
// over these pure reducers.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a native-feel
// pull-to-refresh wrapper for mobile lists. The user touches the very top of a scroll container and drags
// down; a small arc grows with the pull; past the threshold (default 80 px) the bar locks into a
// "release to refresh" state; releasing past the threshold fires `onRefresh()` and shows a "Refreshing…"
// label until the returned promise settles; releasing below the threshold snaps back without firing. It is
// touch-only by default (`enabled` defaults to `useIsCoarsePointer()`), so a non-touch pointer renders the
// children straight through with no gesture. Past the threshold the pull is rubber-banded (half resistance)
// and ceilinged at MAX_PULL; reduced motion collapses the snap-back animation.
//
// It owns NO data fetch. Its only web hooks are `useIsCoarsePointer` (touch-vs-fine pointer),
// `useTranslation` (i18n), and `useMotionPreference` (reduced motion) — all environment/preference reads,
// none a network feed. The refresh action itself is the caller-supplied `onRefresh` prop, exactly as the
// host page passes it down. So — like the sibling presentational surfaces (TimelineScrubber, Spinner) — there
// is no loading / empty-fetch / error / stale / offline network lifecycle to model; inventing one would be a
// fetch the web spec does not have (honesty covenant: no scope narrowing, no silent drift). The prompt's
// generic state list maps onto this surface's REAL, fully-reproduced gesture states, with no hidden branch:
//   • Inactive   — non-touch pointer: the children render straight through (web `!active` early return);
//   • Idle       — active, no pull and not refreshing: the indicator is absent, the content unshifted (the
//                  "empty" tier — a usable surface, never a blank box, because the wrapped content shows);
//   • Pulling    — dragging below the threshold: the growing arc + "Pull to refresh";
//   • Ready      — pulled to/past the threshold (the "stale, armed for refresh" tier): "Release to refresh";
//   • Refreshing — the release fired `onRefresh` (the "loading" tier): the spinner + "Refreshing…", held
//                  until the action settles, after which the bar retracts (web `try/finally` clears it on
//                  success OR failure, so the indicator is never left stuck — the surface's error/offline
//                  recovery, identical to the web, which surfaces no separate error chrome of its own).
// Every branch above is exercised by the previews in PullToRefresh.kt, the off-device test here, and the
// on-device UI/a11y test.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/PullToRefresh — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pulltorefresh

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
const val PULL_TO_REFRESH_SLUG: String = "PullToRefresh"

/** Default pixels the user must pull before a release fires `onRefresh` — the web `DEFAULT_THRESHOLD` (80). */
const val DEFAULT_THRESHOLD_PX: Float = 80f

/** Visual ceiling — past this point further pull is resisted away (rubber band) — the web `MAX_PULL` (140). */
const val MAX_PULL_PX: Float = 140f

/** Resistance applied to pull past the threshold — the web `(delta - threshold) * 0.5` rubber-band factor. */
const val PULL_RESISTANCE: Float = 0.5f

/** The refreshing indicator's resting height as a fraction of the threshold — the web `threshold * 0.6`. */
const val INDICATOR_HEIGHT_FACTOR: Float = 0.6f

/** Pull beyond which a move event should pre-empt the native scroll — the web `delta > 8` preventDefault gate. */
const val PREVENT_SCROLL_DELTA_PX: Float = 8f

/** The indicator's floor opacity while pulling — the web `Math.max(0.4, progress)`. */
const val MIN_INDICATOR_OPACITY: Float = 0.4f

/** The indicator's base scale at zero pull — the web `scale(0.8 + progress * 0.2)` base. */
const val INDICATOR_SCALE_BASE: Float = 0.8f

/** The indicator's scale growth across the pull — the web `scale(0.8 + progress * 0.2)` range. */
const val INDICATOR_SCALE_RANGE: Float = 0.2f

/** The arc's maximum rotation across the pull — the web `rotate(progress * 270deg)`. */
const val SPINNER_MAX_ROTATION_DEG: Float = 270f

/** Clamp a [value] to 0..1, folding NaN to 0 — the shared guard behind every fractional projection below. */
private fun clamp01(value: Float): Float = if (value.isNaN()) 0f else value.coerceIn(0f, 1f)

/**
 * The resisted, ceilinged pull for a raw downward drag of [rawDeltaPx] against [thresholdPx] — the faithful
 * port of the web `resisted`/`clamped` math. A non-positive drag yields 0; below the threshold the pull tracks
 * the finger 1:1; past it the excess is halved (rubber band); the result is ceilinged at [MAX_PULL_PX].
 */
fun resistedPull(
    rawDeltaPx: Float,
    thresholdPx: Float,
): Float {
    if (rawDeltaPx <= 0f || rawDeltaPx.isNaN()) return 0f
    val resisted =
        if (rawDeltaPx < thresholdPx) {
            rawDeltaPx
        } else {
            thresholdPx + (rawDeltaPx - thresholdPx) * PULL_RESISTANCE
        }
    return resisted.coerceAtMost(MAX_PULL_PX)
}

/**
 * The 0..1 pull progress — the web `refreshing ? 1 : Math.min(pull / threshold, 1)`. While [refreshing] the
 * progress is pinned to full; otherwise it is the clamped pull-over-threshold ratio (0 when the threshold is
 * non-positive, so a degenerate threshold can never divide by zero).
 */
fun pullProgress(
    pullPx: Float,
    thresholdPx: Float,
    refreshing: Boolean,
): Float {
    if (refreshing) return 1f
    return if (thresholdPx <= 0f) 0f else clamp01(pullPx / thresholdPx)
}

/** Whether the pull has reached the release threshold — the web `pull >= threshold` (the armed `ready` state). */
fun isReady(
    pullPx: Float,
    thresholdPx: Float,
): Boolean = thresholdPx > 0f && pullPx >= thresholdPx

/**
 * The indicator strip height in px — the web `refreshing ? threshold * 0.6 : pull`. While refreshing the strip
 * rests at [INDICATOR_HEIGHT_FACTOR] of the threshold; otherwise it grows with the live pull (floored at 0).
 */
fun indicatorHeightPx(
    pullPx: Float,
    thresholdPx: Float,
    refreshing: Boolean,
): Float = if (refreshing) thresholdPx * INDICATOR_HEIGHT_FACTOR else pullPx.coerceAtLeast(0f)

/**
 * The content's downward offset in px — the web `translate3d(0, refreshing ? threshold * 0.6 : pull, 0)`. It
 * mirrors [indicatorHeightPx] so the content top always meets the indicator strip's bottom.
 */
fun contentOffsetPx(
    pullPx: Float,
    thresholdPx: Float,
    refreshing: Boolean,
): Float = indicatorHeightPx(pullPx, thresholdPx, refreshing)

/** Whether the indicator renders at all — the web `(pull > 0 || refreshing)`. */
fun indicatorVisible(
    pullPx: Float,
    refreshing: Boolean,
): Boolean = refreshing || pullPx > 0f

/** The indicator opacity for a 0..1 [progress] — the web `Math.max(0.4, progress)`. */
fun indicatorOpacity(progress: Float): Float = clamp01(progress).coerceAtLeast(MIN_INDICATOR_OPACITY)

/** The indicator scale for a 0..1 [progress] — the web `0.8 + progress * 0.2`. */
fun indicatorScale(progress: Float): Float = INDICATOR_SCALE_BASE + clamp01(progress) * INDICATOR_SCALE_RANGE

/** The arc rotation in degrees for a 0..1 [progress] — the web `progress * 270` (applied only while pulling). */
fun spinnerRotationDeg(progress: Float): Float = clamp01(progress) * SPINNER_MAX_ROTATION_DEG

/** Whether the arc spins continuously — the web `refreshing && !reduce` (`animate-spin`, off under reduced motion). */
fun shouldSpin(
    refreshing: Boolean,
    reduceMotion: Boolean,
): Boolean = refreshing && !reduceMotion

/**
 * Whether a downward move should pre-empt the platform scroll — the web `e.cancelable && delta > 8`
 * `preventDefault`, so a real pull is not fought by the browser's own scroll / overscroll shell.
 */
fun shouldPreventScroll(rawDeltaPx: Float): Boolean = rawDeltaPx > PREVENT_SCROLL_DELTA_PX

/**
 * Whether a release should fire `onRefresh` — the web `wasArmed && distance >= threshold`. [armed] is the
 * gesture's live arm flag (cleared when the finger travels back above the start); [pullPx] is the resisted
 * pull at release. Both must hold, and the threshold must be positive, before the action runs.
 */
fun shouldFireRefresh(
    armed: Boolean,
    pullPx: Float,
    thresholdPx: Float,
): Boolean = armed && thresholdPx > 0f && pullPx >= thresholdPx

/**
 * The gesture's lifecycle phase — the single source of truth the composable renders from. Mirrors the web
 * control flow: a non-[active] surface is [Inactive] (children pass straight through); an active surface is
 * [Refreshing] while the action runs, [Idle] at rest, [Ready] once pulled to the threshold, else [Pulling].
 */
enum class RefreshPhase { Inactive, Idle, Pulling, Ready, Refreshing }

/** Resolves the [RefreshPhase] from the gesture inputs — the native mirror of the web render-time branch. */
fun refreshPhase(
    active: Boolean,
    pullPx: Float,
    thresholdPx: Float,
    refreshing: Boolean,
): RefreshPhase =
    when {
        !active -> RefreshPhase.Inactive
        refreshing -> RefreshPhase.Refreshing
        pullPx <= 0f -> RefreshPhase.Idle
        isReady(pullPx, thresholdPx) -> RefreshPhase.Ready
        else -> RefreshPhase.Pulling
    }

/**
 * The localized label the indicator shows — selects the i18n key the composable resolves. Mirrors the web
 * ternary `refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'`.
 */
enum class RefreshLabel { Pull, Release, Refreshing }

/** Picks the [RefreshLabel] for the current state — the web indicator-label ternary. */
fun refreshLabel(
    refreshing: Boolean,
    ready: Boolean,
): RefreshLabel =
    when {
        refreshing -> RefreshLabel.Refreshing
        ready -> RefreshLabel.Release
        else -> RefreshLabel.Pull
    }

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a pull
 * distance, threshold, or refresh outcome — so a diagnostics line can never leak what the user was viewing or
 * doing. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it once per
 * surface open.
 */
object PullToRefreshDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = PULL_TO_REFRESH_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
