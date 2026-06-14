// Pure, framework-free model + projection + diagnostics for the Tooltip shared surface — the native
// analogue of web/src/components/ui/Tooltip.tsx. No Compose, no Android framework, no HTTP: every
// declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer (ADR-002).
//
// The web source is a PRESENTATIONAL wrapper, not a data-fetching view: its only bound hook is `useId`
// (a stable, render-invariant id minted once and added to the trigger's `aria-describedby`) and it fetches
// nothing. It wraps an arbitrary trigger (`children`) and reveals an inverted-surface tooltip body carrying
// `content` on hover OR focus-within OR tap, placed on one of four `side`s, wrapping onto multiple lines when
// `multiline` is set. Because the surface has no async cache-then-network feed, there is no
// loading / empty / error / stale / offline lifecycle to invent; modelling those would fabricate behaviour
// the web spec does not have (the same rationale the accepted HelpTooltip / PillFilterBar / VisuallyHidden
// ports document — covenant #2 / #9). The surface's REAL states are reproduced instead and modelled here as
// pure, testable declarations:
//   • [TooltipReveal] HIDDEN (web `opacity-0 scale-95`, the resting state) ↔ REVEALED (web
//     `group-hover/group-focus-within` → `opacity-100 scale-100`), derived from the hover / focus / tap
//     inputs by [tooltipRevealFor];
//   • the four [TooltipSide]s (web `side`), placed by the pure [tooltipPopupOffset] geometry, RTL-mirrored
//     by [resolvePhysicalSide];
//   • the single-line vs wrapping body (web `whitespace-nowrap` vs `whitespace-normal max-w-[260px]`) via
//     [tooltipWraps] / [tooltipMaxLines] / [tooltipMaxWidthDp];
//   • the reduced-motion reveal (web `motion-reduce:transition-none`) via [tooltipRevealMillis];
//   • the `aria-describedby` join (web `[existing, id].filter(Boolean).join(' ')`) via [joinAriaDescribedBy].
// The web source renders no static copy of its own — its `content` is caller-supplied — so the surface carries
// no i18n keys; there is none to map, and none is invented.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/Tooltip — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tooltip

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the Tooltip surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`Tooltip`); [ID] is the stable
 * `viewModel` key the composable binds its state holder with, and the test tags name the trigger and tooltip
 * body nodes the UI test drives.
 */
object TooltipRegistration {
    /** Stable surface id, also the `viewModel` key the composable binds its holder with. */
    const val ID: String = "tooltip"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "Tooltip"

    /** Test tag for the trigger wrapper node — present in every render state. */
    const val TRIGGER_TEST_TAG: String = "tooltip-trigger"

    /** Test tag for the revealed tooltip body (web `role="tooltip"` span). */
    const val TOOLTIP_TEST_TAG: String = "tooltip-body"
}

/**
 * Where the tooltip is placed relative to the trigger — the native tag for the web `side` prop
 * (`'top' | 'bottom' | 'left' | 'right'`, default `'top'`). All four sides are honoured by the surface's
 * position provider via the pure [tooltipPopupOffset] geometry below.
 */
enum class TooltipSide {
    /** Above the trigger — the web default (`side="top"`). */
    Top,

    /** Below the trigger (`side="bottom"`). */
    Bottom,

    /** To the (physical) left of the trigger; swaps with [Right] under RTL. */
    Left,

    /** To the (physical) right of the trigger; swaps with [Left] under RTL. */
    Right,
}

/**
 * Resolves the requested [side] to the physical side actually used, swapping [TooltipSide.Left] and
 * [TooltipSide.Right] under [isRtl] so a "left"/"right" tooltip stays on the reading-order side — the standard
 * Compose layout-direction convention. [TooltipSide.Top] / [TooltipSide.Bottom] are unaffected. Pure so the
 * mirroring is unit-tested without a UI host.
 */
fun resolvePhysicalSide(
    side: TooltipSide,
    isRtl: Boolean,
): TooltipSide =
    when (side) {
        TooltipSide.Left -> if (isRtl) TooltipSide.Right else TooltipSide.Left
        TooltipSide.Right -> if (isRtl) TooltipSide.Left else TooltipSide.Right
        else -> side
    }

/**
 * The tooltip's visibility — the native tag for the web visibility contract. [Hidden] is the resting state
 * (web `opacity-0 scale-95`, the tooltip in the tree but invisible); [Revealed] is the active state (web
 * `group-hover/tip:opacity-100 group-hover/tip:scale-100` + `group-focus-within/tip:...`). The render boundary
 * maps this onto an actual show / hide of the popup.
 */
enum class TooltipReveal {
    /** Resting — the tooltip is not shown (web `opacity-0 scale-95`). */
    Hidden,

    /** Active — the tooltip is shown (web `opacity-100 scale-100`). */
    Revealed,
}

/**
 * Derives the [TooltipReveal] from the three reveal inputs — the native mirror of the web reveal contract,
 * which shows the tooltip on `:hover` OR `:focus-within` OR (on touch, via a focusable trigger) tap. Any one
 * input being active reveals the tooltip; all three idle keep it hidden. Pure so the boolean fold is
 * unit-tested off-device.
 *
 * @param hovered a pointer is over the trigger (web `:hover`).
 * @param focused the trigger or a descendant has focus (web `:focus-within`).
 * @param pressed the trigger was tapped / long-pressed to reveal on a touch device (web focus-on-tap).
 */
