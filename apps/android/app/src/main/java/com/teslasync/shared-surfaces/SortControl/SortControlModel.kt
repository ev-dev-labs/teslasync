// Pure, framework-free model + projection for the SortControl shared surface — the native analogue of everything
// the web component derives before it returns JSX (web/src/components/forms/SortControl.tsx). No Compose, no
// Android UI, no networking: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// The web surface is a controlled, presentational sort control: a field [Select] beside a direction-toggle
// button whose arrow reflects the current direction. It is driven entirely by props (`field`, `direction`,
// `options`, `onFieldChange`, `onDirectionChange`, `className`, `testId`, `directionAriaLabel`) plus ONE UI hook
// — `useTranslation` (the i18n facade, P1/S10). It performs NO data fetch. Its only own logic is the direction
// `flip` (asc ⇄ desc) and the derived direction label ("Ascending" / "Descending") that the button announces.
//
// State mapping onto the P3 loading / empty / content / error / stale / offline vocabulary (Honesty Covenant #9:
// documented, never silent — this is a controlled surface with no feed, so several templated states do not exist
// in the web source and are reproduced as their faithful web behaviour rather than invented):
//   content => one or more sort options => the field Select + the direction toggle (the web render).
//   empty   => no options => the control still renders (never a blank box): the Select is disabled and shows its
//              `fieldLabel` empty text, the direction toggle stays usable — the natural render of an empty web
//              `options` array, made accessible. Classified by [SortControlDisplay.isEmpty].
//   loading / error / stale / offline => not applicable to a controlled presentational surface with no data feed;
//              the parent list page owns URL/list state and any fetch reporting (web parity — no such branch).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/SortControl — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling ActiveFilterChips / SectionErrorBoundary surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.sortcontrol

import io.teslasync.android.components.forms.SortOption
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no field name, option label, or
 * any user content — only this constant identifier — so a diagnostics line can never leak the operator's list
 * state.
 */
const val SORT_CONTROL_SLUG: String = "SortControl"

/**
 * The four localized strings the surface folds into its output, resolved from `stringResource` at the render
 * boundary (tests pass a deterministic instance) so [SortControlProjection] stays a pure, locale-stable function.
 * Each maps 1:1 to a web `t()` call and a P1/S10 catalog key (see [SortControlKeys]).
 *
 * @property ascending the ascending direction label (web `sortControl.ascending`, "Ascending").
 * @property descending the descending direction label (web `sortControl.descending`, "Descending").
 * @property fieldLabel the field Select's accessible name (web `sortControl.fieldLabel`, "Sort by").
 * @property direction the direction button's accessible-name prefix (web `sortControl.direction`, "Sort direction").
 */
data class SortControlStrings(
    val ascending: String,
    val descending: String,
    val fieldLabel: String,
    val direction: String,
)

/**
 * The complete inventory of i18n keys the web SortControl references (every `t()` call), each mapped to its
 * Android catalog entry (P1/S10). The render boundary resolves these via `stringResource`; this list documents the
 * contract and is asserted complete + unique by the model test.
 *
 * - [ASCENDING] → `R.string.translation_sortControl_ascending` (the ascending direction label).
 * - [DESCENDING] → `R.string.translation_sortControl_descending` (the descending direction label).
 * - [FIELD_LABEL] → `R.string.translation_sortControl_fieldLabel` (the field Select's accessible name).
 * - [DIRECTION] → `R.string.translation_sortControl_direction` (the direction button's accessible-name prefix).
 */
object SortControlKeys {
    const val ASCENDING: String = "sortControl.ascending"
    const val DESCENDING: String = "sortControl.descending"
    const val FIELD_LABEL: String = "sortControl.fieldLabel"
    const val DIRECTION: String = "sortControl.direction"

    /** Every key the web source references, in source order. */
    val ALL: List<String> = listOf(ASCENDING, DESCENDING, FIELD_LABEL, DIRECTION)
}

