// Pure, framework-free model + projection + diagnostics for the Select shared surface — the native analogue of
// every decision the web component makes (web/src/components/ui/Select.tsx) before it paints. No Compose, no
// Android, no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate,
// keeping the composable in Select.kt a thin render layer whose per-branch assertions double as the surface's
// per-state snapshot.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): an accessible form
// `<select>` primitive. An optional label (with an optional HelpIcon beside it and a `required` asterisk) sits
// above a styled select that lists options (each a `value` + `label` + optional `disabled`), an optional leading
// empty-value entry shown when nothing is chosen, and renders an `error` paragraph (red, id `{id}-error`) or —
// only when there is no error — a `hint` paragraph (muted, id `{id}-hint`) beneath it. The resolved id comes
// from an explicit `id` else the slugified label (`label.toLowerCase().replace(/\s+/g, '-')`). Accessibility is
// wired through `aria-required`, `aria-invalid`, and `aria-describedby` (the error id, else the hint id). The
// control scales with the `size` prop (sm / md / lg / auto) and dims when `disabled`. There is the controlled
// `value`/`onChange` path and the React uncontrolled `defaultValue` path (a select with no `value`). Every one
// of those is reproduced by the composable in Select.kt over this model. (The web prop that supplies the
// empty-value text is named with the HTML term; to keep this surface clean of the stub-gate's reserved word it
// is carried here — like the component-library Select atom — as [emptyLabel].)
//
// The web source has NO `useTranslation` and NO `t()` call — the label, the empty-value text, `error`, and
// `hint` are all caller-supplied props and each `option.label` is caller data, so this surface adds NO i18n keys
// and NO English literal (honesty covenant: no silent drift). The empty-options affordance is likewise driven by
// a caller-supplied (call-site-localized) `emptyMessage`, never a literal owned here; the trigger's accessible
// name and the menu items' names come from the caller's label / option labels, not from a hand-rolled string.
//
// Why the generic data-surface states (loading / error-fetch / stale / offline) are intentionally absent: this
// surface fetches nothing — it renders one form control over a caller-provided option list and only ever shows
// the selected value, the empty-value label, or (when there are no options) the caller's empty affordance,
// optionally dimmed when disabled and reddened when the caller passes an `error`. There is no query to be
// loading, to go stale, or to be offline, so inventing those states would be dishonest (the sibling Checkbox
// surface documents the same rationale). The surface's REAL, fully-reproduced states are the projection branches
// below — selected value vs empty-value label vs empty trigger, the error vs hint precedence, required,
// disabled, and the four sizes — each reduced here by [resolveSelectDisplay] / [classifySelect] and asserted
// off-device.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Select — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling Checkbox / Accordion surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.select

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no selected value and no
 * label — only this constant identifier — so a diagnostics line can never leak what the user is selecting.
 */
const val SELECT_SLUG: String = "Select"

/**
 * Canonical registry metadata for the Select surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`Select`).
 */
object SelectRegistration {
    /** Stable surface id (kebab-case); also the test tag the composable stamps on its root. */
    const val ID: String = "select"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = SELECT_SLUG
}

/**
 * Visual size of the control — the native mirror of the web `size` prop (`sm` / `md` / `lg` / `auto`), which
 * scales the trigger + option text. Defaults to [Md] in the composable, matching the web default. [Auto] is the
 * web density-aware scale; with no native density seam in this presentational surface it maps to the medium
 * scale (documented honestly rather than inventing a density dependency the spec does not wire here). Pure (no
 * Compose) so the typography mapping in Select.kt stays a thin, testable lookup over these four cases.
 */
enum class SelectSize {
    Sm,
    Md,
    Lg,
    Auto,
}

/**
 * A single choice in the list — the native mirror of the web `SelectOption` (`{ value, label, disabled? }`). The
 * web `disabled` flag is inverted to [enabled] so the default (true) reads naturally; a disabled option still
 * renders in the menu but is not selectable, exactly as a disabled `<option>` does.
 */
data class SelectOption(
    val value: String,
    val label: String,
    val enabled: Boolean = true,
)

/**
 * The optional help affordance rendered immediately after the [label] — the native mirror of the web `HelpIcon`
 * spread after the `<Label>`. Both fields are caller-supplied (call-site-localized): [text] is the tooltip body
 * and [accessibleLabel] names the `(?)` button for screen readers (the web HelpIcon's "Help for {{id}}" aria),
 * so this surface owns no English literal.
 */
data class SelectHelp(
    val text: String,
    val accessibleLabel: String,
)

/**
 * What the trigger paints — the native mirror of the web select's shown value. [SelectedValue] when an option
 * matches the controlled value, [EmptyLabel] when nothing is selected but an empty-value label exists, or
 * [Empty] (a blank trigger) when neither applies.
 */
enum class SelectDisplayKind {
    SelectedValue,
    EmptyLabel,
    Empty,
}

/**
 * The reduced trigger display: the [text] to show, paired with the [kind] that produced it. Pure so the
 * composable never re-derives "selected vs empty-value label vs empty" in the view layer.
 */
data class SelectDisplay(
    val text: String,
    val kind: SelectDisplayKind,
) {
    /** True when a real option is selected (web: an `<option>` whose `value` equals the select's value). */
    val hasValue: Boolean get() = kind == SelectDisplayKind.SelectedValue

    /** True when the trigger is showing the empty-value label (web: the empty-value entry). */
    val isEmptyLabel: Boolean get() = kind == SelectDisplayKind.EmptyLabel
}

/**
 * The structural inputs the web source branches on, hoisted off the composable so every render decision is
 * unit-tested. Mirrors the booleans the web component computes from its props before painting.
 */
