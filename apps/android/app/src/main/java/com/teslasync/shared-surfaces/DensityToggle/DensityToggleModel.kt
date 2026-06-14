// Pure, framework-free model + projection + keyboard logic + diagnostics for the DensityToggle shared surface —
// the native analogue of every decision the web component makes (web/src/components/forms/DensityToggle.tsx)
// before it returns JSX. No Compose, no Android UI, no networking: every declaration here is exercised off-device
// by the :android:testReleaseUnitTest gate, keeping the composable a thin render layer (ADR-002).
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a controlled,
// presentational three-way Table / Compact / Comfortable selector for list pages, implementing the WAI-ARIA
// radiogroup pattern. It is driven entirely by props (`value`, `onChange`, `options`, `className`, `testId`,
// `ariaLabel`) plus ONE UI hook — `useTranslation` (the i18n facade, P1/S10). It performs NO data fetch. Its own
// logic is: deriving the per-option label + accessible group name, marking which option is selected, and the
// ArrowLeft/ArrowRight key handler that cycles + commits the selection (web `onKeyDown`). Each of those is
// reproduced here by [DensityToggleProjection] and [DensityToggleKeyboard] so the view simply reads the result.
//
// State mapping onto the P3 loading / empty / content / error / stale / offline vocabulary (Honesty Covenant #9:
// documented, never silent — a controlled surface with no feed, so several templated states have no web branch
// and are reproduced as their faithful web behaviour rather than invented):
//   content => one or more density options => the segmented selector with the active option highlighted
//              (the web render). Classified by [DensityToggleRender.hasOptions].
//   empty   => an empty `options` array => the control still renders, never a blank box: the view shows a
//              localized empty caption. The web renders an empty radiogroup; the prompt's "friendly empty state"
//              contract upgrades that to a labelled caption. Classified by [DensityToggleRender.isEmpty].
//   loading / error / stale / offline => not applicable to a controlled presentational selector with no data
//              feed; the parent list page owns URL/list state and any fetch reporting (web parity — no branch).
//
// The web `t()` keys (`density.table` / `density.compact` / `density.comfortable` / `density.groupLabel`) are NOT
// present in the generated i18n catalog (the web relies on react-i18next's default-value fallback), so this
// surface resolves them by-name through the i18n facade with the English [DensityToggleDefaults] fallbacks — the
// native mirror of i18next `t(key, default)` via [resolveOptional], exactly like the sibling Accordion surface.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/DensityToggle — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling Accordion / SortControl / Toggle surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.densitytoggle

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no selected value — only this
 * constant identifier — so a diagnostics line can never leak which density the operator picked.
 */
const val DENSITY_TOGGLE_SLUG: String = "DensityToggle"

/**
 * The list-display density — the native mirror of the web `Density = 'comfortable' | 'compact' | 'table'`. Each
 * entry carries its stable wire [id] (the web string union member) so callers can persist the choice in a URL
 * param / settings document and round-trip it through [fromId], matching the web's string-keyed `options` array.
 * Declared in the web `DEFAULT_OPTIONS` order (table, compact, comfortable) so [entries] is the canonical order.
 */
enum class Density(
    val id: String,
) {
    Table("table"),
    Compact("compact"),
    Comfortable("comfortable"),
    ;

    companion object {
        /** Parse a wire [id] back into a [Density], or `null` when it is unknown (web `options.indexOf` miss). */
        fun fromId(id: String): Density? = entries.firstOrNull { it.id == id }
    }
}

/**
 * The default option set, in canonical order — the native mirror of the web
 * `DEFAULT_OPTIONS = ['table', 'compact', 'comfortable']`. Callers may pass a subset to hide options a page does
 * not support (web `options` prop), e.g. a page without a table view passes only compact + comfortable.
 */
val DEFAULT_DENSITY_OPTIONS: List<Density> = listOf(Density.Table, Density.Compact, Density.Comfortable)

/**
 * The English fallbacks used when the (absent) `translation_density_*` catalog keys miss — the native mirror of
 * the default argument each web `t(key, default)` call supplies. [GROUP_LABEL] is the radiogroup's accessible
 * name; [NO_OPTIONS] is the native-only empty caption (the web has no such branch — it renders an empty group).
 */
