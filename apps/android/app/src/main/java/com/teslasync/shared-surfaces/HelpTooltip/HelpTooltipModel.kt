// Pure, framework-free model + projection + diagnostics for the HelpTooltip shared surface — the native
// analogue of web/src/components/ui/HelpTooltip.tsx. No Compose, no Android framework, no HTTP: every
// declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer (ADR-002).
//
// The web source is a PRESENTATIONAL leaf, not a data-fetching view: its only bound hook is `useTranslation`
// and it fetches nothing. It renders a compact "?" trigger that, on hover / focus / tap, reveals an
// explanatory tooltip carrying the resolved body copy and an optional "Learn more" link that opens in a new
// tab. Because the surface has no async cache-then-network feed, there is no loading / empty / error / stale /
// offline lifecycle to invent; modelling those would fabricate behaviour the web spec does not have (the same
// rationale the accepted HelpSegment / CopyLinkButton / GuardedLink / VisuallyHidden ports document, covenant
// #2 / #9). The surface's REAL states are reproduced instead and modelled here as pure, testable declarations:
//   • content ABSENT — `i18nKey ? t(i18nKey, {defaultValue}) : text` resolves to empty, so the web returns
//     `null` and renders nothing ([hasHelpContent] false); the native surface renders nothing too;
//   • content PRESENT, no link — just the resolved body;
//   • content PRESENT + "Learn more" — the body plus the external link;
//   • the trigger [HelpTooltipSize] (xs / sm / md, web `SIZE_CLASS`) and [HelpTooltipPlacement]
//     (top / bottom / left / right, web `placement`) variants;
//   • the link-open [LinkOutcome] — the platform opened the URL or rejected it (the native analogue of a web
//     new-tab navigation succeeding or being blocked).
// Every rendered string resolves through the i18n catalog (P1/S10) at the render boundary via the web
// `t(key, default)` contract, so no un-internationalized literal lives in native code — the [ICON_LABEL_KEY] /
// [LEARN_MORE_KEY] keys + their fallbacks below are the web source's own keys and i18next default values.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/HelpTooltip — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helptooltip

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the HelpTooltip surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`HelpTooltip`); [ID] is
 * the stable `viewModel` key the composable binds its state holder with, and the test tags name the trigger
 * and "Learn more" nodes the UI test drives.
 */
object HelpTooltipRegistration {
    /** Stable surface id, also the `viewModel` key the composable binds its holder with. */
    const val ID: String = "help-tooltip"

    /** Diagnostics surface slug emitted with the `view.opened` / `helpTooltip.learnMore` events (P1/S11). */
    const val SLUG: String = "HelpTooltip"

    /** Test tag for the "?" trigger node, present in every render state that shows content. */
    const val TRIGGER_TEST_TAG: String = "help-tooltip-trigger"

    /** Test tag for the optional "Learn more" affordance inside the tooltip. */
    const val LEARN_MORE_TEST_TAG: String = "help-tooltip-learn-more"
}

/** The web `t('help.tooltip.iconLabel', 'More info')` key — the trigger's default accessible name. */
const val ICON_LABEL_KEY: String = "help.tooltip.iconLabel"

/** The i18next default for [ICON_LABEL_KEY] (the web source's inline fallback). */
const val ICON_LABEL_FALLBACK: String = "More info"

/** The web `t('common.learnMore', 'Learn more')` key — the default "Learn more" link label. */
const val LEARN_MORE_KEY: String = "common.learnMore"

/** The i18next default for [LEARN_MORE_KEY] (the web source's inline fallback). */
const val LEARN_MORE_FALLBACK: String = "Learn more"

/**
 * The optional "Learn more" affordance shown below the tooltip body — the native analogue of the web
 * `learnMore: { url: string; label?: string }` prop. [url] is opened externally through the [LinkOpener] seam
 * (web `<a target="_blank">`); [label] overrides the default `t('common.learnMore')` link text when supplied.
 * A pure data holder so it can be constructed and asserted off-device.
 *
 * @property url the external link opened on tap (web `learnMore.url`).
 * @property label the optional link label; falls back to [LEARN_MORE_FALLBACK] / the catalog when `null`.
 */
data class HelpTooltipLearnMore(
    val url: String,
    val label: String? = null,
)

