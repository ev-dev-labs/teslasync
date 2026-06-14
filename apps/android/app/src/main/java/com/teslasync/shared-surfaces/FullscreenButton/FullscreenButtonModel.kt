// Pure, framework-free model + diagnostics for the FullscreenButton shared surface — the native analogue of
// every decision the web component makes (web/src/components/ui/FullscreenButton.tsx) before it paints its
// icon-button. No Compose, no Android framework, no coroutines: every declaration here is exercised off-device
// in the :android:testReleaseUnitTest gate, so the composable stays a thin render layer (ADR-002).
//
// The web source is a single ghost icon-button that toggles the browser Fullscreen API on a target element.
// Its bound data source is `useTranslation` only (resolved at the render boundary through the P1/S10 catalog);
// it fetches nothing. The three things the web component actually derives — and therefore the COMPLETE branch
// set this surface reproduces — are:
//   • `supported`  — `document.fullscreenEnabled` (web `if (!supported) return null`). On Android the host
//                    window can always toggle immersive mode, so the bound controller reports supported; the
//                    seam still carries the flag so the hidden branch is faithfully reachable (a window-less
//                    context reports unsupported, exactly as iOS-Safari / a sandboxed iframe does on web).
//   • `isFs`       — synced from the `fullscreenchange` event, NOT the click handler, so the icon stays honest
//                    when the user exits via the system (web Esc / tab-switch ↔ Android show-bars / reconfig).
//   • the label    — `isFs ? exitLabel : enterLabel`, the same string driving `aria-label` + `title`.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent
// (Honesty Covenant #9 — documented, not silent): this surface fetches nothing. It is an imperative toggle
// over a platform capability, not an async cache-then-network feed, so there is no query to be loading, to be
// empty, to go stale, or to be offline; modelling those would fabricate behaviour the web spec does not have
// (the same rationale the accepted Checkbox / CopyLinkButton / VisuallyHidden ports document). The owning
// screen that DOES fetch renders its own data surface and drops this button into its toolbar. The surface's
// REAL, fully-reproduced states are the ones below: hidden (unsupported), enter (not fullscreen → the Enter
// glyph + enter label) and exit (fullscreen → the Exit glyph + exit label), each reduced here by a pure
// function and asserted off-device, doubling as the per-state snapshot.
//
// Parity-with-honesty for `aria-pressed` (web flips `aria-label`, `title`, AND `aria-pressed` together): the
// native idiom is the flipping `contentDescription` ("Enter fullscreen" ↔ "Exit fullscreen") the sibling
// component-library FullscreenButton atom uses, which conveys the same enter/exit state transition to
// TalkBack; the toggle state is additionally exposed programmatically via [fullscreenStateToken] (the native
// analogue of the web `data-fullscreen-state` test seam) — a documented mapping, not a silent drift.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/FullscreenButton — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling CopyLinkButton / Checkbox surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.fullscreenbutton

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` / `fullscreen.toggle` events (P1/S11). Carries no
 * VIN, vehicle id, route, or any user payload — only this constant identifier — so a diagnostics line can
 * never leak the operator's state.
 */
const val FULLSCREEN_BUTTON_SLUG: String = "FullscreenButton"

/**
 * Canonical registry metadata for the FullscreenButton surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`FullscreenButton`);
 * [ID] is the `viewModel` key the composable binds its state holder with, and [ROOT_TEST_TAG] names the node
 * the on-device UI test drives.
 */
object FullscreenButtonRegistration {
    /** Stable surface id (kebab-case), also the `viewModel` key the composable binds its holder with. */
    const val ID: String = "fullscreen-button"

    /** Diagnostics surface slug emitted with the `view.opened` / toggle events (P1/S11). */
    const val SLUG: String = FULLSCREEN_BUTTON_SLUG

    /** Test tag for the clickable button node, present in every render state in which the button shows. */
    const val ROOT_TEST_TAG: String = "fullscreen-button"
}

/**
 * The render state of the button — the native analogue of the web `const [supported]` + `const [isFs]`.
 *
 * @property supported whether the host can toggle fullscreen (web `document.fullscreenEnabled`); when false the
 *   button hides entirely (web `if (!supported) return null`).
 * @property isFullscreen whether the target is currently fullscreen (web `isFs`, synced from `fullscreenchange`);
 *   selects the Exit glyph + exit label when true, the Enter glyph + enter label when false.
 */
data class FullscreenUiState(
    val supported: Boolean = true,
    val isFullscreen: Boolean = false,
) {
    companion object {
        /** The resting state on a supporting host before any toggle: visible, not fullscreen. */
        val Default: FullscreenUiState = FullscreenUiState(supported = true, isFullscreen = false)

        /** The hidden state on a host that cannot toggle fullscreen (web `supported === false`). */
        val Hidden: FullscreenUiState = FullscreenUiState(supported = false, isFullscreen = false)
    }
}

/**
 * The toggle action a tap resolves to for the current state — the native analogue of the web `toggle`'s
 * `requestFullscreen()` vs `exitFullscreen()` branch. Emitted (PII-free) as a diagnostics field so a toggle
 * can be observed without recording any user data.
 */
enum class FullscreenAction {
    /** Not currently fullscreen — a tap enters (web `target.requestFullscreen()`). */
    Enter,

    /** Currently fullscreen — a tap exits (web `document.exitFullscreen()`). */
    Exit,
}

/**
 * Whether the button renders at all for the current support flag — the web `if (!supported) return null`. When
 * false the surface draws nothing; this is a faithful reproduction of the web capability-gate, NOT a data-hide
 * (the surface has no data to gate on). Pure, so the visibility decision is unit-tested off-device.
 */
fun isButtonVisible(supported: Boolean): Boolean = supported

/**
 * The accessible name + tooltip for the current state — the web `isFs ? exitLabel : enterLabel`, the single
 * string driving `aria-label`, `title`, and (via the flip) the `aria-pressed` signal. Pure so the render
 * decision is unit-tested off-device against both branches.
 */
fun fullscreenLabel(
    isFullscreen: Boolean,
    enterLabel: String,
    exitLabel: String,
): String = if (isFullscreen) exitLabel else enterLabel

/**
 * The toggle-state token the button exposes programmatically — the native analogue of the web
 * `data-fullscreen-state={isFs ? 'on' : 'off'}` test seam, also the assistive-tech `aria-pressed` signal.
 * Pure so the per-state value is unit-tested off-device.
 */
fun fullscreenStateToken(isFullscreen: Boolean): String = if (isFullscreen) STATE_ON else STATE_OFF

/**
 * The action a tap resolves to for the current state — the web `toggle`'s `requestFullscreen()` (when not
 * fullscreen) vs `exitFullscreen()` (when fullscreen) branch. Pure so the decision is unit-tested off-device.
 */
fun nextFullscreenAction(isFullscreen: Boolean): FullscreenAction = if (isFullscreen) FullscreenAction.Exit else FullscreenAction.Enter

/** The `fullscreenStateToken` value when the target is fullscreen (web `'on'`). */
const val STATE_ON: String = "on"

/** The `fullscreenStateToken` value when the target is not fullscreen (web `'off'`). */
const val STATE_OFF: String = "off"

/** The stable, dot-namespaced diagnostics event emitted once when the button is first composed (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever a tap resolves a fullscreen toggle. */
const val EVENT_TOGGLE: String = "fullscreen.toggle"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/** The structured-field key carrying the resolved toggle action (never any user data). */
const val FIELD_ACTION: String = "action"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [FullscreenButtonRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the state holder calls it
 * once per placement open.
 */
fun recordFullscreenOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to FullscreenButtonRegistration.SLUG))
}

/**
 * Emits the PII-safe toggle diagnostic carrying only the surface slug and the resolved [action] — never a
 * target id, route, or any user content, so a diagnostics line can never leak what the operator was viewing.
 */
fun recordFullscreenToggle(
    logger: Logger,
    action: FullscreenAction,
) {
    logger.info(
        EVENT_TOGGLE,
        mapOf(FIELD_SURFACE to FullscreenButtonRegistration.SLUG, FIELD_ACTION to action.name.lowercase()),
    )
}
