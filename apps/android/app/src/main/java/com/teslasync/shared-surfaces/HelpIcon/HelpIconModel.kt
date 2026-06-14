// Pure, framework-free model + render classifier for the HelpIcon shared surface — the native analogue of every
// decision the web component makes (web/src/components/ui/HelpIcon.tsx) before it draws its trigger button +
// tooltip. No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A tiny, PURE, field-level help primitive: a `(?)` icon placed next to a form label that reveals explanatory
//     copy through the shared `Tooltip`. Its only logic is: resolve the help text (web
//     `i18nKey ? t(i18nKey, { defaultValue: content }) : content`); render NOTHING when that text is empty (web
//     `if (!text) return null`); and choose the trigger's accessible name (web
//     `ariaLabel ?? (for ? t('a11y.helpFor', { field: for }) : t('help.tooltip.iconLabel'))`). Its sole imports are
//     a class-name helper and the shared Tooltip. There is NO hook that fetches, NO `request()` call, and NO data
//     port to bind (no P1/S8 state holder, no Source/ViewModel) — modelling one would invent an async dependency
//     the web spec does not have (honesty covenant: no scope narrowing, no silent drift). The one "data source"
//     the prompt lists, `useTranslation`, is the i18n facade, not a query; its native analogue is the
//     `stringResource` lookups the composable performs against the P1/S10 catalog. The closest sibling precedent is
//     the equally presentational FormField surface (composable + model, no Source/ViewModel).
//   • So the surface's REAL, fully-reproduced states are its prop-driven branches: HIDDEN when no help text is
//     supplied (web `return null`), and SHOWN otherwise — crossed with the three accessible-name outcomes (an
//     explicit override, the per-field "Help for {field}", or the generic "More info"). Each is reduced here in
//     [classify] and asserted in the off-device test, doubling as the per-state projection check.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it renders copy handed to it by its parent. There is no query to be loading, to fail,
// to go stale, or to be offline. The web component's only "empty" outcome is "no help text ⇒ render nothing",
// which IS reproduced here as [HelpIconRender.Hidden]; inventing the data-fetch states would be dishonest. The
// owning screen that DOES fetch renders its own data surface and composes this icon once it already has its copy.
//
// Why the web `side` placement prop is not surfaced: Material 3 anchors a tooltip adjacent to its trigger and
// resolves the concrete side from available space (Android HIG), so a four-way CSS placement has no idiomatic
// native equivalent — the sibling `components/ui/HelpIcon` and `components/ui/Tooltip` atoms already omit it. This
// is a documented platform adaptation, not a dropped behavior, in the same spirit as FormField mapping the web
// asterisk's `aria-label="required"` onto a merged TalkBack announcement.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/HelpIcon — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling FormField surface does. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helpicon

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no help text, field id, or label
 * — only this constant identifier — so a diagnostics line can never leak the field's copy.
 */
const val HELP_ICON_SLUG: String = "HelpIcon"

/**
 * Test tag applied to the rendered trigger so instrumented UI tests (and audits) can locate the icon. When the
 * surface is attached to a labelled control the field id is appended — the native analogue of the web
 * `data-help-for` attribute, which lets audits correlate a help icon to the field it documents.
 */
const val HELP_ICON_TRIGGER_TAG: String = "help-icon-trigger"

/**
 * The parent-owned inputs to the icon, bundled into one value object so the pure [classify] reads a single
 * argument — the native mirror of the web `HelpIconProps` the parent supplies. The two label strings are resolved
 * by the composable from the P1/S10 catalog before classification so this layer stays free of Android resources.
 *
 * @property text the resolved help copy (the web `i18nKey`-resolved string); blank ⇒ [content] is used instead.
 * @property content the inline fallback / one-off help copy (web `content`).
 * @property ariaLabel an explicit accessible-name override (web `ariaLabel`); blank ⇒ ignored.
 * @property forId the id of the field this icon documents (web `for`); selects the per-field accessible name.
 * @property helpForLabel the already-localized per-field name (web `t('a11y.helpFor', { field: for })`).
 * @property genericLabel the already-localized generic name (web `t('help.tooltip.iconLabel')`).
 */
data class HelpIconInput(
    val text: String? = null,
    val content: String? = null,
    val ariaLabel: String? = null,
    val forId: String? = null,
    val helpForLabel: String,
    val genericLabel: String,
)

/**
 * The render-ready classification of the icon — the native mirror of the web component's `if (!text) return null`
 * gate. Exactly one outcome is ever chosen.
 */
sealed interface HelpIconRender {
    /** No help text was supplied, so nothing is drawn (web `return null`). */
    data object Hidden : HelpIconRender

    /**
     * Help text is present, so the trigger + tooltip are drawn.
     *
     * @property text the help copy revealed by the tooltip (web `text`).
     * @property accessibleLabel the trigger's accessible name (web trigger `aria-label`).
     */
    data class Shown(
        val text: String,
        val accessibleLabel: String,
    ) : HelpIconRender
}

/**
 * Resolve the help copy the way the web component does: the [text] (web `i18nKey`-resolved value) wins, otherwise
 * the [content] fallback (web `content`), otherwise the empty string. A blank value is treated as absent — the
 * native reading of the web falsy / empty-string guard — so a whitespace-only string never yields an empty tooltip.
 */
fun resolveHelpText(
    text: String?,
    content: String?,
): String {
    val primary = text?.trim().orEmpty()
    if (primary.isNotEmpty()) return primary
    return content?.trim().orEmpty()
}

/**
 * Choose the trigger's accessible name exactly as the web component does (web
 * `ariaLabel ?? (for ? t('a11y.helpFor', { field: for }) : t('help.tooltip.iconLabel'))`): a non-blank explicit
 * [ariaLabel] override wins; otherwise the per-field [helpForLabel] when a [forId] is present; otherwise the
 * generic [genericLabel]. The two label strings arrive already localized so this stays a pure selection.
 */
fun resolveAccessibleLabel(
    ariaLabel: String?,
    forId: String?,
    helpForLabel: String,
    genericLabel: String,
): String {
    val override = ariaLabel?.trim().orEmpty()
    if (override.isNotEmpty()) return override
    return if (!forId.isNullOrBlank()) helpForLabel else genericLabel
}

/**
 * Reduce the parent's [input] into the render-ready [HelpIconRender]. Pure (no Compose). When no help text is
 * supplied the surface is [HelpIconRender.Hidden] (web `return null`); otherwise it is [HelpIconRender.Shown] with
 * the resolved copy and accessible name.
 */
fun classify(input: HelpIconInput): HelpIconRender {
    val text = resolveHelpText(input.text, input.content)
    if (text.isEmpty()) return HelpIconRender.Hidden
    val label = resolveAccessibleLabel(input.ariaLabel, input.forId, input.helpForLabel, input.genericLabel)
    return HelpIconRender.Shown(text = text, accessibleLabel = label)
}

/**
 * Build the trigger's test tag — the native analogue of the web `data-help-for` attribute. When a non-blank [forId]
 * is supplied it is appended so audits/tests can correlate the icon to the field it documents; otherwise the bare
 * [HELP_ICON_TRIGGER_TAG] is used (web `data-help-for={undefined}`).
 */
fun helpForTestTag(forId: String?): String {
    val id = forId?.trim().orEmpty()
    return if (id.isEmpty()) HELP_ICON_TRIGGER_TAG else "$HELP_ICON_TRIGGER_TAG-$id"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the help text,
 * field id, or label — so a diagnostics line can never leak the field's copy.
 */
object HelpIconDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = HELP_ICON_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