fun tooltipRevealFor(
    hovered: Boolean,
    focused: Boolean,
    pressed: Boolean,
): TooltipReveal = if (hovered || focused || pressed) TooltipReveal.Revealed else TooltipReveal.Hidden

/**
 * A framework-free 2-D integer offset (top-left of the tooltip popup). The composable maps it onto a Compose
 * `IntOffset`; kept Compose-free so the placement geometry is unit-tested off-device.
 */
data class TooltipOffset(
    val x: Int,
    val y: Int,
)

/**
 * Computes the tooltip popup's top-left position for [side] relative to the trigger — the pure geometry behind
 * the surface's custom position provider, so all four web sides are honoured and unit-tested off-device.
 *
 * The popup is centred on the trigger's cross axis and offset by [gap] px on the main axis, then clamped into
 * the `[0, windowSize - popupSize]` window box so it can never spill off-screen. [isRtl] mirrors left/right via
 * [resolvePhysicalSide]. All inputs are integer pixels (the composable supplies the anchor bounds, popup
 * content size, and window size from the popup position-provider callback).
 */
@Suppress("LongParameterList")
fun tooltipPopupOffset(
    side: TooltipSide,
    anchorLeft: Int,
    anchorTop: Int,
    anchorWidth: Int,
    anchorHeight: Int,
    popupWidth: Int,
    popupHeight: Int,
    windowWidth: Int,
    windowHeight: Int,
    gap: Int,
    isRtl: Boolean,
): TooltipOffset {
    val physical = resolvePhysicalSide(side, isRtl)
    val anchorRight = anchorLeft + anchorWidth
    val anchorBottom = anchorTop + anchorHeight
    val centerX = anchorLeft + anchorWidth / 2
    val centerY = anchorTop + anchorHeight / 2

    val rawX: Int
    val rawY: Int
    when (physical) {
        TooltipSide.Top -> {
            rawX = centerX - popupWidth / 2
            rawY = anchorTop - popupHeight - gap
        }
        TooltipSide.Bottom -> {
            rawX = centerX - popupWidth / 2
            rawY = anchorBottom + gap
        }
        TooltipSide.Left -> {
            rawX = anchorLeft - popupWidth - gap
            rawY = centerY - popupHeight / 2
        }
        TooltipSide.Right -> {
            rawX = anchorRight + gap
            rawY = centerY - popupHeight / 2
        }
    }

    val maxX = (windowWidth - popupWidth).coerceAtLeast(0)
    val maxY = (windowHeight - popupHeight).coerceAtLeast(0)
    return TooltipOffset(rawX.coerceIn(0, maxX), rawY.coerceIn(0, maxY))
}

/** The wrapping body's maximum width in dp — the native mirror of the web `max-w-[260px]`. */
const val TOOLTIP_MAX_WIDTH_DP: Int = 260

/**
 * The tooltip body's maximum width in dp, or `null` when it is unconstrained — the web `multiline ?
 * max-w-[260px] : (none)`. A single-line tooltip (web `whitespace-nowrap`) has no width cap; a multiline one
 * is capped at [TOOLTIP_MAX_WIDTH_DP] so long help copy wraps instead of stretching across the screen.
 */
fun tooltipMaxWidthDp(multiline: Boolean): Int? = if (multiline) TOOLTIP_MAX_WIDTH_DP else null

/**
 * Whether the body wraps onto multiple lines — the web `multiline ? whitespace-normal : whitespace-nowrap`.
 */
fun tooltipWraps(multiline: Boolean): Boolean = multiline

/**
 * The maximum number of lines the body renders — the native realisation of the web wrap contract: a single
 * line when not [multiline] (web `whitespace-nowrap`, which never wraps), unbounded when it is.
 */
fun tooltipMaxLines(multiline: Boolean): Int = if (multiline) Int.MAX_VALUE else 1

/**
 * Joins the trigger's existing `aria-describedby` value with the tooltip's id — the native mirror of the web
 * `[existing, tooltipId].filter(Boolean).join(' ')`. A `null` / blank [existing] is dropped (web `filter`
 * removes falsy values) so the result is just [tooltipId]; a present [existing] is preserved and the tooltip
 * id appended, so a screen reader announces the trigger's own description first and the tooltip after. Pure so
 * the join is unit-tested off-device.
 */
fun joinAriaDescribedBy(
    existing: String?,
    tooltipId: String,
): String =
    listOf(existing, tooltipId)
        .filterNotNull()
        .filter { it.isNotBlank() }
        .joinToString(separator = " ")

/**
 * The reveal animation duration in milliseconds, collapsed to 0 under reduced motion — the web reveal uses
 * `transition-all duration-fast`, disabled by `motion-reduce:transition-none`. [baseMs] is the requested
 * duration (the composable passes the `MotionDurations.fast` token); a negative request is folded to 0 so the
 * function is total. Pure so the reduced-motion branch is unit-tested off-device.
 */
fun tooltipRevealMillis(
    reduceMotion: Boolean,
    baseMs: Int,
): Int = if (reduceMotion) 0 else baseMs.coerceAtLeast(0)

/** The stable, dot-namespaced diagnostics event emitted once when the surface is first composed (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [TooltipRegistration.SLUG]
 * (P1/S11) — never the tooltip content or the trigger label, so a diagnostics line can never leak help copy.
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per surface
 * open.
 */
fun recordTooltipOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to TooltipRegistration.SLUG))
}
