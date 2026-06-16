// The state holder backing the AutomationListPage surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query bindings (web/src/features/automations/pages/AutomationListPage.tsx). It owns
// the page's local interaction state — the bulk-selection set (web `useBulkSelection`) and which bulk operation
// is in flight (web's per-action `pending`) — projects the single cache-then-network list read
// (`GET /automations`, web `useAutomations`) onto the shared lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState], and orchestrates the allowlisted bulk mutation (web
// `useBulkAutomationsUpdate`) off the UI thread. All derivation logic lives in the framework-free model
// (AutomationListPageModel.kt); this holder performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations.list

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.automations.Automation
import io.teslasync.shared.core.presentation.automations.AutomationBulkOp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.automations.AutomationsStore]
 *   adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the bulk outcomes.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AutomationListPageViewModel(
    private val source: AutomationListSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableSelectedIds = MutableStateFlow<Set<Long>>(emptySet())
    private val mutableBulkPending = MutableStateFlow<AutomationBulkOp?>(null)
    private var viewOpenedRecorded = false

    /**
     * The automation list as cache-then-network UI state (loading / content / empty / stale / offline / error).
     * The empty predicate is the model's "no rows" guard (web `automations.length === 0`), so a list with at
     * least one automation resolves to content (the table) rather than the empty panel. A successful bulk
     * mutation refreshes the shared list feed, which re-emits here, so the table self-updates with no manual
     * reload.
     */
    val state: StateFlow<UiState<List<Automation>>> =
        source.automations().asUiState(isEmpty = { it.isEmptyList })

    /** The currently-selected automation ids (web `useBulkSelection().selectedIds`). */
    val selectedIds: StateFlow<Set<Long>> = mutableSelectedIds.asStateFlow()

    /** Which bulk operation is currently running, or `null` when idle (web per-action `pending`). */
    val bulkPending: StateFlow<AutomationBulkOp?> = mutableBulkPending.asStateFlow()

    // ── Selection (web `useBulkSelection` — toggle / master toggle / clear) ───────────────────────────────────

    /** Flip a single id between selected / not (web `sel.toggle(id)`). */
    fun toggle(id: Long): Unit =
        mutableSelectedIds.update { current ->
            if (id in current) current - id else current + id
        }

    /**
     * Master-checkbox toggle (web `sel.toggleAll(visibleIds)`): if every visible id is currently selected,
     * deselect them all; otherwise select every visible id. Ids outside the visible slice are untouched.
     */
    fun toggleAll(visibleIds: List<Long>) {
        if (visibleIds.isEmpty()) return
        mutableSelectedIds.update { current ->
            if (visibleIds.all { it in current }) current - visibleIds.toSet() else current + visibleIds
        }
    }

    /** Drop every selection (web `sel.clear()`, the toolbar's Clear button + post-mutation reset). */
    fun clearSelection(): Unit = mutableSelectedIds.update { emptySet() }

    // ── Bulk mutation (web `useBulkAutomationsUpdate` — enable / disable / delete) ─────────────────────────────

    /**
     * Runs the allowlisted bulk [op] over the current selection off the UI thread (web `bulkUpdate.mutateAsync`).
     * A second op while one is already in flight is ignored (web disabled controls). On success the selection is
     * cleared (web `await … ; sel.clear()`) and the shared store refreshes the list feed; on failure the
     * selection is kept intact so the user can retry (web throwing leaves the selection).
     */
    fun runBulk(op: AutomationBulkOp) {
        if (mutableBulkPending.value != null) return
        val ids = mutableSelectedIds.value.toList()
        if (ids.isEmpty()) return
        launch {
            mutableBulkPending.update { op }
            source
                .bulkUpdate(ids, op)
                .onSuccess {
                    logger.info("automationList.bulk.applied", mapOf("op" to op.wire))
                    clearSelection()
                }
                .onFailure { logger.warn("automationList.bulk.failed", mapOf("op" to op.wire)) }
            mutableBulkPending.update { null }
        }
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAutomationListPageOpened(logger)
    }
}
