// Pure, framework-free model + reducers + surface classifier for the BulkActionsToolbar shared surface — the
// native analogue of everything the web component derives (web/src/components/data-display/BulkActionsToolbar.tsx).
// No Compose, no Android UI, no networking: every declaration here is exercised off-device by the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web surface is a controlled, presentational selection toolbar. It is driven entirely by props
// (`selectedIds`, `total`, `actions`, `onClear`, `itemNoun`) plus two UI hooks — `useTranslation` (the i18n
// facade, P1/S10) and `useConfirm` (the confirm controller, modelled by BulkActionsToolbarSource). It performs
// NO data fetch. Its defining branch is `if (count === 0) return null` — it renders nothing with no selection.
//
// State mapping onto the P3 loading / empty / content / error / stale / offline vocabulary (Honesty Covenant
// #9: documented, never silent — this is a controlled surface with no fetch, so several templated states do not
// exist in the web source and are reproduced as their faithful web behaviour rather than invented):
//   empty   => no selection => [ToolbarSurface.Hidden] (the web `count === 0` null render).
//   content => a selection exists => [ToolbarSurface.Visible] (the toolbar chrome).
//   loading => a per-action in-flight spinner (web `pending[action.id]`), tracked in [BulkActionsUiState].
//   error   => a failed action re-enables for retry (web clears `pending`, keeps the selection); the web
//              source renders no dedicated error surface because there is no fetch — the parent owns reporting.
//   stale / offline => not applicable to a controlled presentational surface with no data feed.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path — exactly
// as the sibling AIAnomalyExplanations / AIVoiceMode surfaces do. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.bulkactionstoolbar

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id, selection
 * id, or any user content, so a diagnostics line can never leak the operator's fleet state.
 */
const val BULK_ACTIONS_TOOLBAR_SLUG: String = "BulkActionsToolbar"

/** Visual intent of a bulk action — web `variant?: 'default' | 'danger'`. */
enum class BulkActionIntent {
    /** The ordinary, non-destructive action (web default — a secondary button). */
    Default,

    /** A destructive action (web `danger` — a danger button + a destructive confirm). */
    Danger,
}

/** Confirmation styling, mirroring the shared `ConfirmDialog` severities. */
enum class BulkConfirmSeverity {
    /** Destructive confirmation (web `variant === 'danger' ? 'danger'`). */
    Danger,

    /** Cautionary confirmation (web non-danger actions → `'warning'`). */
    Warning,
}

/**
 * The already-localized confirmation copy a [BulkActionIntent] may carry — the native analogue of the web
 * `BulkAction.confirm` payload (`{ title, description, confirmLabel? }`). Strings are supplied already
 * translated by the consumer (the web consumer passes translated strings too); [confirmLabel] is optional and
 * falls back to the shared "Confirm" label at the render boundary.
 *
 * @property title the confirm dialog title.
 * @property description the confirm dialog body.
 * @property confirmLabel the confirm-button label, or `null` to use the shared default.
 */
data class BulkConfirmCopy(
    val title: String,
    val description: String,
    val confirmLabel: String? = null,
)

/**
 * The two display nouns a consumer may supply to label the selection count — web `itemNoun?: { one; other }`.
 * Both strings are already localized. [forCount] applies the web `count === 1 ? one : other` rule.
 */
data class BulkItemNoun(
    val one: String,
    val other: String,
) {
    /** The noun for [count] — web `count === 1 ? itemNoun.one : itemNoun.other`. */
    fun forCount(count: Int): String = if (count == 1) one else other
}

/**
 * The immutable toolbar reducer state the [BulkActionsToolbarViewModel] exposes — the per-action in-flight set
 * (web `pending: Record<string, boolean>`). A separate `pending` flag per action drives each button's busy
 * spinner without the consumer wiring one, exactly as the web toolbar keeps the pending map local.
 *
 * @property pending the ids of actions whose `onClick` is currently in flight.
 */
