// The state holder backing the AlertsListPage surface (P1/S8) — the native counterpart of the web page's React state +
// TanStack-Query hooks (web/src/features/notifications/pages/AlertsListPage.tsx). It owns the page's local interaction
// state (tab filter / search / page + the acknowledge-dialog + audit-timeline modal selections) as immutable
// snapshots, projects the four cache-then-network reads (`useAlerts`, `useAlertRules`, `usePinned('alert_rule')`,
// `useAlertDetail`) onto the shared lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState], and runs the
// three alert mutations (`useMarkAlertRead`, `useAcknowledgeAlert`, `useReopenAlert`). Each read re-collects whenever
// the refresh trigger bumps (the web `refetch` + the post-mutation `invalidateQueries`); the detail feed additionally
// re-collects when the opened alert changes. All derivation logic lives in the framework-free model
// (AlertsListPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.notifications.alertslist

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.notifications.QuietHours
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.Alert
import io.teslasync.shared.core.presentation.notifications.AlertDetail
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (the real shared-core Notifications + Pinned repositories + the device quiet-hours
 *   snapshot in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` + the mutations.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AlertsListPageViewModel(
    private val source: AlertsListPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(AlertsInteraction())
    private val alertsRefresh = MutableStateFlow(0)
    private val detailRefresh = MutableStateFlow(0)
    private val mutableDetailId = MutableStateFlow<Long?>(null)
    private val mutableAckDialogId = MutableStateFlow<Long?>(null)
    private val mutableAcknowledging = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web URL-state cells: filter / q / page). */
    val interaction: StateFlow<AlertsInteraction> = mutableInteraction.asStateFlow()

    /** The alert id whose audit-timeline modal is open, or null (web `detailId`). */
    val detailId: StateFlow<Long?> = mutableDetailId.asStateFlow()

    /** The alert id whose acknowledge dialog is open, or null (web `ackDialogId`). */
    val ackDialogId: StateFlow<Long?> = mutableAckDialogId.asStateFlow()

    /** Whether an acknowledge submission is in flight — drives the dialog's submit spinner (web `ackMut.isPending`). */
    val acknowledging: StateFlow<Boolean> = mutableAcknowledging.asStateFlow()

    /** The device quiet-hours snapshot (web `loadQuietHours()`); a value, not a feed, read once per holder. */
    val quietHours: QuietHours = source.quietHours()

    /** The alert inbox as cache-then-network UI state (web `useAlerts`); empty list resolves to the empty surface. */
    val alertsState: StateFlow<UiState<List<Alert>>> =
        alertsRefresh
            .flatMapLatest { source.alerts() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The alert-rule list as cache-then-network UI state (web `useAlertRules`); backs Active-Rules + the pinned panel. */
    val rulesState: StateFlow<UiState<List<AlertRule>>> =
        alertsRefresh
            .flatMapLatest { source.alertRules() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The `alert_rule` pin bucket as cache-then-network UI state (web `usePinned('alert_rule')`). */
    val pinsState: StateFlow<UiState<List<PinnedItem>>> =
        alertsRefresh
            .flatMapLatest { source.pinnedRules() }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The opened alert's detail + audit timeline as UI state (web `useAlertDetail`, `enabled: detailId !== null`).
     * Re-collected when the opened alert changes or a mutation bumps [detailRefresh]; parks on a loading surface while
     * no alert is open (the modal is hidden then, so the value is inert).
     */
    val detailState: StateFlow<UiState<AlertDetail>> =
        combine(mutableDetailId, detailRefresh) { id, _ -> id }
            .flatMapLatest { id ->
                if (id == null) {
                    flowOf<Resource<AlertDetail>>(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                } else {
                    source.alertDetail(id)
                }
            }
            .asUiState(isEmpty = { false })

    // ── Interaction actions (web setUrlBatch / setState) ──────────────────────────────────────────────────────

    /** Selects the tab facet, resetting to page 1 (web `setFilter` + `setAlertPage(1)`). */
    fun setFilter(filter: AlertFilter) = mutableInteraction.update { it.copy(filter = filter, page = 1) }

    /** Updates the search query, resetting to page 1 (web `setAlertSearch` + `setAlertPage(1)`). */
    fun setSearch(query: String) = mutableInteraction.update { it.copy(search = query, page = 1) }

    /** Jumps to a 1-based page (web `setAlertPage`). */
    fun setPage(page: Int) = mutableInteraction.update { it.copy(page = page.coerceAtLeast(1)) }

    /** Clears the search + tab filters and returns to page 1 (web empty-state clear-all). */
    fun resetFilters() = mutableInteraction.update { AlertsInteraction() }

    /** Opens the acknowledge dialog for [id] (web `setAckDialogId(id)`). */
    fun openAckDialog(id: Long) = mutableAckDialogId.update { id }

    /** Closes the acknowledge dialog (web `setAckDialogId(null)`). */
    fun closeAckDialog() = mutableAckDialogId.update { null }

    /** Opens the audit-timeline modal for [id] (web `setDetailId(id)`). */
    fun openDetail(id: Long) = mutableDetailId.update { id }

    /** Closes the audit-timeline modal (web `setDetailId(null)`). */
    fun closeDetail() = mutableDetailId.update { null }

    // ── Mutations (web useMarkAlertRead / useAcknowledgeAlert / useReopenAlert) ────────────────────────────────

    /** Marks an alert read, then refreshes the inbox + toasts on success (web `handleMarkRead`). */
    fun markRead(id: Long) {
        launch {
            logger.info("alerts.markRead")
            if (source.markAlertRead(id).isSuccess) {
                alertsRefresh.update { it + 1 }
                emitEvent(UiEvent.Message(MSG_MARK_READ_SUCCESS, severity = UiEvent.Severity.Info))
            }
        }
    }

    /**
     * Acknowledges an alert with an optional [note], then closes the dialog, refreshes the inbox + the open detail, and
     * toasts (with an Undo affordance) on success (web `handleAcknowledgeSubmit`). Guarded against double-submit.
     */
    fun acknowledge(
        id: Long,
        note: String,
    ) {
        if (mutableAcknowledging.value) return
        mutableAcknowledging.value = true
        launch {
            try {
                logger.info("alerts.acknowledge")
                if (source.acknowledgeAlert(id, note.ifBlank { null }).isSuccess) {
                    closeAckDialog()
                    alertsRefresh.update { it + 1 }
                    detailRefresh.update { it + 1 }
                    emitEvent(UiEvent.Message(MSG_ACK_SUCCESS, args = listOf(id.toString()), severity = UiEvent.Severity.Success))
                }
            } finally {
                mutableAcknowledging.value = false
            }
        }
    }

    /** Reopens an acknowledged alert, then refreshes the inbox + the open detail on success (web `handleReopen` / Undo). */
    fun reopen(id: Long) {
        launch {
            logger.info("alerts.reopen")
            if (source.reopenAlert(id).isSuccess) {
                alertsRefresh.update { it + 1 }
                detailRefresh.update { it + 1 }
            }
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────

    /** Re-collect every read feed — the web query `refetch` + the page error-retry affordance. */
    fun refresh() {
        logger.info("alerts.refresh")
        alertsRefresh.update { it + 1 }
        detailRefresh.update { it + 1 }
    }

    /** Retry affordance for a feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAlertsListPageOpened(logger)
    }

    companion object {
        /** Toast key for a successful mark-read (web `toast.info(t('Alert marked as read'))`). */
        const val MSG_MARK_READ_SUCCESS: String = "alerts.markRead.success"

        /** Toast key for a successful acknowledge; the alert id rides in the event args for the Undo action. */
        const val MSG_ACK_SUCCESS: String = "alerts.ack.success"
    }
}
