// Pure, framework-free model + spotlight/tooltip geometry + render classifier for the TourOverlay shared
// surface — the native analogue of every decision the web component makes
// (web/src/components/feedback/TourOverlay.tsx) before it paints its coach-mark. No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A CONTROLLED full-screen tour spotlight. The parent owns the cursor (web `useTour`) and hands the view
//     its props: the active `step`, the highlighted element's `targetRect`, the `currentStep` / `totalSteps`
//     cursor, and the `onNext` / `onPrev` / `onSkip` callbacks. Its only data hooks are `useTranslation`
//     (i18n) and `useMotionPreference` (reduced motion). There is NO fetch and NO data port to bind — the
//     native motion seam is `rememberReducedMotion()` (P1/S8) and the i18n seam is the string catalog
//     (P1/S10), exactly mirroring the equally-presentational OnboardingWizard / AiLimitBanner siblings
//     (composable + model, no Source/ViewModel). Modelling an async dependency the web spec does not have
//     would be dishonest scope drift.
//   • `targetRect == null` → the web returns `null` (renders nothing). Native mirror: [TourSurface.Hidden].
//   • `targetRect != null` → the spotlight is shown. Its REAL, fully-reproduced branches — each reduced here
//     and asserted off-device — are: the first step (web `currentStep > 0` gate hides "Back"), the middle
//     step (Back + "Next" with a trailing arrow), the final step (Back + "Get Started!", no arrow — web
//     `currentStep === totalSteps - 1`), the four tooltip placements (top / bottom / left / right — web
//     `getTooltipPosition`), and the active-vs-inactive progress dots (web `i === currentStep`).
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent:
// this surface fetches nothing — it is a controlled presentational overlay driven entirely by its props.
// There is no query to be loading, to fail, to go stale, or to be offline, so inventing those states would
// be dishonest. The host decides whether the overlay is mounted and which step is active; once visible it
// always renders a full, non-blank tooltip — there is no hidden region, only the Hidden-vs-Visible surface.
//
// i18n: the web binds six `tour.*` keys (dialogLabel, close, skip, prev, next, finish); each has a matching
// `translation_tour_*` entry in the P1/S10 catalog, bound by the view via `stringResource`. The step title +
// description are caller-supplied, already-localized DATA (not literals), exactly like the web `step.title` /
// `step.description`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/TourOverlay — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling RateLimitBanner / OnboardingWizard surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.touroverlay

import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.min

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no step index, copy, or
 * geometry — only this constant identifier — so a diagnostics line can never leak what the user is viewing.
 */
const val TOUR_OVERLAY_SLUG: String = "TourOverlay"

/** Spotlight cutout padding around the highlighted target, in dp (web `spotlightPadding = 6`). */
const val TOUR_SPOTLIGHT_PADDING_DP: Float = 6f

/** Gap between the target and the tooltip, in dp (web `gap = 16`). */
private const val TOOLTIP_GAP_DP: Float = 16f

/** Minimum margin between the tooltip and the viewport edges, in dp (web `pad = 16`). */
private const val TOOLTIP_EDGE_PADDING_DP: Float = 16f

/** Reserved height for the mobile bottom tab bar the tooltip must clear, in dp (web `bottomNav = 72`). */
private const val TOOLTIP_BOTTOM_NAV_DP: Float = 72f

/** Hard cap on the tooltip width, in dp (web `Math.min(360, …)`). */
private const val TOOLTIP_MAX_WIDTH_DP: Float = 360f

/**
 * Which side of the highlighted target the tooltip is anchored to — the native mirror of the web
 * `TourStep.placement` (`'top' | 'bottom' | 'left' | 'right'`).
 */
enum class TourPlacement { Top, Bottom, Left, Right }

/**
 * The render-relevant content of one tour step — the native mirror of the web `TourStep`. The web `target`
 * CSS selector and `onShow` / `onHide` callbacks are DOM-runtime concerns replaced on native by the measured
 * [TourTarget] the host supplies; only the [title], [description], and [placement] reach the view.
 *
 * @property title the already-localized step heading (caller-supplied data, web `step.title`).
 * @property description the already-localized step body (caller-supplied data, web `step.description`).
 * @property placement the side the tooltip anchors to (web `step.placement`).
 */
data class TourStepContent(
    val title: String,
    val description: String,
    val placement: TourPlacement,
)