object DensityToggleDefaults {
    /** Label for the table density option (web `t('density.table', 'Table')`). */
    const val TABLE: String = "Table"

    /** Label for the compact density option (web `t('density.compact', 'Compact')`). */
    const val COMPACT: String = "Compact"

    /** Label for the comfortable density option (web `t('density.comfortable', 'Comfortable')`). */
    const val COMFORTABLE: String = "Comfortable"

    /** Accessible name for the radiogroup (web `t('density.groupLabel', 'List density')`). */
    const val GROUP_LABEL: String = "List density"

    /** Native-only empty caption shown when the caller passes an empty option set (web has no empty branch). */
    const val NO_OPTIONS: String = "No density options"
}

/** Resource name for the table label (by-name; absent ⇒ the English default). Web key `density.table`. */
const val KEY_DENSITY_TABLE: String = "translation_density_table"

/** Resource name for the compact label (by-name; absent ⇒ default). Web key `density.compact`. */
const val KEY_DENSITY_COMPACT: String = "translation_density_compact"

/** Resource name for the comfortable label (by-name; absent ⇒ default). Web key `density.comfortable`. */
const val KEY_DENSITY_COMFORTABLE: String = "translation_density_comfortable"

/** Resource name for the group label (by-name; absent ⇒ default). Web key `density.groupLabel`. */
const val KEY_DENSITY_GROUP_LABEL: String = "translation_density_groupLabel"

/** Resource name for the native-only empty caption (by-name; absent ⇒ default). No web key — native addition. */
const val KEY_DENSITY_NO_OPTIONS: String = "translation_density_noOptions"

/**
 * The complete inventory of i18n keys the web DensityToggle references (every `t()` call), each in the web's
 * dotted form. The render boundary resolves these by-name (P1/S10); this list documents the contract and is
 * asserted complete + unique by the model test. The native-only empty caption ([KEY_DENSITY_NO_OPTIONS]) is not
 * a web key and is intentionally excluded.
 */
object DensityToggleKeys {
    const val TABLE: String = "density.table"
    const val COMPACT: String = "density.compact"
    const val COMFORTABLE: String = "density.comfortable"
    const val GROUP_LABEL: String = "density.groupLabel"

    /** Every key the web source references, in source order. */
    val ALL: List<String> = listOf(TABLE, COMPACT, COMFORTABLE, GROUP_LABEL)
}

/**
 * The localized strings the surface folds into its output, resolved at the render boundary (tests pass a
 * deterministic instance) so [DensityToggleProjection] stays a pure, locale-stable function. Each label maps 1:1
 * to a web `t()` call; [noOptions] backs the native empty caption.
 *
 * @property table the table density label (web `density.table`).
 * @property compact the compact density label (web `density.compact`).
 * @property comfortable the comfortable density label (web `density.comfortable`).
 * @property groupLabel the radiogroup accessible name (web `density.groupLabel`).
 * @property noOptions the native-only empty caption shown when there are no options.
 */
data class DensityToggleStrings(
    val table: String,
    val compact: String,
    val comfortable: String,
    val groupLabel: String,
    val noOptions: String,
) {
    /** The localized label for a [density] — the native mirror of the web `labelMap[opt]` lookup. */
    fun label(density: Density): String =
        when (density) {
            Density.Table -> table
            Density.Compact -> compact
            Density.Comfortable -> comfortable
        }
}

/**
 * One render-ready option — a [density], its localized [label], and whether it is the active selection. The
 * native mirror of the web per-`opt` `{ Icon, selected, label }` derivation inside the `options.map`.
 *
 * @property density the option's density value (web `opt`).
 * @property label the option's localized label (web `labelMap[opt]`).
 * @property selected whether this option equals the controlled value (web `opt === value`).
 */
data class DensityOption(
    val density: Density,
    val label: String,
    val selected: Boolean,
)