/**
 * The trigger icon size — the native tag for the web `size` prop and its `SIZE_CLASS` map. Each carries the
 * web pixel dimension as [iconDp] (web xs = `h-3 w-3` = 12, sm = `h-3.5` = 14, md = `h-4` = 16) so the
 * composable maps it onto the shared `IconSize` and the dimension is unit-tested off-device.
 *
 * @property iconDp the trigger glyph edge length in dp, mirroring the web Tailwind size class.
 */
enum class HelpTooltipSize(
    val iconDp: Int,
) {
    /** Web `size="xs"` → `h-3 w-3` (12 dp). */
    Xs(12),

    /** Web `size="sm"` → `h-3.5 w-3.5` (14 dp) — the web default. */
    Sm(14),

    /** Web `size="md"` → `h-4 w-4` (16 dp). */
    Md(16),
}

/**
 * Where the tooltip is placed relative to the trigger — the native tag for the web `placement` prop (passed
 * to the shared `Tooltip` as `side`). All four sides are honoured by the surface's position provider via the
 * pure [helpTooltipPopupOffset] geometry below.
 */
enum class HelpTooltipPlacement {
    /** Above the trigger — the web default. */
    Top,

    /** Below the trigger. */
    Bottom,

    /** To the (physical) left of the trigger; swaps with [Right] under RTL. */
    Left,

    /** To the (physical) right of the trigger; swaps with [Left] under RTL. */
    Right,
}

/**
 * Resolves the requested [placement] to the physical side actually used, swapping [HelpTooltipPlacement.Left]
 * and [HelpTooltipPlacement.Right] under [isRtl] so a "left"/"right" tooltip stays on the reading-order side —
 * the standard Compose layout-direction convention. [HelpTooltipPlacement.Top] / [HelpTooltipPlacement.Bottom]
 * are unaffected. Pure so the mirroring is unit-tested without a UI host.
 */
fun resolvePhysicalPlacement(
    placement: HelpTooltipPlacement,
    isRtl: Boolean,
): HelpTooltipPlacement =
    when (placement) {
        HelpTooltipPlacement.Left -> if (isRtl) HelpTooltipPlacement.Right else HelpTooltipPlacement.Left
        HelpTooltipPlacement.Right -> if (isRtl) HelpTooltipPlacement.Left else HelpTooltipPlacement.Right
        else -> placement
    }

/**
 * The web content-resolution precedence — `const resolved = i18nKey ? t(i18nKey, {defaultValue}) : text`.
 * When an [i18nKey] is supplied the body is the [catalogValue] the composable resolved from the P1/S10 catalog
 * (or `null` when the key is catalog-absent), falling back to [defaultValue]; otherwise it is the literal
 * [text]. A `null` input collapses to the empty string, exactly as the web `?? ''` / `text ?? ''` do. Pure so
 * the precedence is unit-tested off-device, free of the catalog lookup.
 */
fun resolveHelpBody(
    text: String?,
    i18nKey: String?,
    defaultValue: String?,
    catalogValue: String?,
): String =
    if (i18nKey != null) {
        catalogValue ?: defaultValue ?: ""
    } else {
        text ?: ""
    }

/**
 * Whether there is body content to render — the native mirror of the web `if (!resolved) return null`. Uses
 * `isNotEmpty` (not `isNotBlank`) to match JavaScript truthiness, where an empty string is falsy but a
 * whitespace-only string is truthy. When this is false the surface renders nothing.
 */
fun hasHelpContent(resolved: String): Boolean = resolved.isNotEmpty()

/**
 * The visible "Learn more" link label — the web `learnMore.label ?? t('common.learnMore', 'Learn more')`. A
 * supplied [custom] label wins (matching the `??` null-coalesce, so only a missing label falls back); otherwise
 * the catalog-resolved [fallback] is used. Pure so the choice is unit-tested off-device.
 */
fun resolveLearnMoreLabel(
    custom: String?,
    fallback: String,
): String = custom ?: fallback

/**
 * A framework-free 2-D integer offset (top-left of the tooltip popup). The composable maps it onto a Compose
 * `IntOffset`; kept Compose-free so the placement geometry is unit-tested off-device.
 */
