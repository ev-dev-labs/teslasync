// The state holder backing the ArchivedPage notifications surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/notifications/pages/ArchivedPage.tsx, which
// reuses <InboxBody archived/>). It projects the archived flat-log + thread feeds onto the shared
// lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState], joining each with the page's
// alert-rule + vehicle lists (web `useAlertRules` / `useVehicles`) at the edge so the composable receives
// render-ready [InboxNotification] / [InboxGroup] rows, and orchestrates the inbox mutations off the UI
// thread. All derivation logic lives in the framework-free model (ArchivedPageModel.kt); this holder is the
// thin orchestration layer and performs no HTTP.
//
// A single [refreshTrigger] re-runs every feed (the InboxBody hard-error retry + the stale auto-refresh both
// call it, and every successful mutation bumps it so the list self-updates — the holder-side analogue of the
// web inbox mutations invalidating the `['notification-logs']` family). The vehicle/rule lists default to
// their last cached value while loading, exactly as the web page defaults both hooks to `[]`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.notifications.archived

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.inboxbody.InboxGroup
import io.teslasync.android.featureviews.inboxbody.InboxNotification
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.BulkMarkReadVars
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (the shared notifications repository + the shared Vehicles holder in
 *   production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh + the
 *   mutation outcomes.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ArchivedPageViewModel(
    private val source: ArchivedPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The archived flat-log feed as cache-then-network UI state (loading / content / empty / stale / offline /
     * error), joined with the live alert-rule + vehicle lists into render-ready rows. Re-collected whenever the
     * refresh trigger bumps (web inbox refetch / mutation invalidation). An empty archived list resolves to the
     * empty surface so the InboxBody draws its "No archived notifications" state rather than a blank panel.
     */
    val flatState: StateFlow<UiState<List<InboxNotification>>> =
        refreshTrigger
            .flatMapLatest {
                combine(
                    source.notificationLogs(),
                    source.alertRules(),
                    source.vehicles(),
                ) { logsRes, rulesRes, vehiclesRes ->
                    val rules = rulesRes.cached.orEmpty()
                    val vehicles = vehiclesRes.cached.orEmpty()
                    logsRes.mapData { logs -> toInboxNotifications(logs, rules, vehicles) }
                }
            }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The archived thread feed, joined into [InboxGroup] heads. The Archive tab never renders the grouped view
     * (web disables grouping when `archived`), but the feed is bound so the InboxBody receives a real lifecycle
     * state for it rather than a synthetic stand-in.
     */
    val groupState: StateFlow<UiState<List<InboxGroup>>> =
        refreshTrigger
            .flatMapLatest {
                combine(
                    source.notificationGroups(),
                    source.alertRules(),
                    source.vehicles(),
                ) { groupsRes, rulesRes, vehiclesRes ->
                    val rules = rulesRes.cached.orEmpty()
                    val vehicles = vehiclesRes.cached.orEmpty()
                    groupsRes.mapData { groups -> toInboxGroups(groups, rules, vehicles) }
                }
            }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Re-fetches every feed (the InboxBody hard-error retry + the stale auto-refresh affordance). */
    fun refresh() {
        logger.info("notificationsArchived.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Mark rows read (web `useMarkNotificationsRead`). */
    fun onMarkRead(ids: List<Long>): Unit = mutate { source.markRead(ids) }

    /** Mark rows unread (web `useMarkNotificationsUnread`). */
    fun onMarkUnread(ids: List<Long>): Unit = mutate { source.markUnread(ids) }

    /** Archive rows (web `useArchiveNotifications`) — not surfaced on the Archive tab, wired for completeness. */
    fun onArchive(ids: List<Long>): Unit = mutate { source.archive(ids) }

    /** Restore rows (web `useUnarchiveNotifications`) — the Archive tab's primary bulk + row action. */
    fun onUnarchive(ids: List<Long>): Unit = mutate { source.unarchive(ids) }

    /** Delete rows (web `useDeleteNotifications`). */
    fun onDelete(ids: List<Long>): Unit = mutate { source.delete(ids) }

    /** Bulk mark-read the given ids (web `useBulkMarkRead`). */
    fun onBulkMarkRead(ids: List<Long>): Unit = mutate { source.bulkMarkRead(BulkMarkReadVars.Ids(ids)) }

    /** Mark every notification read (web `bulkMarkRead({ all: true })`). */
    fun onMarkAllRead(): Unit = mutate { source.bulkMarkRead(BulkMarkReadVars.All) }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordArchivedPageOpened(logger)
    }

    /**
     * Runs a single inbox mutation off the UI thread (web `mutation.mutate`). On success the feeds refresh so
     * the list self-updates (web `invalidateQueries(['notification-logs'])`); a failure is logged without
     * leaking row content and leaves the cached list visible.
     */
    private fun mutate(block: suspend () -> Result<*>) {
        launch {
            block()
                .onSuccess { refresh() }
                .onFailure { logger.warn("notificationsArchived.mutationFailed") }
        }
    }
}
