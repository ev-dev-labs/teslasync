// Pure, framework-free model + projection for the Advanced Settings "Restore confirmation prompts"
// feature view — the native analogue of everything the web component derives before returning JSX
// (web/src/features/settings/components/AdvancedSettings.tsx) plus its `useSilenceKeyLabel` helper. No
// Compose, no Android, no HTTP: every type here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web panel is purely client-side — it reads the "Don't ask again" allowlist persisted by
// `@/lib/confirmSilence` (`listSilenced()` returns the deduped, sorted action ids) and renders one row
// per id, mapping the known ids to friendly labels and falling back to the raw id for forward-compat.
// This file owns exactly that derivation: the canonical (dedupe + sort) `SilencedPrompts` set, the
// `useSilenceKeyLabel` key→label mapping, and the rows the surface renders. The persistence itself is a
// seam (AdvancedSettingsSource) so this projection stays deterministic and fully testable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AdvancedSettings — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling UuidGenerator / ColorConverter
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.advancedsettings

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AdvancedSettingsRegistration {
    /** Stable surface id. */
    const val ID: String = "advanced-settings"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AdvancedSettings"
}

/**
 * The stable, namespaced confirm-dialog action ids the web `useSilenceKeyLabel` switch knows about
 * (web/src/features/settings/components/AdvancedSettings.tsx). Unknown ids fall through to the raw key
 * (forward-compat for new adopters that haven't shipped a translation yet), exactly as on web.
 */
object ConfirmSilenceKeys {
    /** The `<ConfirmDialog>` "discard unsaved draft" prompt id. */
    const val DISCARD_DRAFT: String = "discard-draft"

    /** The "leave page with unsaved changes" navigation-guard prompt id. */
    const val UNSAVED_NAVIGATION: String = "unsaved-navigation"
}

/**
 * The set of silenced confirm-dialog action ids the surface renders — the native analogue of the web
 * `listSilenced()` result. [keys] is always deduped and sorted for stable rendering (web
 * `[...load()].sort()`); an empty [keys] is the "nothing silenced" sentinel that maps to the surface's
 * empty state (the web `silenced.length === 0` branch).
 *
 * @property keys the silenced action ids, deduped + sorted.
 */
data class SilencedPrompts(
    val keys: List<String>,
) {
    /** No prompt has been silenced (web `silenced.length === 0`) → the surface renders its empty state. */
    val isBlank: Boolean get() = keys.isEmpty()

    /** The number of silenced prompts (web `silenced.length`). */
    val size: Int get() = keys.size

    companion object {
        /** The "nothing silenced" sentinel for the empty preview / initial state. */
        val EMPTY = SilencedPrompts(emptyList())

        /**
         * Canonicalises an arbitrary id collection into a [SilencedPrompts] — dropping blanks, deduping,
         * and sorting (the native port of the web `listSilenced` `[...new Set(...)].sort()`). The single
         * place the dedupe + sort rule lives so the store and the view-model can't drift.
         */
        fun of(keys: Collection<String>): SilencedPrompts = SilencedPrompts(keys.filter { it.isNotEmpty() }.distinct().sorted())
    }
}

/**
 * One render-ready silenced-prompt row — the action [key] paired with its resolved, localized [label].
 * Pure data (no Compose types) so the projection is unit-tested without a UI host.
 */
data class SilencedPromptRow(
    val key: String,
    val label: String,
)

/**
 * Localized labels for the known silence keys — the native port of the web `useSilenceKeyLabel` switch.
 * Kept out of the pure [AdvancedSettingsProjection] (the composable resolves them from the i18n catalog
 * and hands them in) so the projection stays a pure, locale-stable function.
 *
 * @property discardDraftLabel label for [ConfirmSilenceKeys.DISCARD_DRAFT].
 * @property unsavedNavigationLabel label for [ConfirmSilenceKeys.UNSAVED_NAVIGATION].
 */
data class AdvancedSettingsStrings(
    val discardDraftLabel: String,
    val unsavedNavigationLabel: String,
) {
    /**
     * Resolves the friendly label for a silence [key] — the native port of `useSilenceKeyLabel`:
     * the two known ids map to their localized labels, and any unknown id falls back to the raw key.
     */
    fun labelFor(key: String): String =
        when (key) {
            ConfirmSilenceKeys.DISCARD_DRAFT -> discardDraftLabel
            ConfirmSilenceKeys.UNSAVED_NAVIGATION -> unsavedNavigationLabel
            else -> key
        }
}

/**
 * The fully projected, render-ready view of the silenced prompts — the native analogue of what the web
 * component computes before returning JSX (the `silenced` list, the `silenced.length > 0` "Restore all"
 * guard, and the per-id rows). Pure data so the projection is unit-tested without a UI host.
 *
 * @property hasPrompts whether any prompt is silenced (web `silenced.length > 0`) — gates "Restore all".
 * @property rows one row per silenced id, label-resolved and in stable (sorted) order.
 */
data class AdvancedSettingsDisplay(
    val hasPrompts: Boolean,
    val rows: List<SilencedPromptRow>,
)

/**
 * Pure projection from the canonical [SilencedPrompts] to the render-ready [AdvancedSettingsDisplay] —
 * the native port of the web component's `silenced.map(...)` row build plus its label resolution. Routed
 * through this one object so the row shape + label rule have a single, test-pinned definition.
 */
object AdvancedSettingsProjection {
    /** Project [prompts] into rows using the localized [strings] (web `silenced.map(labelFor)`). */
    fun project(
        prompts: SilencedPrompts,
        strings: AdvancedSettingsStrings,
    ): AdvancedSettingsDisplay =
        AdvancedSettingsDisplay(
            hasPrompts = !prompts.isBlank,
            rows = prompts.keys.map { key -> SilencedPromptRow(key = key, label = strings.labelFor(key)) },
        )
}