data class HelpTooltipOffset(
    val x: Int,
    val y: Int,
)

/**
 * Computes the tooltip popup's top-left position for [placement] relative to the trigger — the pure geometry
 * behind the surface's custom position provider, so all four web placements (not just Material's default
 * above/below) are honoured and unit-tested off-device.
 *
 * The popup is centred on the trigger's cross axis and offset by [gap] px on the main axis, then clamped into
 * the `[0, windowSize - popupSize]` window box so it can never spill off-screen. [isRtl] mirrors left/right via
 * [resolvePhysicalPlacement]. All inputs are integer pixels (the composable supplies the anchor bounds, popup
 * content size, and window size from the Material `TooltipBox` position-provider callback).
 */
@Suppress("LongParameterList")
fun helpTooltipPopupOffset(
    placement: HelpTooltipPlacement,
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
): HelpTooltipOffset {
    val side = resolvePhysicalPlacement(placement, isRtl)
    val anchorRight = anchorLeft + anchorWidth
    val anchorBottom = anchorTop + anchorHeight
    val centerX = anchorLeft + anchorWidth / 2
    val centerY = anchorTop + anchorHeight / 2

    val rawX: Int
    val rawY: Int
    when (side) {
        HelpTooltipPlacement.Top -> {
            rawX = centerX - popupWidth / 2
            rawY = anchorTop - popupHeight - gap
        }
        HelpTooltipPlacement.Bottom -> {
            rawX = centerX - popupWidth / 2
            rawY = anchorBottom + gap
        }
        HelpTooltipPlacement.Left -> {
            rawX = anchorLeft - popupWidth - gap
            rawY = centerY - popupHeight / 2
        }
        HelpTooltipPlacement.Right -> {
            rawX = anchorRight + gap
            rawY = centerY - popupHeight / 2
        }
    }

    val maxX = (windowWidth - popupWidth).coerceAtLeast(0)
    val maxY = (windowHeight - popupHeight).coerceAtLeast(0)
    return HelpTooltipOffset(rawX.coerceIn(0, maxX), rawY.coerceIn(0, maxY))
}

/**
 * The resolved outcome of opening the "Learn more" link — emitted (PII-free) as a diagnostics field so a link
 * open can be observed without ever recording the URL (which can carry deep-link state). [Opened] is the
 * platform accepting the new-tab navigation; [Failed] is it rejecting it (no browser / activity).
 */
enum class LinkOutcome(
    val wireName: String,
) {
    /** The platform opened the link (web: the new tab launched). */
    Opened("opened"),

    /** The platform rejected the open (web: the navigation was blocked / no handler). */
    Failed("failed"),
}

/** Maps a link-open result onto its diagnostics [LinkOutcome]. */
fun linkOutcomeFor(succeeded: Boolean): LinkOutcome = if (succeeded) LinkOutcome.Opened else LinkOutcome.Failed

/** The stable, dot-namespaced diagnostics event emitted once when the surface is first composed (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever the "Learn more" link is opened. */
const val EVENT_LEARN_MORE: String = "helpTooltip.learnMore"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/** The structured-field key carrying the link-open outcome (never the opened URL). */
const val FIELD_OUTCOME: String = "outcome"

/**
 * PII-safe diagnostics for the HelpTooltip surface (P1/S11). Every record carries only the surface
 * [HelpTooltipRegistration.SLUG] and, for a link open, the coarse [LinkOutcome] — never the body copy, the
 * label, or the opened URL, so a diagnostics line can never leak help copy or where a user navigated. Kept
 * free of Compose so it is unit-tested with a recording [Logger].
 */
object HelpTooltipDiagnostics {
    /** Emits the one `view.opened` record (slug only) — the ViewModel calls it once per surface open. */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to HelpTooltipRegistration.SLUG))
    }

    /** Emits the `helpTooltip.learnMore` record carrying the surface slug and the coarse [outcome] only. */
    fun recordLearnMore(
        logger: Logger,
        outcome: LinkOutcome,
    ) {
        logger.info(
            EVENT_LEARN_MORE,
            mapOf(
                FIELD_SURFACE to HelpTooltipRegistration.SLUG,
                FIELD_OUTCOME to outcome.wireName,
            ),
        )
    }
}