data class BulkActionsUiState(
    val pending: Set<String> = emptySet(),
) {
    /** Whether the action [id] is currently in flight (web `Boolean(pending[id])`). */
    fun isPending(id: String): Boolean = id in pending

    /** Marks the action [id] in flight — web `setPending(prev => ({ ...prev, [id]: true }))`. */
    fun startPending(id: String): BulkActionsUiState = copy(pending = pending + id)

    /** Clears the action [id]'s in-flight flag — web `delete next[id]` in the `finally`. */
    fun endPending(id: String): BulkActionsUiState = copy(pending = pending - id)
}

/**
 * The render-ready classification of the toolbar — a closed set the view switches on, so every branch is
 * exhaustively covered and unit-tested off-device. Reproduces the web `count === 0 ? null : <toolbar>` split.
 */
sealed interface ToolbarSurface {
    /** No selection — the toolbar renders nothing (web `if (count === 0) return null`). */
    data object Hidden : ToolbarSurface

    /**
     * A selection exists — render the toolbar chrome.
     *
     * @property count the number of selected rows (web `selectedIds.length`).
     * @property total the total visible rows for the "of {total}" suffix, or `null`.
     */
    data class Visible(
        val count: Int,
        val total: Int?,
    ) : ToolbarSurface
}

/**
 * Selects the render-ready [ToolbarSurface] for a selection of [selectedCount] over an optional [total]. Pure:
 * the view simply early-returns on [ToolbarSurface.Hidden]. A zero or negative count collapses the surface, so
 * a consumer can always mount the toolbar unconditionally (the web component's contract).
 */
fun classifyToolbar(
    selectedCount: Int,
    total: Int?,
): ToolbarSurface = if (selectedCount <= 0) ToolbarSurface.Hidden else ToolbarSurface.Visible(selectedCount, total)

/** Maps a [BulkActionIntent] to its confirm severity — web `variant === 'danger' ? 'danger' : 'warning'`. */
fun confirmSeverityFor(intent: BulkActionIntent): BulkConfirmSeverity =
    if (intent == BulkActionIntent.Danger) BulkConfirmSeverity.Danger else BulkConfirmSeverity.Warning

/**
 * Builds the accessibility description for one action button from already-localized parts: the plain [label]
 * when idle, or "{label}, {busyLabel}" while the action is in flight so TalkBack announces the spinner the web
 * button shows. Pure so the per-state a11y label is unit-tested without a Compose host.
 */
fun actionContentDescription(
    label: String,
    busy: Boolean,
    busyLabel: String,
): String = if (busy) "$label, $busyLabel" else label

/**
 * The complete inventory of i18n keys the web BulkActionsToolbar references (every `t()` call), each mapped to
 * its Android catalog entry (P1/S10). The render boundary resolves these via `stringResource` / the plural
 * resources; this list documents the contract and is asserted complete + unique by the model test.
 *
 * - [TOOLBAR_LABEL] → `R.string.translation_bulk_toolbarLabel` (the region aria-label).
 * - [CLEAR] → `R.string.translation_bulk_clear` (the ghost clear button).
 * - [SELECTED] → `R.plurals.translation_bulk_selected` (the live "{n} selected" chip).
 * - [OF_TOTAL] → `R.string.translation_bulk_ofTotal` (the "of {total}" suffix).
 * - [ITEM_DEFAULT] → `R.plurals.translation_bulk_itemDefault` (the web default noun; the toolbar shows a noun
 *   only when an explicit [BulkItemNoun] is supplied, faithfully reproducing the web render).
 */
object BulkActionsToolbarKeys {
    const val TOOLBAR_LABEL: String = "bulk.toolbarLabel"
    const val CLEAR: String = "bulk.clear"
    const val SELECTED: String = "bulk.selected"
    const val OF_TOTAL: String = "bulk.ofTotal"
    const val ITEM_DEFAULT: String = "bulk.itemDefault"

    /** Every key the web source references, in source order. */
    val ALL: List<String> = listOf(TOOLBAR_LABEL, CLEAR, SELECTED, OF_TOTAL, ITEM_DEFAULT)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11). Carries only the non-PII
 * slug — never a selection id or any user content — so a diagnostics line can never leak fleet state. Kept pure
 * so the diagnostics contract is unit-tested off-device; the view-model guards it to once per holder.
 */
fun recordBulkActionsToolbarViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("slug" to BULK_ACTIONS_TOOLBAR_SLUG))
}
