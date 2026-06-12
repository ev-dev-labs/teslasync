// Pure, framework-free model + projection for the SettingField feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/settings/components/SettingField.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// SettingField is a purely presentational wrapper — the web component takes an already-localized `label`
// (the caller resolves it through its own `t()`), an optional `help` descriptor, and arbitrary `children`,
// and renders a label row with an optional inline `<HelpIcon>` above the children. It binds NO data hook,
// so the cache-then-network lifecycle (loading / error / stale / offline) lives on the owning settings page,
// not here; modelling those phases would invent behaviour the spec does not have (drift), exactly as the
// sibling presentational ports (BatteryPill / AchievementBadge / StatusHeader) document. The branches the
// web source actually defines are reproduced here:
//   - the `<HelpIcon>` text rule `i18nKey ? t(i18nKey, content) : content` (web HelpIcon L65);
//   - the "render nothing when there is no help text" guard (web HelpIcon `if (!text) return null`, L69);
//   - the per-field vs generic aria-label selection (web HelpIcon L71-75), surfaced as [ResolvedHelp.fieldId];
//   - the label's `uppercase` text-transform (web `<label class="... uppercase ...">`, L26).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SettingField — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling presentational surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.settingfield

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/**
 * The optional inline-help descriptor — a 1:1 port of the web `SettingFieldHelp` interface
 * (web/src/features/settings/components/SettingField.tsx L4-11). The web `for` field is renamed [forId]
 * because `for` is a reserved Kotlin keyword; it carries the same value (the labelled control's id) and is
 * surfaced in the help icon's accessible name.
 *
 * @property i18nKey i18n key for the inline help text (preferred over [content]); the web `help.i18nKey`.
 * @property content plain-text fallback used when [i18nKey] is absent or resolves to nothing; web `help.content`.
 * @property forId id of the field the help is attached to; drives the "Help for {forId}" accessible name
 *   (web `help.for`).
 */
data class SettingFieldHelp(
    val i18nKey: String? = null,
    val content: String? = null,
    val forId: String? = null,
)

/**
 * The render-ready help projection — what the thin composable actually draws. Pure data (no Compose types)
 * so the resolution is unit-tested without a UI host. A non-null instance means the help icon renders; a
 * null result is the web `if (!text) return null` branch (no icon at all).
 *
 * @property text the resolved, non-empty help text shown in the tooltip (web HelpIcon `text`).
 * @property fieldId the labelled control's id when present and non-empty, else null; selects the accessible
 *   name (`Help for {fieldId}` vs the generic `More info`), mirroring the web `forId ? … : …` ternary.
 */
data class ResolvedHelp(
    val text: String,
    val fieldId: String?,
)

/**
 * Pure projection from the web `SettingField` props to their render-ready forms — a 1:1 port of the two
 * derivations the surface performs (the `<HelpIcon>` text/visibility rule and the label `uppercase`
 * transform) before returning JSX. Every function is deterministic and injected with its i18n seam, so the
 * resolve-or-fallback decision stays testable off-device.
 */
object SettingFieldProjection {
    private val NON_IDENTIFIER = Regex("[^A-Za-z0-9]+")

    /**
     * Folds an i18next key into the Android string-resource name the generated catalog uses: the
     * `translation_` prefix with every run of non-identifier characters (the dots in
     * `help.fields.settings.electricityCost`) replaced by a single underscore. Verified against the real
     * generated resources (e.g. `help.fields.settings.electricityCost`
     * → `translation_help_fields_settings_electricityCost`).
     */
    fun foldCatalogKey(webKey: String): String = "translation_" + webKey.replace(NON_IDENTIFIER, "_").trim('_')

    /**
     * Resolves [help] into its render-ready [ResolvedHelp], or null when no help should render — the exact
     * logic of the web `<HelpIcon>` (web/src/components/ui/HelpIcon.tsx L65-69):
     *   `const text = i18nKey ? t(i18nKey, { defaultValue: content ?? '' }) : (content ?? '')`
     *   `if (!text) return null`
     * [translate] reproduces i18next `t(key, defaultValue)`: it is a by-name catalog read folded through
     * [foldCatalogKey] in production (the composable's seam) and a deterministic map in tests. An empty
     * [SettingFieldHelp.i18nKey] takes the content path (JS treats `''` as falsy), matching the web ternary.
     */
    fun resolveHelp(
        help: SettingFieldHelp?,
        translate: (key: String, fallback: String) -> String,
    ): ResolvedHelp? {
        if (help == null) return null
        val content = help.content.orEmpty()
        val text = if (!help.i18nKey.isNullOrEmpty()) translate(help.i18nKey, content) else content
        return if (text.isEmpty()) null else ResolvedHelp(text = text, fieldId = help.forId?.takeIf(String::isNotEmpty))
    }

    /**
     * The label text the web renders, with the `uppercase` text-transform applied
     * (web `<label class="… uppercase tracking-wider …">`, L26). Locale-aware like the browser's CSS
     * transform: it uppercases cased scripts (Latin) and is a no-op for caseless scripts (Arabic / Hebrew /
     * CJK), so the localized ar/he catalogs stay legible while Latin labels match the web verbatim.
     */
    fun displayLabel(
        label: String,
        locale: Locale,
    ): String = label.uppercase(locale)
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the field
 * label or help text — so a diagnostics line can never leak a user's settings posture.
 */
object SettingFieldDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "SettingField"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