/**
 * The immutable, render-ready projection the composable draws — everything the web `DensityToggle` derives from
 * its props + `useTranslation`: the radiogroup accessible name, the per-option label + selected flag in caller
 * order, and the currently selected density (or `null` when the value is not among the options). Pure data so
 * [DensityToggleProjection] is unit-tested without a UI host.
 *
 * @property groupLabel the radiogroup accessible name (web `ariaLabel ?? t('density.groupLabel', …)`).
 * @property options the render-ready options in caller order (web `options.map(...)`).
 * @property selected the option equal to the controlled value, or `null` when it is not present.
 */
data class DensityToggleRender(
    val groupLabel: String,
    val options: List<DensityOption>,
    val selected: Density?,
) {
    /** True when there is at least one option to choose — drives the content vs empty classification. */
    val hasOptions: Boolean get() = options.isNotEmpty()

    /** True when the caller passed no options — the view shows the empty caption, never a blank box. */
    val isEmpty: Boolean get() = options.isEmpty()
}

/** Pure projection logic for the DensityToggle surface — the native port of the web component's derivations. */
object DensityToggleProjection {
    /**
     * Fold the controlled props ([value], [options]) + the localized [strings] (and the optional [ariaLabel]
     * override) into the render-ready [DensityToggleRender] the composable draws. The group name prefers a
     * non-blank [ariaLabel] (web `ariaLabel ?? t(...)`); each option carries its localized label and whether it
     * is the active selection (web `opt === value`). Pure: the view only reads the projected fields.
     */
    fun project(
        value: Density,
        options: List<Density>,
        strings: DensityToggleStrings,
        ariaLabel: String? = null,
    ): DensityToggleRender =
        DensityToggleRender(
            groupLabel = ariaLabel?.takeIf { it.isNotBlank() } ?: strings.groupLabel,
            options =
                options.map { density ->
                    DensityOption(density = density, label = strings.label(density), selected = density == value)
                },
            selected = options.firstOrNull { it == value },
        )
}

/** A horizontal arrow key — the two keys the web `onKeyDown` acts on (ArrowLeft / ArrowRight). */
enum class DensityToggleKey { ArrowLeft, ArrowRight }

/** Pure keyboard navigation — the native port of the web radiogroup's ArrowLeft/ArrowRight commit behaviour. */
object DensityToggleKeyboard {
    /**
     * The next density to commit for a horizontal arrow [key] — the native mirror of the web `onKeyDown`: from
     * the [current] option's index in [options], ArrowRight moves to the next and ArrowLeft to the previous,
     * wrapping cyclically (web `(idx ± 1 + len) % len`). Returns `null` when [current] is not among [options]
     * (the web `if (idx < 0) return`), which also covers an empty option set. Pure, so the wrap arithmetic is
     * unit-tested off-device.
     */
    fun next(
        options: List<Density>,
        current: Density,
        key: DensityToggleKey,
    ): Density? {
        val index = options.indexOf(current)
        return if (index < 0) {
            null
        } else {
            val size = options.size
            val target =
                when (key) {
                    DensityToggleKey.ArrowRight -> (index + 1) % size
                    DensityToggleKey.ArrowLeft -> (index - 1 + size) % size
                }
            options[target]
        }
    }
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests, so
 * the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * The PII-safe diagnostics this surface emits (P1/S11). The one `view.opened` event carries only the constant
 * surface [SLUG] — never the selected density or any user data — so a diagnostics line can never leak the
 * operator's choice. Kept free of Compose so the contract is unit-tested with a recording [Logger].
 */
object DensityToggleDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = DENSITY_TOGGLE_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on the diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the
     * composable's first-composition effect; the surface guards it to once per placement.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}

/**
 * Canonical registry metadata for the DensityToggle surface. The diagnostics [SLUG] is the surface slug the
 * prompt mandates (`DensityToggle`); [ID] is the stable kebab-case id the composable also stamps as its root
 * test tag.
 */
object DensityToggleRegistration {
    /** Stable surface id (kebab-case), also the default root test tag the composable stamps on its row. */
    const val ID: String = "density-toggle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = DENSITY_TOGGLE_SLUG
}