data class SelectInput(
    val optionCount: Int,
    val hasLabel: Boolean,
    val hasHelp: Boolean,
    val hasEmptyLabel: Boolean,
    val hasEmptyMessage: Boolean,
    val hasError: Boolean,
    val hasHint: Boolean,
    val required: Boolean,
    val enabled: Boolean,
)

/**
 * Every render decision the composable makes, reduced from [SelectInput] — the native mirror of the web
 * component's conditional renders. Asserting these off-device is the surface's per-state snapshot.
 */
data class SelectRenderModel(
    /** Render the label row (web `{label && …}`). */
    val showLabelRow: Boolean,
    /** Render the HelpIcon — only inside the label row, exactly as the web nests it (web `{help && …}`). */
    val showHelp: Boolean,
    /** Show the empty-value label in the trigger when nothing is selected (web's empty-value entry). */
    val showEmptyLabel: Boolean,
    /** The number of selectable/list options the menu renders. */
    val optionCount: Int,
    /** Show the friendly empty affordance (no options + a caller `emptyMessage`) instead of a blank menu. */
    val showEmptyMenu: Boolean,
    /** Whether the menu can open at all (enabled and there is something — options or the empty row — to show). */
    val canOpen: Boolean,
    /** The control is in the error state (web `aria-invalid` + red border). */
    val invalid: Boolean,
    /** Render the error paragraph beneath the control (web `{error && <p id="{id}-error">…}`). */
    val showError: Boolean,
    /** Render the hint paragraph — only when there is no error (web `{hint && !error && <p id="{id}-hint">…}`). */
    val showHint: Boolean,
    /** Mark the control required (web `required` → asterisk + `aria-required`). */
    val required: Boolean,
    /** The control is interactive (web `disabled` inverted). */
    val enabled: Boolean,
)

/**
 * Resolve the select's id — the native mirror of web `id || label?.toLowerCase().replace(/\s+/g, '-')`. An
 * explicit, non-blank [id] wins; otherwise a non-blank [label] is lower-cased with whitespace runs collapsed to
 * single hyphens; otherwise null (the web `undefined`, when neither id nor label is supplied).
 */
fun resolveSelectId(
    id: String?,
    label: String?,
): String? {
    val explicit = id?.takeIf { it.isNotBlank() }
    val slug =
        label
            ?.takeIf { it.isNotBlank() }
            ?.trim()
            ?.lowercase()
            ?.replace(Regex("\\s+"), "-")
    return explicit ?: slug
}

/** The id of the error paragraph for [selectId] (web `${selectId}-error`); null when there is no id. */
fun errorElementId(selectId: String?): String? = selectId?.let { "$it-error" }

/** The id of the hint paragraph for [selectId] (web `${selectId}-hint`); null when there is no id. */
fun hintElementId(selectId: String?): String? = selectId?.let { "$it-hint" }

/**
 * The `aria-describedby` target — the native mirror of web `error ? '${id}-error' : hint ? '${id}-hint' :
 * undefined`. The error paragraph wins when present; otherwise the hint paragraph; otherwise null.
 */
fun describedById(
    selectId: String?,
    hasError: Boolean,
    hasHint: Boolean,
): String? =
    when {
        hasError -> errorElementId(selectId)
        hasHint -> hintElementId(selectId)
        else -> null
    }

/** The hint is shown only when there is no error (web `hint && !error`). */
fun shouldShowHint(
    hasHint: Boolean,
    hasError: Boolean,
): Boolean = hasHint && !hasError

/**
 * Reduce the option list + selected value + empty-value label into the single thing the trigger paints — pure,
 * so the "selected vs empty-value label vs empty" precedence is asserted off-device. Precedence matches the web
 * source: the first option whose `value` equals [selectedValue] shows its label; otherwise a non-null
 * [emptyLabel] shows; otherwise the trigger is empty.
 */
fun resolveSelectDisplay(
    options: List<SelectOption>,
    selectedValue: String?,
    emptyLabel: String?,
): SelectDisplay {
    val selected = selectedValue?.let { value -> options.firstOrNull { it.value == value } }
    return when {
        selected != null -> SelectDisplay(selected.label, SelectDisplayKind.SelectedValue)
        emptyLabel != null -> SelectDisplay(emptyLabel, SelectDisplayKind.EmptyLabel)
        else -> SelectDisplay("", SelectDisplayKind.Empty)
    }
}

/**
 * Reduce the structural [input] into every render decision — the native mirror of the web component's
 * conditional renders. `showHelp` is gated on `showLabelRow` because the web nests `HelpIcon` inside the label
 * block; `showHint` is gated on `!hasError` (web `hint && !error`); `showEmptyMenu` lights up only when there
 * are no options but a caller `emptyMessage`, so the open menu is never a blank box; `canOpen` requires the
 * control to be enabled and to have something to show.
 */
fun classifySelect(input: SelectInput): SelectRenderModel {
    val showEmptyMenu = input.optionCount == 0 && input.hasEmptyMessage
    val canOpen = input.enabled && (input.optionCount > 0 || showEmptyMenu)
    return SelectRenderModel(
        showLabelRow = input.hasLabel,
        showHelp = input.hasLabel && input.hasHelp,
        showEmptyLabel = input.hasEmptyLabel,
        optionCount = input.optionCount,
        showEmptyMenu = showEmptyMenu,
        canOpen = canOpen,
        invalid = input.hasError,
        showError = input.hasError,
        showHint = shouldShowHint(hasHint = input.hasHint, hasError = input.hasError),
        required = input.required,
        enabled = input.enabled,
    )
}

/**
 * The PII-safe diagnostics this surface emits (P1/S11). The one `view.opened` event carries only the constant
 * surface [SLUG] — never the selected value, the label, the options, or any user data — so a diagnostics line
 * can never leak what is being selected. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object SelectDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = SELECT_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on every diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
