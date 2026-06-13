// Pure, framework-free model + projection + diagnostics for the HelpSegment shared surface — the native
// analogue of web/src/components/layout/status-bar/HelpSegment.tsx. No Compose, no Android framework, no HTTP:
// every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web source is a STATUS-BAR CHROME segment, not a data-fetching view: it binds only `useTranslation`
// and renders three "always available" help affordances that dispatch decoupled events —
//   • shortcuts → `window.dispatchEvent('toggle-keyboard-shortcuts')`
//   • tour      → `dispatchTourLauncherOpen()` (the tour registry)
//   • feedback  → `window.dispatchEvent('open-feedback-modal')`
// It fetches nothing. Because the surface has no async cache-then-network feed, there is no
// loading / empty / error / stale / offline lifecycle to render; modelling those would fabricate behaviour
// the web source does not have (the same rationale the accepted SkipToContent / CopyLinkButton ports
// document, covenant #2 / #9). The surface's real states are reproduced instead: the [HelpDisplayMode]
// compact (icon-only) ↔ expanded (icon + label) modes (web `iconOnly`), and the per-action dispatch
// [HelpDispatchOutcome] — a decoupled listener was mounted and handled the intent ([HelpDispatchOutcome.Handled],
// web's listener firing) or none was mounted so the tap is a safe no-op ([HelpDispatchOutcome.NoListener],
// web's event landing with no listener). Every rendered string resolves through the i18n catalog (P1/S10) at
// the render boundary via the web `t(key, default)` contract, so no un-internationalized literal lives in
// native code — the [HelpAction] fallbacks below are the web source's own i18next default values.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/HelpSegment — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helpsegment

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the HelpSegment surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`HelpSegment`); [ID] is
 * the stable `viewModel` key the host binds the surface with.
 */
object HelpSegmentRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "help-segment"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "HelpSegment"
}

/**
 * The literal keyboard key the shortcuts affordance shows beside its icon in the expanded mode — the native
 * mirror of the web `<kbd>?</kbd>`. It is a keyboard-key symbol, not translatable prose, so it is a constant
 * rather than an i18n key (exactly as the web source hard-codes `?`).
 */
const val SHORTCUT_HINT_GLYPH: String = "?"

/**
 * One web `t(key, default)` pair — the i18n [key] and its i18next default [fallback] (the literal string the web
 * source passes as the second `t` argument). The composable resolves [key] from the P1/S10 catalog at the render
 * boundary and falls back to [fallback] only when the key is catalog-absent (web `shortcuts.tooltip` /
 * `shortcuts.openAria`), exactly as i18next renders the inline default — so a native string is never an
 * un-internationalized literal.
 */
data class LocalizedText(
    val key: String,
    val fallback: String,
)

/**
 * The three "always available" help affordances the segment renders — the native tags for the web source's
 * three buttons. Each entry carries the web source's i18n triplet ([tooltip] / [accessibleName] / [label]) as
 * [LocalizedText] `t(key, default)` pairs, so the composable reproduces `t(key, default)` exactly and a
 * catalog-absent key still renders the same fallback the web renders. [wireName] is the PII-safe token the
 * invocation diagnostic carries (never any label text), and [showsShortcutHint] flags the one affordance
 * (shortcuts) that draws the `?` kbd chip.
 *
 * @property wireName PII-safe diagnostics token for this action (never a label).
 * @property tooltip the hover/long-press tooltip copy (web `Tooltip content`).
 * @property accessibleName the screen-reader name (web `aria-label`).
 * @property label the visible label shown in the expanded mode.
 * @property showsShortcutHint whether this affordance draws the `?` kbd chip (shortcuts only).
 */
enum class HelpAction(
    val wireName: String,
    val tooltip: LocalizedText,
    val accessibleName: LocalizedText,
    val label: LocalizedText,
    val showsShortcutHint: Boolean,
) {
    /** Opens the keyboard-shortcuts cheat sheet (web `toggle-keyboard-shortcuts`); draws the `?` kbd chip. */
    Shortcuts(
        wireName = "shortcuts",
        tooltip = LocalizedText("shortcuts.tooltip", "Keyboard shortcuts"),
        accessibleName = LocalizedText("shortcuts.openAria", "Open keyboard shortcuts"),
        label = LocalizedText("shortcuts.hintSuffix", "for shortcuts"),
        showsShortcutHint = true,
    ),

    /** Opens the guided tour launcher (web `dispatchTourLauncherOpen()`). */
    Tour(
        wireName = "tour",
        tooltip = LocalizedText("tour.launcher.openShort", "Take a tour"),
        accessibleName = LocalizedText("tour.launcher.openAria", "Open tour launcher"),
        label = LocalizedText("tour.launcher.openShort", "Take a tour"),
        showsShortcutHint = false,
    ),

    /** Opens the in-app feedback / bug-report form (web `open-feedback-modal`). */
    Feedback(
        wireName = "feedback",
        tooltip = LocalizedText("feedback.openShort", "Report bug"),
        accessibleName = LocalizedText("feedback.openAria", "Open feedback / bug report form"),
        label = LocalizedText("feedback.openShort", "Report bug"),
        showsShortcutHint = false,
    ),
}

