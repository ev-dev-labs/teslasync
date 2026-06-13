// Pure, framework-free model + derivations for the ActiveFilterChips shared surface — the native analogue of
// everything the web component computes (web/src/components/forms/ActiveFilterChips.tsx). No Compose, no Android
// UI, no networking: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// The web surface is a controlled, presentational summary of the active list-page filters. It is driven entirely
// by props (`filters`, `onClearAll`, `hideWhenEmpty`, `maxVisible`) plus one UI hook — `useTranslation` (the i18n
// facade, P1/S10). It performs NO data fetch. Its defining branches are the `hideWhenEmpty && isEmpty` early
// return (renders nothing with no active filters) and the `useMemo` visible/overflow split that collapses the
// tail of a long list behind a "+N more" trigger.
//
// State mapping onto the P3 loading / empty / content / error / stale / offline vocabulary (Honesty Covenant #9:
// documented, never silent — this is a controlled surface with no fetch, so several templated states do not exist
// in the web source and are reproduced as their faithful web behaviour rather than invented):
//   empty   => no active filters => [ChipsSurface.Hidden] when hideWhenEmpty (the web `return null`), or an
//              empty labelled group + live region when a host opts out of hiding (the web empty flex container).
//   content => one or more filters => [ChipsSurface.Visible]: the chip row, the optional "+N more" overflow
//              popover, and the optional "Clear all" affordance.
//   error / stale / offline / loading => not applicable to a controlled presentational surface with no data feed;
//              the parent page owns URL-state and any fetch reporting (web parity — there is no such branch).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path — exactly
// as the sibling BulkActionsToolbar / SavedViewMenu surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.activefilterchips

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, filter
 * value, or any user content, so a diagnostics line can never leak the operator's fleet state.
 */
const val ACTIVE_FILTER_CHIPS_SLUG: String = "ActiveFilterChips"

/** Default inline chip budget before the tail collapses into a "+N more" trigger — web `maxVisible = 8`. */
const val DEFAULT_MAX_VISIBLE: Int = 8

/** Default hide-when-empty behaviour — web `hideWhenEmpty = true` (renders nothing with no active filters). */
const val DEFAULT_HIDE_WHEN_EMPTY: Boolean = true

/** The zero-width space the live region pads with to force assistive tech to re-read an identical message. */
const val ZERO_WIDTH_SPACE: String = "\u200B"

/** The re-announce padding cycle — web `announceCounterRef.current % 4`. */
const val REANNOUNCE_MODULO: Int = 4

/**
 * The visible/overflow split of the active filters — the native port of the web `useMemo` (lines 107-121). The
 * tail beyond the inline budget collapses into [overflow], which the view surfaces behind a "+N more" popover.
 *
 * @property visible the chips rendered inline, in order.
 * @property overflow the chips collapsed into the "+N more" popover, in order.
 */
data class ChipPartition<T>(
    val visible: List<T>,
    val overflow: List<T>,
)

/**
 * Splits [filters] into the inline [ChipPartition.visible] set and the collapsed [ChipPartition.overflow] set for
 * an inline budget of [maxVisible] — a faithful port of the web `useMemo`:
 *  - `maxVisible <= 0` collapses everything into overflow (web reserves nothing inline).
 *  - `filters.size <= maxVisible` shows every chip inline with no overflow.
 *  - otherwise one inline slot is reserved for the "+N more" trigger, so `maxVisible - 1` chips stay inline and
 *    the remainder overflow.
 *
 * Pure and generic so the partition is unit-tested off-device without the view's descriptor type.
 */
fun <T> partitionChips(
    filters: List<T>,
    maxVisible: Int,
): ChipPartition<T> =
    when {
        maxVisible <= 0 -> ChipPartition(emptyList(), filters.toList())
        filters.size <= maxVisible -> ChipPartition(filters.toList(), emptyList())
        else -> {
            val visibleCount = maxOf(0, maxVisible - 1)
            ChipPartition(filters.take(visibleCount), filters.drop(visibleCount))
        }
    }

