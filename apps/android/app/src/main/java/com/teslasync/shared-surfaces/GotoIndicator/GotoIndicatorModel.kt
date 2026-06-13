// Pure, framework-free model + projection for the GotoIndicator shared surface — the native analogue of the
// data the web component derives before returning JSX (web/src/components/feedback/GotoIndicator.tsx). No
// Compose, no Android UI, no HTTP: every type here is exercised by the :android:testReleaseUnitTest gate so the
// composable in GotoIndicator.kt stays a thin render layer.
//
// What the web does: `GotoIndicator({ visible })` is a tiny presentational overlay. When `visible` is false it
// renders `null`; when true it renders a fixed, bottom-centre translucent pill — a muted
// `t('shortcuts.goto', 'Go to...')` label followed by two `<kbd>` key caps ("g" and "?") joined by a "+". Its
// ONLY dependency is `useTranslation`; there is no data hook, no fetch, no async state.
//
// Parity-with-honesty (Honesty Covenant #9 — documented, not silent): this surface has NO async data source, so
// it has no network loading / error / stale / offline lifecycle to model. Inventing those states would fabricate
// behaviour the web spec does not have — the exact rationale the accepted AnnouncerRegion and globalShortcuts
// ports document. Its real, web-faithful states are the two the source branches on: [GotoIndicatorPhase.Hidden]
// (the web `if (!visible) return null`) and [GotoIndicatorPhase.Visible] (the pill). The view renders both; the
// Hidden branch is the web's own designed absence (a deliberate visibility toggle, not a nulled data region), so
// reproducing it faithfully means drawing nothing — forcing a visible fallback there would BREAK parity.
//
// i18n parity (P1/S10): the web key `shortcuts.goto` resolves to "Go to {{label}}" in the catalog, but the
// component passes no `label` (and i18next runs with `escapeValue:false` and no missingInterpolationHandler, so
// the unprovided `{{label}}` collapses to empty); the component's `'Go to...'` default reveals the intended
// copy. The native port renders the SAME canonical key (`translation_shortcuts_goto`) with a typographic
// ellipsis supplied as the label, yielding the intended "Go to …" across every locale — no English literal, and
// the key the source references has a matching P1/S10 catalog entry. The "g" / "?" / "+" tokens are locale-
// neutral keyboard glyphs the web hardcodes, so they are not routed through the catalog.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/GotoIndicator — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path,
// exactly as the sibling surfaces do. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.gotoindicator

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The two mutually-exclusive render states the GotoIndicator surface has — the native port of the web
 * component's two branches. There is no third (no loading / error / empty-data state) because the surface binds
 * no async feed; see the file header's parity-with-honesty note.
 */
enum class GotoIndicatorPhase {
    /** The web `if (!visible) return null` — the hint is dismissed and nothing is drawn. */
    Hidden,

    /** The hint is shown — render the translucent "Go to …  g + ?" pill. */
    Visible,
}

/**
 * The already-localized copy the surface folds into its output, resolved from the P1/S10 catalog at the render
 * boundary (tests pass a deterministic instance), keeping [GotoIndicatorProjection] a pure, locale-stable
 * function.
 *
 * @property gotoLabel the localized "Go to …" hint (web `t('shortcuts.goto', 'Go to...')`); see the file header.
 */
data class GotoIndicatorStrings(
    val gotoLabel: String,
)

/**
 * The immutable, render-ready projection the composable draws: the resolved [phase] (the web `visible` branch)
 * and the ordered [keys] for the key-cap chips. Pure data so [GotoIndicatorProjection] is unit-tested without a
 * UI host.
 *
 * @property keys the keyboard glyphs rendered as `<kbd>` chips, in order (web hardcoded `g`, then `?`).
 */
data class GotoIndicatorDisplay(
    val phase: GotoIndicatorPhase,
    val keys: List<String> = GotoIndicatorProjection.SHORTCUT_KEYS,
) {
    /** True when the pill should be drawn (the web `visible` branch). */
    val isVisible: Boolean get() = phase == GotoIndicatorPhase.Visible
}

/**
 * Pure projection logic for the GotoIndicator surface — the native port of the web component's `visible`
 * branch plus the key-cap composition. Holds the locale-neutral key tokens and the canonical i18n key the
 * surface and the web source share, so the two stay in lockstep.
 */
object GotoIndicatorProjection {
    /**
     * The keyboard glyphs the web renders as two `<kbd>` chips, in order. Locale-neutral key names, hardcoded in
     * the web source, so they are not routed through the i18n catalog.
     */
    val SHORTCUT_KEYS: List<String> = listOf("g", "?")

    /** The glyph joining the key caps (web `<span>+</span>`); a locale-neutral symbol, not translated copy. */
    const val KEY_SEPARATOR: String = "+"

    /**
     * The catalog key the web component references (`shortcuts.goto`) in its Android form. Defined as
     * "Go to %1$s"; the surface fills `%1$s` with [GOTO_LABEL_ELLIPSIS]. See the file header for the parity
     * reasoning behind reusing this key.
     */
    const val GOTO_LABEL_KEY: String = "shortcuts.goto"

    /**
     * The typographic ellipsis (U+2026) supplied as the `shortcuts.goto` label so the shared template renders the
     * web component's intended "Go to …" hint. A punctuation glyph, not English copy.
     */
    const val GOTO_LABEL_ELLIPSIS: String = "\u2026"

    /** Projects the render-boundary `visible` flag onto the [GotoIndicatorDisplay] (web `visible` branch). */
    fun project(visible: Boolean): GotoIndicatorDisplay =
        GotoIndicatorDisplay(phase = if (visible) GotoIndicatorPhase.Visible else GotoIndicatorPhase.Hidden)

    /**
     * Builds the merged TalkBack description for the pill — the localized [label] followed by the [keys] joined
     * by " + ", so assistive tech voices one coherent phrase ("Go to … g + ?") instead of reading each chip and
     * joiner as a separate node. Mirrors the sibling KeyboardShortcutsModal key-combo contentDescription.
     */
    fun contentDescription(
        label: String,
        keys: List<String>,
    ): String = "$label ${keys.joinToString(separator = " $KEY_SEPARATOR ")}"
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event
 * tagged with the surface [SLUG] — never any user data (there is none on this surface).
 */
object GotoIndicatorDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "goto-indicator"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "GotoIndicator"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /**
     * Emits the one-shot `view.opened` diagnostic for this surface. Call from the view the first time the hint
     * becomes visible (the web mounts the pill only when `visible` is true).
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