/**
 * The immutable, render-ready projection the composable draws — everything the web `SortControl` derives from its
 * props + `useTranslation`: which arrow to show ([isAscending]), the direction [directionLabel] the button's
 * tooltip carries, the merged [directionContentDescription] the button announces (web
 * `directionAriaLabel ?? "${direction}: ${dirLabel}"`), the field's accessible name ([fieldLabel]), the options
 * mapped to the shared Select's [selectOptions], the currently [selectedOption], and whether there are options to
 * pick ([hasOptions]). Pure data so [SortControlProjection] is unit-tested without a UI host.
 *
 * @property selectedField the currently selected sort field key (web `field`).
 * @property isAscending true when the direction is ascending — selects the up arrow (web `direction === 'asc'`).
 * @property directionLabel the localized current-direction word, "Ascending" / "Descending" (web `dirLabel`).
 * @property directionContentDescription the direction button's full accessible name (web button `aria-label`).
 * @property fieldLabel the field Select's accessible name, "Sort by" (web Select `aria-label`).
 * @property options the sort options in caller order (web `options`).
 * @property selectOptions [options] mapped onto the shared [SelectOption] the field dropdown renders.
 * @property selectedOption the option whose value equals [selectedField], or `null` (an unknown/cleared field).
 * @property hasOptions whether there is at least one option to sort by (drives the empty-state classification).
 */
data class SortControlDisplay(
    val selectedField: String,
    val isAscending: Boolean,
    val directionLabel: String,
    val directionContentDescription: String,
    val fieldLabel: String,
    val options: List<SortOption>,
    val selectOptions: List<SelectOption>,
    val selectedOption: SortOption?,
    val hasOptions: Boolean,
) {
    /** True when there are no options to sort by — the surface renders the disabled, labelled empty control. */
    val isEmpty: Boolean get() = !hasOptions
}

/** Pure projection + selection logic for the SortControl surface — the native port of the web component's derivations. */
object SortControlProjection {
    /** The localized current-direction word — web `direction === 'asc' ? t(ascending) : t(descending)`. */
    fun directionLabel(
        direction: SortDirection,
        strings: SortControlStrings,
    ): String = if (direction == SortDirection.Asc) strings.ascending else strings.descending

    /**
     * The direction button's full accessible name — web `directionAriaLabel ?? "${t(direction)}: ${dirLabel}"`. A
     * caller-supplied [override] wins verbatim (the web nullish-coalescing on `directionAriaLabel`); otherwise the
     * localized "{direction}: {label}" form is built, e.g. "Sort direction: Ascending".
     */
    fun directionContentDescription(
        direction: SortDirection,
        strings: SortControlStrings,
        override: String?,
    ): String = override ?: "${strings.direction}: ${directionLabel(direction, strings)}"

    /**
     * Folds the controlled props ([field], [direction], [options]) + the localized [strings] (and the optional
     * [directionOverride]) into the render-ready [SortControlDisplay] the composable draws. Pure: the view simply
     * reads the projected fields, so every branch is unit-tested off-device without a Compose host.
     */
    fun project(
        field: String,
        direction: SortDirection,
        options: List<SortOption>,
        strings: SortControlStrings,
        directionOverride: String? = null,
    ): SortControlDisplay =
        SortControlDisplay(
            selectedField = field,
            isAscending = direction == SortDirection.Asc,
            directionLabel = directionLabel(direction, strings),
            directionContentDescription = directionContentDescription(direction, strings, directionOverride),
            fieldLabel = strings.fieldLabel,
            options = options,
            selectOptions = options.map { SelectOption(value = it.value, label = it.label) },
            selectedOption = options.firstOrNull { it.value == field },
            hasOptions = options.isNotEmpty(),
        )
}

/**
 * The PII-safe diagnostics this surface emits (P1/S11). The one `view.opened` event carries only the constant
 * surface [SLUG] — never a field key, option label, or any user content — so a diagnostics line can never leak the
 * operator's list state. Kept free of Compose so the diagnostics contract is unit-tested with a recording [Logger].
 */
object SortControlDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = SORT_CONTROL_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on the diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the composable's
     * first-composition effect; the surface guards it to once per placement.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