/**
 * The measured bounds of the highlighted element, in dp — the native mirror of the web `DOMRect` the parent
 * passes as `targetRect`. A `null` target collapses the surface to [TourSurface.Hidden] (web `return null`).
 */
data class TourTarget(
    val leftDp: Float,
    val topDp: Float,
    val widthDp: Float,
    val heightDp: Float,
) {
    /** The target's right edge (web `rect.right`). */
    val rightDp: Float get() = leftDp + widthDp

    /** The target's bottom edge (web `rect.bottom`). */
    val bottomDp: Float get() = topDp + heightDp
}

/** The overlay container size in dp — the native mirror of the web `window.innerWidth / innerHeight`. */
data class TourViewport(
    val widthDp: Float,
    val heightDp: Float,
)

/** A measured tooltip size in dp, fed back from layout so the placement clamp is a pure function of it. */
data class TourSize(
    val widthDp: Float,
    val heightDp: Float,
)

/**
 * The padded spotlight rectangle around the target, in dp — the native mirror of the web `spotlight` object
 * (`{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad*2, height: rect.height + pad*2 }`).
 */
data class SpotlightBounds(
    val leftDp: Float,
    val topDp: Float,
    val widthDp: Float,
    val heightDp: Float,
)

/**
 * The resolved top-left anchor + max width of the tooltip, in dp — the native mirror of the CSS object the
 * web `getTooltipPosition` returns (converted to a single top-left offset the view applies via `offset`).
 */
data class TooltipPosition(
    val xDp: Float,
    val yDp: Float,
    val maxWidthDp: Float,
)

/** A progress dot's render state — the native mirror of the web `i === currentStep` active-dot branch. */
enum class TourDotState { Active, Inactive }

/**
 * Pad the [target] into the spotlight cutout — the native mirror of the web `spotlight` math. A negative
 * [paddingDp] is clamped to zero so the cutout never shrinks below the target.
 */
fun spotlightBounds(
    target: TourTarget,
    paddingDp: Float = TOUR_SPOTLIGHT_PADDING_DP,
): SpotlightBounds {
    val safePadding = paddingDp.coerceAtLeast(0f)
    return SpotlightBounds(
        leftDp = target.leftDp - safePadding,
        topDp = target.topDp - safePadding,
        widthDp = target.widthDp + safePadding * 2f,
        heightDp = target.heightDp + safePadding * 2f,
    )
}

/**
 * The clamped tooltip width for a [viewportWidthDp] — the native mirror of the web
 * `maxW = Math.min(360, vw - pad * 2)`. Saturates at zero so a pathologically narrow viewport never yields a
 * negative width.
 */
fun tooltipMaxWidthDp(viewportWidthDp: Float): Float =
    min(TOOLTIP_MAX_WIDTH_DP, viewportWidthDp - TOOLTIP_EDGE_PADDING_DP * 2f).coerceAtLeast(0f)

/**
 * Resolve the tooltip's on-screen top-left anchor for a [placement] — the native mirror of the web
 * `getTooltipPosition` switch, expressed as a single top-left offset (the web CSS anchors `top`/`bottom`/
 * `left`/`right` are folded into one coordinate using the measured [tooltip] size). Both axes are clamped to
 * keep the tooltip inside the [viewport] edges and clear of the bottom tab bar, exactly like the web
 * `clampLeft` / `clampTop`.
 */
fun tooltipPosition(
    placement: TourPlacement,
    target: TourTarget,
    viewport: TourViewport,
    tooltip: TourSize,
): TooltipPosition {
    val maxW = tooltipMaxWidthDp(viewport.widthDp)
    val gap = TOOLTIP_GAP_DP
    val pad = TOOLTIP_EDGE_PADDING_DP
    val leftCeil = maxOf(pad, viewport.widthDp - maxW - pad)
    val topCeil = maxOf(pad, viewport.heightDp - TOOLTIP_BOTTOM_NAV_DP - tooltip.heightDp)
    val clampLeft = { x: Float -> x.coerceIn(pad, leftCeil) }
    val clampTop = { y: Float -> y.coerceIn(pad, topCeil) }
    val (x, y) =
        when (placement) {
            TourPlacement.Bottom -> clampLeft(target.leftDp) to clampTop(target.bottomDp + gap)
            TourPlacement.Top -> clampLeft(target.leftDp) to clampTop(target.topDp - gap - tooltip.heightDp)
            TourPlacement.Right -> clampLeft(target.rightDp + gap) to clampTop(target.topDp)
            TourPlacement.Left -> clampLeft(target.leftDp - gap - tooltip.widthDp) to clampTop(target.topDp)
        }
    return TooltipPosition(xDp = x, yDp = y, maxWidthDp = maxW)
}

