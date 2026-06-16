// The state holder backing the AlertRulesPage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hooks (web/src/features/notifications/pages/AlertRulesPage.tsx). It owns the page's
// bulk-selection snapshot ([AlertRulesInteraction]), projects the single cache-then-network alert-rules read
// (`useAlertRules`) onto the shared lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState], and runs
// the four mutations: bulk enable (`useBulkEnableRules`), bulk disable (`useBulkDisableRules`), bulk delete
// (per-id `useDeleteAlertRule`, the web `Promise.allSettled` fan-out — there is no bulk-delete endpoint), and the
// inline rename (`useSaveAlertRule`). Each successful mutation re-collects the rules feed (the web hook's
// `invalidateQueries(['alert-rules'])`) so the list reflects the change while the previous rows stay visible
// during the reload. All derivation logic lives in the framework-free model (AlertRulesPageModel.kt); this holder
// is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.notifications.alertrules

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.AlertRuleSaveRequest
import io.teslasync.shared.core.presentation.notifications.AlertRuleUpdate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.NotificationsRepository] adapter ↔
 *   test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the mutation events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AlertRulesPageViewModel(
    private val source: AlertRulesPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(AlertRulesInteraction())
    private val rulesRefresh = MutableStateFlow(0)
    private val mutableMutating = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /** The page's local bulk-selection snapshot (web `useBulkSelection<number>()`). */
    val interaction: StateFlow<AlertRulesInteraction> = mutableInteraction.asStateFlow()

    /** Whether a bulk enable/disable/delete is in flight — drives the toolbar actions' loading state. */
    val mutating: StateFlow<Boolean> = mutableMutating.asStateFlow()

    /**
     * The alert rules as cache-then-network UI state (web `useAlertRules`). Re-collected whenever the refresh
     * trigger bumps (after a mutation, or on retry), reproducing the web `invalidateQueries(['alert-rules'])`
     * refetch while the previous rows stay visible during the reload.
     */
    val rulesState: StateFlow<UiState<List<AlertRule>>> =
        rulesRefresh
            .flatMapLatest { source.alertRules() }
            .asUiState(isEmpty = { it.isEmpty() })

    // ── Selection actions (web useBulkSelection) ────────────────────────────────────────────────────────────────

    /** Toggles one rule's bulk selection (web `sel.toggle(id)`). */
    fun toggleSelected(
        id: Long,
        on: Boolean,
    ) = mutableInteraction.update { state ->
        val next = state.selectedIds.toMutableSet()
        if (on) next.add(id) else next.remove(id)
        state.copy(selectedIds = next)
    }

    /**
     * Master toggle over [visibleIds] (web `sel.toggleAll(visibleIds)`): when every visible row is already
     * selected it deselects them, otherwise it selects the whole visible set.
     */
    fun toggleAll(visibleIds: List<Long>) =
        mutableInteraction.update { state ->
            val next = state.selectedIds.toMutableSet()
            if (state.masterState(visibleIds) == MasterSelection.All) {
                next.removeAll(visibleIds.toSet())
            } else {
                next.addAll(visibleIds)
            }
            state.copy(selectedIds = next)
        }

    /** Clears the bulk selection (web `sel.clear`). */
    fun clearSelection() = mutableInteraction.update { it.copy(selectedIds = emptySet()) }

    /**
     * Prunes the bulk selection to the currently-visible [visibleIds] (web `useBulkSelection` drops a selected id
     * once it leaves the visible set). A no-op when nothing changes, so it is safe to call every frame.
     */
    fun retainSelection(visibleIds: Set<Long>) =
        mutableInteraction.update { state ->
            if (state.selectedIds.isEmpty()) return@update state
            val pruned = state.selectedIds.intersect(visibleIds)
            if (pruned.size == state.selectedIds.size) state else state.copy(selectedIds = pruned)
        }

    // ── Bulk mutations (web useBulkEnableRules / useBulkDisableRules) ────────────────────────────────────────────

    /** Enables every selected rule, then clears the selection on success (web `bulkEnable.mutateAsync` ▸ clear). */
    fun bulkEnable() = runBulkToggle(enable = true)

    /** Disables every selected rule, then clears the selection on success (web `bulkDisable.mutateAsync` ▸ clear). */
    fun bulkDisable() = runBulkToggle(enable = false)

    private fun runBulkToggle(enable: Boolean) {
        val ids = mutableInteraction.value.selectedIds.toList()
        if (ids.isEmpty() || mutableMutating.value) return
        mutableMutating.value = true
        launch {
            try {
                logger.info(if (enable) "alertRules.bulkEnable" else "alertRules.bulkDisable", mapOf("count" to ids.size.toString()))
                val result = if (enable) source.bulkEnableRules(ids) else source.bulkDisableRules(ids)
                if (result.isSuccess) {
                    clearSelection()
                    rulesRefresh.update { it + 1 }
                }
            } finally {
                mutableMutating.value = false
            }
        }
    }

    /**
     * Bulk-deletes the selected rules by fanning out per-id DELETEs (web `Promise.allSettled(ids.map(deleteOne))`
     * — there is no bulk-delete-rules endpoint), then clears the selection and re-collects the feed. Every id is
     * attempted regardless of individual failures, matching `allSettled`. A no-op when the selection is empty or a
     * mutation is already running.
     */
    fun bulkDelete() {
        val ids = mutableInteraction.value.selectedIds.toList()
        if (ids.isEmpty() || mutableMutating.value) return
        mutableMutating.value = true
        launch {
            try {
                logger.info("alertRules.bulkDelete", mapOf("count" to ids.size.toString()))
                coroutineScope { ids.map { id -> async { runCatching { source.deleteAlertRule(id) } } }.awaitAll() }
                clearSelection()
                rulesRefresh.update { it + 1 }
            } finally {
                mutableMutating.value = false
            }
        }
    }

    // ── Inline rename (web useSaveAlertRule) ────────────────────────────────────────────────────────────────────

    /**
     * Renames one rule (web `saveRule.mutateAsync({ id, name })` ▸ `PUT /alerts/rules/{id}`), then re-collects the
     * feed on success so the new name is reflected. The validation/trim is applied at the edit boundary; this only
     * sends the already-trimmed [name].
     */
    fun renameRule(
        id: Long,
        name: String,
    ) {
        launch {
            logger.info("alertRules.rename")
            val result = source.saveAlertRule(AlertRuleSaveRequest.Update(id = id, patch = AlertRuleUpdate(name = name)))
            if (result.isSuccess) {
                rulesRefresh.update { it + 1 }
            }
        }
    }

    // ── Lifecycle ───────────────────────────────────────────────────────────────────────────────────────────────

    /** Re-collect the rules feed — the web query `refetch` / the page error-retry + pull-to-refresh affordance. */
    fun refresh() {
        logger.info("alertRules.refresh")
        rulesRefresh.update { it + 1 }
    }

    /** Retry affordance for the rules feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAlertRulesPageOpened(logger)
    }
}
