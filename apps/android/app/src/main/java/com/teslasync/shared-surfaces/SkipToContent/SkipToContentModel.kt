// Pure, framework-free model + projection + diagnostics for the SkipToContent shared surface — the native
// analogue of web/src/components/feedback/SkipToContent.tsx. No Compose, no Android framework, no HTTP: every
// declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web source is an ACCESSIBILITY AFFORDANCE (WCAG 2.4.1, Bypass Blocks), not a data-fetching view: it
// composes `<VisuallyHidden as="a" focusable>` with the localized label `t('a11y.skipToContent')`, sits
// visually hidden until it gains keyboard focus, and on activation moves focus + scroll to the page's
// `<main id="main-content">` landmark so a keyboard user skips the 50-plus-item sidebar. Its only bound hook
// is `useTranslation`; it fetches nothing.
//
// Because the surface has no async cache-then-network feed, there is no loading / empty / error / stale /
// offline lifecycle to render; modelling those would fabricate behaviour the web source does not have (the
// same rationale the accepted RouteAnnouncer / VisuallyHidden a11y ports document). The surface's real states
// are reproduced instead: the resting [SkipLinkMode.Hidden] sr-only link, the focus-revealed
// [SkipLinkMode.Revealed] chip (web `focus:not-sr-only`), and the two activation outcomes — a landmark was
// present and focus moved ([SkipOutcome.Moved], web `if (main) …`) or none was registered so activation is a
// no-op ([SkipOutcome.NoTarget], web's implicit else). The single rendered string resolves through the i18n
// catalog (P1/S10) at the render boundary, so no English literal lives in native code.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/SkipToContent — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.skiptocontent

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the SkipToContent surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`SkipToContent`); the
 * [LABEL_KEY] pins the web source's i18n key so the native catalog entry stays in lockstep.
 */
object SkipToContentRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "skip-to-content"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SkipToContent"

    /** The web source's i18n key for the visible label (`t('a11y.skipToContent', 'Skip to main content')`). */
    const val LABEL_KEY: String = "a11y.skipToContent"
}

/**
 * The mutually-exclusive render modes the skip link draws — the native tag for the web `sr-only` ↔
 * `focus:not-sr-only` transition. [Hidden] is the resting state: a layout-negligible node that is invisible to
 * sighted users but present (and labelled) in the accessibility tree. [Revealed] is the focused state: a
 * high-contrast chip carrying the label, the native analogue of the web link's visible-on-focus styling.
 */
enum class SkipLinkMode {
    /** Resting state — visually hidden, still exposed to assistive technologies (web `sr-only`). */
    Hidden,

    /** Focused state — the visible high-contrast chip (web `focus:not-sr-only`). */
    Revealed,
}

/**
 * Maps the node's keyboard/focus state onto its [SkipLinkMode] — the native mirror of the web link revealing
 * itself only while focused. Pure so the reveal contract is unit-tested off-device without a UI host.
 */
fun skipLinkMode(focused: Boolean): SkipLinkMode = if (focused) SkipLinkMode.Revealed else SkipLinkMode.Hidden

/**
 * The result of activating the skip link — the native mirror of the web `onClick` guard. [Moved] is the
 * `if (main)` branch: a main-content landmark was registered, so focus (and the focus-driven bring-into-view
 * that reproduces the web `scrollIntoView`) moved to it. [NoTarget] is the implicit web else: no landmark was
 * registered, so activation is a safe no-op rather than a crash.
 */
enum class SkipOutcome(
    val wireName: String,
) {
    /** A main-content landmark was present and focus moved to it (web `if (main) { main.focus() … }`). */
    Moved("moved"),

    /** No landmark was registered, so activation did nothing (web `getElementById` returning `null`). */
    NoTarget("noTarget"),
}

/**
 * Folds whether a main-content landmark was reached into the [SkipOutcome] — the native mirror of the web
 * `if (main)` guard. Pure so the activation contract is unit-tested without a Compose focus host.
 */
fun skipOutcome(targetPresent: Boolean): SkipOutcome = if (targetPresent) SkipOutcome.Moved else SkipOutcome.NoTarget

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever the user activates the skip link. */
const val EVENT_SKIP_ACTIVATED: String = "skipToContent.activate"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/** The structured-field key carrying the activation outcome (never any page content). */
const val FIELD_OUTCOME: String = "outcome"

/**
 * PII-safe diagnostics for the SkipToContent surface (P1/S11). Every record carries only the surface
 * [SkipToContentRegistration.SLUG] and, for an activation, the coarse [SkipOutcome] — never a label, route, or
 * any page content, so a diagnostics line can never leak what a user navigated to. Kept free of Compose so it
 * is unit-tested with a recording [Logger].
 */
object SkipToContentDiagnostics {
    /** Emits the one `view.opened` record (slug only) — the ViewModel calls it once per surface open. */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SkipToContentRegistration.SLUG))
    }

    /** Emits the `skipToContent.activate` record carrying the surface slug and the coarse [outcome] only. */
    fun recordSkip(
        logger: Logger,
        outcome: SkipOutcome,
    ) {
        logger.info(
            EVENT_SKIP_ACTIVATED,
            mapOf(FIELD_SURFACE to SkipToContentRegistration.SLUG, FIELD_OUTCOME to outcome.wireName),
        )
    }
}