/**
 * The mutually-exclusive density modes the segment draws — the native tag for the web `iconOnly` prop.
 * [Compact] is the icon-only mode (web `iconOnly` true): tooltips carry every label, nothing visible but the
 * icons. [Expanded] is the full mode (web `iconOnly` false): each icon gains its visible label and the
 * shortcuts affordance gains its `?` kbd chip.
 */
enum class HelpDisplayMode {
    /** Icon-only mode — the native mirror of web `iconOnly` true (compact / narrow status bar). */
    Compact,

    /** Icon + label mode — the native mirror of web `iconOnly` false (expanded status bar). */
    Expanded,
}

/**
 * Maps the web `iconOnly` flag onto the [HelpDisplayMode] — pure so the density contract is unit-tested
 * off-device without a UI host.
 */
fun helpDisplayMode(iconOnly: Boolean): HelpDisplayMode = if (iconOnly) HelpDisplayMode.Compact else HelpDisplayMode.Expanded

/**
 * Whether an affordance's visible label renders in [mode] — true only in [HelpDisplayMode.Expanded], the
 * native mirror of the web label spans being hidden while `iconOnly`.
 */
fun labelVisible(mode: HelpDisplayMode): Boolean = mode == HelpDisplayMode.Expanded

/**
 * Whether [action] draws its `?` kbd chip in [mode] — true only for the shortcuts affordance and only in the
 * expanded mode, the native mirror of the web `{!iconOnly && <kbd>?</kbd>}` guard.
 */
fun shortcutHintVisible(
    action: HelpAction,
    mode: HelpDisplayMode,
): Boolean = action.showsShortcutHint && mode == HelpDisplayMode.Expanded

/**
 * The result of invoking a help affordance — the native mirror of the web decoupled event dispatch. [Handled]
 * is a listener (the shortcuts sheet / tour launcher / feedback modal) being mounted and acting on the intent;
 * [NoListener] is the intent landing with nothing mounted, so the tap is a safe no-op rather than a crash —
 * exactly as a web `dispatchEvent` with no registered listener does nothing.
 */
enum class HelpDispatchOutcome(
    val wireName: String,
) {
    /** A decoupled listener was mounted and handled the intent (web: an event listener fired). */
    Handled("handled"),

    /** No listener was mounted, so the tap did nothing (web: an event landed with no listener). */
    NoListener("noListener"),
}

/**
 * Folds whether a listener handled the intent into the [HelpDispatchOutcome] — pure so the dispatch contract
 * is unit-tested without a registry host.
 */
fun helpDispatchOutcome(handled: Boolean): HelpDispatchOutcome =
    if (handled) HelpDispatchOutcome.Handled else HelpDispatchOutcome.NoListener

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever the user invokes one of the help affordances. */
const val EVENT_INVOKE: String = "helpSegment.invoke"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/** The structured-field key carrying the coarse action token (never a label) on an invocation. */
const val FIELD_ACTION: String = "action"

/** The structured-field key carrying the coarse dispatch outcome (never any content) on an invocation. */
const val FIELD_OUTCOME: String = "outcome"

/**
 * PII-safe diagnostics for the HelpSegment surface (P1/S11). Every record carries only the surface
 * [HelpSegmentRegistration.SLUG] and, for an invocation, the coarse [HelpAction.wireName] + [HelpDispatchOutcome]
 * — never a label, tooltip, or any content, so a diagnostics line can never leak help copy or what a user
 * opened. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object HelpSegmentDiagnostics {
    /** Emits the one `view.opened` record (slug only) — the ViewModel calls it once per surface open. */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to HelpSegmentRegistration.SLUG))
    }

    /** Emits the `helpSegment.invoke` record carrying the surface slug, the coarse [action], and [outcome] only. */
    fun recordInvoke(
        logger: Logger,
        action: HelpAction,
        outcome: HelpDispatchOutcome,
    ) {
        logger.info(
            EVENT_INVOKE,
            mapOf(
                FIELD_SURFACE to HelpSegmentRegistration.SLUG,
                FIELD_ACTION to action.wireName,
                FIELD_OUTCOME to outcome.wireName,
            ),
        )
    }
}