/** Whether the cursor is on the first step — the web gate that hides "Back" (`currentStep > 0`). */
fun isFirstStep(currentStep: Int): Boolean = currentStep <= 0

/** Whether the cursor is on the final step — the web `currentStep === totalSteps - 1` finish branch. */
fun isLastStep(
    currentStep: Int,
    totalSteps: Int,
): Boolean = currentStep >= totalSteps - 1

/** Whether the "Back" affordance is shown — the web `currentStep > 0 && (…)`. */
fun showBackAffordance(currentStep: Int): Boolean = currentStep > 0

/** Whether the forward arrow trails the advance button — the web `currentStep < totalSteps - 1`. */
fun showForwardArrow(
    currentStep: Int,
    totalSteps: Int,
): Boolean = currentStep < totalSteps - 1

/** The one-based step number for the visible counter — the web `currentStep + 1`. */
fun stepNumber(currentStep: Int): Int = currentStep + 1

/** The render state of the progress dot at [index] — active only on the current step (web `i === currentStep`). */
fun dotStateFor(
    index: Int,
    currentStep: Int,
): TourDotState = if (index == currentStep) TourDotState.Active else TourDotState.Inactive

/**
 * Build the merged TalkBack announcement for a step from its already-localized [title] + [description] (the
 * view resolves both via the i18n facade). Kept pure so label presence is unit-tested without a Compose host;
 * blank parts are dropped and the rest joined into one sentence so the step reads as a single coherent unit.
 */
fun tourAccessibilityLabel(
    title: String,
    description: String,
): String =
    listOf(title, description)
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .joinToString(separator = ". ")

/**
 * Clamp [currentStep] into the valid `[0, totalSteps)` range — the guard the web cursor never needs (its
 * buttons can't run off the ends) but a controlled native cursor must, so a stale index can never index out
 * of bounds. A non-positive [totalSteps] collapses to `0`.
 */
fun clampStep(
    currentStep: Int,
    totalSteps: Int,
): Int = if (totalSteps <= 0) 0 else currentStep.coerceIn(0, totalSteps - 1)

/**
 * The render-ready classification of the overlay — a closed set of mutually-exclusive surfaces the view
 * switches on, so every branch is exhaustively covered and unit-tested off-device.
 */
sealed interface TourSurface {
    /** `targetRect == null` → the overlay renders nothing (web returns `null`). */
    data object Hidden : TourSurface

    /**
     * `targetRect != null` → the overlay is shown. Carries everything the render layer needs except the live
     * tooltip anchor (which depends on the viewport + measured tooltip size, resolved at render by
     * [tooltipPosition]): the active [step], the [target] + padded [spotlight], the clamped cursor, and the
     * reduced navigation branches.
     */
    data class Visible(
        val step: TourStepContent,
        val target: TourTarget,
        val spotlight: SpotlightBounds,
        val currentStep: Int,
        val totalSteps: Int,
        val stepNumber: Int,
        val isLast: Boolean,
        val showBack: Boolean,
        val showForwardArrow: Boolean,
    ) : TourSurface
}

/**
 * Select the render-ready [TourSurface] from the controlled props. Pure (no Compose). A `null` [target]
 * collapses to [TourSurface.Hidden] (web `null`); otherwise the cursor is clamped (`totalSteps` floored at 1)
 * and the navigation branches are reduced into [TourSurface.Visible] so the view never re-derives them.
 */
fun classifyTour(
    target: TourTarget?,
    step: TourStepContent,
    currentStep: Int,
    totalSteps: Int,
): TourSurface {
    if (target == null) return TourSurface.Hidden
    val safeTotal = totalSteps.coerceAtLeast(1)
    val clamped = clampStep(currentStep, safeTotal)
    return TourSurface.Visible(
        step = step,
        target = target,
        spotlight = spotlightBounds(target),
        currentStep = clamped,
        totalSteps = safeTotal,
        stepNumber = stepNumber(clamped),
        isLast = isLastStep(clamped, safeTotal),
        showBack = showBackAffordance(clamped),
        showForwardArrow = showForwardArrow(clamped, safeTotal),
    )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the step
 * index, copy, or geometry — so a diagnostics line can never leak what the user is viewing.
 */
object TourOverlayDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = TOUR_OVERLAY_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
