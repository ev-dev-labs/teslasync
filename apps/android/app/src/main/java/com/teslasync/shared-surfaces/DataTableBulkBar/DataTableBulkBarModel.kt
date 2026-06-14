// Pure, framework-free model + classifier + diagnostics for the DataTableBulkBar shared surface — the native
// analogue of everything the web component derives (web/src/components/ui/DataTableBulkBar.tsx). No Compose, no
// Android UI, no networking: every declaration here is exercised off-device by the :app:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// The web surface is a controlled, presentational selection toolbar shown above a data table when one or more
// rows are selected. It is driven entirely by props (`count`, `onClear`, `children`, `className`) plus one UI
// hook — `useTranslation` (the i18n facade, P1/S10). It performs NO data fetch. Its defining branch is
// `if (count <= 0) return null` — it renders nothing with no selection — and otherwise it shows a polite-live
// "{{count}} selected" label, a consumer-supplied bulk-action slot, and a ghost "Clear selection" button.
//
// State mapping onto the P3 loading / empty / content / error / stale / offline vocabulary (Honesty Covenant #9:
// documented, never silent — this is a controlled surface with no fetch, so several templated states do not exist
// in the web source and are reproduced as their faithful web behaviour rather than invented):
//   empty   => no selection => [BulkBarSurface.Hidden] (the web `count <= 0` null render).
//   content => a selection exists => [BulkBarSurface.Visible] (the bar chrome).
//   loading / error / stale / offline => not applicable to a controlled presentational surface with no data feed.
//     The count label is a declarative polite live region, not an imperative announcer, so there is no
//     interaction seam to abstract (hence no Source file, unlike the data-bound BulkActionsToolbar /
//     ActiveFilterChips siblings).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a
// hyphen is illegal in a package identifier), so the package intentionally diverges from the path — exactly as
// the sibling BulkActionsToolbar / ActiveFilterChips surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatablebulkbar

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, selection
 * id, or any user content, so a diagnostics line can never leak the operator's fleet state.
 */
const val DATA_TABLE_BULK_BAR_SLUG: String = "DataTableBulkBar"

/**
 * The render-ready classification of the bulk bar — a closed set the view switches on, so every branch is
 * exhaustively covered and unit-tested off-device. Reproduces the web `count <= 0 ? null : <bar>` split.
 */
sealed interface BulkBarSurface {
    /** No selection — the bar renders nothing (web `if (count <= 0) return null`). */
    data object Hidden : BulkBarSurface

    /**
     * A selection exists — render the bar chrome.
     *
     * @property count the number of selected rows (web `count`).
     */
    data class Visible(
        val count: Int,
    ) : BulkBarSurface
}

/**
 * Selects the render-ready [BulkBarSurface] for a selection of [count] rows. Pure: the view simply early-returns
 * on [BulkBarSurface.Hidden]. A zero or negative count collapses the surface, so a consumer can always mount the
 * bar unconditionally (the web component's contract).
 */
fun classifyBulkBar(count: Int): BulkBarSurface = if (count <= 0) BulkBarSurface.Hidden else BulkBarSurface.Visible(count)

/**
 * The complete inventory of i18n keys the web DataTableBulkBar references (every `t()` call + every `aria-label`),
 * each mapped to its Android catalog entry (P1/S10). The render boundary resolves these via `stringResource`;
 * this list documents the contract and is asserted complete + unique by the model test.
 *
 * - [REGION] -> `R.string.translation_table_bulkActions_region` (the region aria-label / TalkBack landmark).
 * - [SELECTED] -> `R.string.translation_table_bulkActions_selected` (the polite-live "{{count}} selected" label).
 * - [CLEAR] -> `R.string.translation_table_bulkActions_clear` (the ghost clear button label + aria-label).
 */
object DataTableBulkBarKeys {
    const val REGION: String = "table.bulkActions.region"
    const val SELECTED: String = "table.bulkActions.selected"
    const val CLEAR: String = "table.bulkActions.clear"

    /** Every key the web source references, in source order. */
    val ALL: List<String> = listOf(REGION, SELECTED, CLEAR)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11). Carries only the non-PII slug —
 * never a selection id or any user content — so a diagnostics line can never leak fleet state. Kept pure so the
 * diagnostics contract is unit-tested off-device; the view-model guards it to once per holder.
 */
fun recordDataTableBulkBarViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("slug" to DATA_TABLE_BULK_BAR_SLUG))
}