/**
 * The render-ready classification of the surface — a closed set the view switches on, so every branch is
 * exhaustively covered and unit-tested off-device. Reproduces the web `hideWhenEmpty && isEmpty ? null : <group>`
 * split.
 */
sealed interface ChipsSurface {
    /** No active filters and the host hides when empty — the surface renders nothing (web `return null`). */
    data object Hidden : ChipsSurface

    /** Render the labelled chip group (it may still be empty when a host opts out of hiding). */
    data object Visible : ChipsSurface
}

/**
 * Selects the render-ready [ChipsSurface] for a list of [filterCount] active filters. Pure: the view simply
 * early-returns on [ChipsSurface.Hidden]. When [hideWhenEmpty] is false the group is always shown so a host can
 * keep a stable layout slot (the web component's contract).
 */
fun chipsSurface(
    filterCount: Int,
    hideWhenEmpty: Boolean,
): ChipsSurface = if (hideWhenEmpty && filterCount == 0) ChipsSurface.Hidden else ChipsSurface.Visible

/**
 * The trailing zero-width padding for the live region on the [counter]-th announcement — web
 * `'\u200B'.repeat(announceCounterRef.current % 4)`. Appending a fresh, invisible suffix makes React/Compose emit
 * a new string so a screen-reader re-reads even an identical message (e.g. two removals of the same field name).
 * Uses [Int.mod] so a wrapped counter never yields a negative repeat count.
 */
fun reannouncePadding(counter: Int): String = ZERO_WIDTH_SPACE.repeat(counter.mod(REANNOUNCE_MODULO))

/**
 * The combined accessibility text for one chip from its already-localized [label] and [value] — the spoken form
 * of the web chip's "{label}: {value}" body. Pure so the per-chip a11y label is unit-tested without a Compose
 * host.
 */
fun chipContentDescription(
    label: String,
    value: String,
): String = "$label: $value"

/**
 * The complete inventory of i18n keys the web ActiveFilterChips references (every `t()` call), each mapped to its
 * Android catalog entry (P1/S10). The render boundary resolves these via `stringResource`; this list documents
 * the contract and is asserted complete + unique by the model test.
 *
 * - [REMOVED] → `R.string.translation_filters_removed` (the live-region removal announcement prefix).
 * - [CLEARED_ALL] → `R.string.translation_filters_clearedAll` (the live-region clear-all announcement).
 * - [ACTIVE_LABEL] → `R.string.translation_filters_activeLabel` (the chip group's region label).
 * - [MORE_COUNT] → `R.string.translation_filters_moreCount` (the "+{n} more" overflow trigger).
 * - [MORE_LABEL] → `R.string.translation_filters_moreLabel` (the overflow popover's menu label).
 * - [CLEAR_ALL] → `R.string.translation_filters_clearAll` (the "Clear all" affordance).
 * - [REMOVE_ARIA] → `R.string.translation_filters_removeAria` (each chip's "Remove filter {label}" a11y label).
 */
object ActiveFilterChipsKeys {
    const val REMOVED: String = "filters.removed"
    const val CLEARED_ALL: String = "filters.clearedAll"
    const val ACTIVE_LABEL: String = "filters.activeLabel"
    const val MORE_COUNT: String = "filters.moreCount"
    const val MORE_LABEL: String = "filters.moreLabel"
    const val CLEAR_ALL: String = "filters.clearAll"
    const val REMOVE_ARIA: String = "filters.removeAria"

    /** Every key the web source references, in source order. */
    val ALL: List<String> =
        listOf(REMOVED, CLEARED_ALL, ACTIVE_LABEL, MORE_COUNT, MORE_LABEL, CLEAR_ALL, REMOVE_ARIA)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11). Carries only the non-PII slug —
 * never a filter value or any user content — so a diagnostics line can never leak fleet state. Kept pure so the
 * diagnostics contract is unit-tested off-device; the view-model guards it to once per holder.
 */
fun recordActiveFilterChipsViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("slug" to ACTIVE_FILTER_CHIPS_SLUG))
}
