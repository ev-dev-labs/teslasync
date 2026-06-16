// The state holder backing the ExportsPage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hooks (web/src/features/exports/pages/ExportsPage.tsx). It owns the page's local
// bulk-selection state as an immutable [ExportsInteraction] snapshot (the web `useBulkSelection` useState),
// projects the single cache-then-network jobs read (`useExportJobs`) onto the shared lifecycle-aware [UiState]
// surface via [BaseFeedViewModel.asUiState], and runs the one bulk-delete mutation (`useBulkExportsDelete`). The
// jobs feed re-collects whenever the refresh trigger bumps (the web query `refetch` / the error-retry +
// post-delete invalidation). All derivation logic lives in the framework-free model (ExportsPageModel.kt); this
// holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/exports) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.exports.exports

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * The page's local interaction snapshot — the bulk-selection set the web component holds in `useBulkSelection`.
 * Immutable so the composable reads a single source; [selectedIds] is the set of selected job ids (web
 * `sel.selectedIds`).
 */
data class ExportsInteraction(
    val selectedIds: Set<String> = emptySet(),
)

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.ExportsRepository] adapter ↔ test
 *   fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` + `delete`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ExportsPageViewModel(
    private val source: ExportsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableInteraction = MutableStateFlow(ExportsInteraction())
    private val mutableDeleting = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /** The page's local bulk-selection snapshot (web `useBulkSelection` useState). */
    val interaction: StateFlow<ExportsInteraction> = mutableInteraction.asStateFlow()

    /** Whether a bulk delete is in flight — drives the toolbar action's loading state (web `mutateAsync`). */
    val deleting: StateFlow<Boolean> = mutableDeleting.asStateFlow()

    /**
     * The export jobs as cache-then-network UI state (loading / content / empty / stale / offline / error) — the
     * web `useExportJobs` feed. Re-collected whenever the refresh trigger bumps (error-retry / post-delete
     * invalidation). An empty list resolves to the empty phase (the web `jobs.length === 0` no-exports state).
     */
    val exportsState: StateFlow<UiState<List<ExportJobSummary>>> =
        refreshTrigger
            .flatMapLatest { source.exportJobs() }
            .asUiState(isEmpty = { it.isEmpty() })

    // ── Selection actions (web `useBulkSelection`) ───────────────────────────────────────────────────────────

    /** Toggles a job's bulk selection (web `sel.toggle(id)` via the row checkbox). */
    fun toggleSelected(
        id: String,
        on: Boolean,
    ) = mutableInteraction.update {
        val next = it.selectedIds.toMutableSet()
        if (on) next.add(id) else next.remove(id)
        it.copy(selectedIds = next)
    }

    /**
     * Toggles the select-all master checkbox over [visibleIds] (web `sel.toggleAll(visibleIds)`): selects every
     * visible row, or clears them if all were already selected, preserving any selection outside the view.
     */
    fun toggleMaster(visibleIds: List<String>) =
        mutableInteraction.update { it.copy(selectedIds = toggleAllSelection(it.selectedIds, visibleIds)) }

    /** Clears the bulk selection (web `sel.clear`). */
    fun clearSelection() = mutableInteraction.update { it.copy(selectedIds = emptySet()) }

    /**
     * Prunes the bulk selection to the currently-visible [visibleIds] so a deleted/expired row never lingers in
     * the selection. A no-op when nothing changes, so it is safe to call every frame.
     */
    fun retainSelection(visibleIds: Set<String>) =
        mutableInteraction.update { state ->
            if (state.selectedIds.isEmpty()) return@update state
            val pruned = state.selectedIds.intersect(visibleIds)
            if (pruned.size == state.selectedIds.size) state else state.copy(selectedIds = pruned)
        }

    // ── Mutation (web `useBulkExportsDelete`) ────────────────────────────────────────────────────────────────

    /**
     * Bulk-deletes the currently-selected exports, then re-collects the jobs feed and clears the selection on
     * success (web `mutateAsync(ids)` ▸ `sel.clear()`; the hook also invalidates `['export-jobs']`). A no-op when
     * the selection is empty or a delete is already running.
     */
    fun deleteSelected() {
        val ids = mutableInteraction.value.selectedIds.toList()
        if (ids.isEmpty() || mutableDeleting.value) return
        mutableDeleting.value = true
        launch {
            try {
                logger.info("exports.bulkDelete", mapOf("count" to ids.size.toString()))
                val result = source.bulkExportsDelete(ids)
                if (result.isSuccess) {
                    clearSelection()
                    refreshTrigger.update { it + 1 }
                } else {
                    logger.warn("exports.bulkDeleteFailed")
                }
            } finally {
                mutableDeleting.value = false
            }
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────

    /** Re-collect the jobs feed — the web query `refetch` / the page error-retry affordance. */
    fun refresh() {
        logger.info("exports.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the jobs feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordExportsPageOpened(logger)
    }
}
