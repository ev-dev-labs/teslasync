package io.teslasync.android.dashboardwidgets.notificationstats

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose [NotificationStatsWidget] — the Android port of the web
 * `NotificationStatsWidget`'s hook composition
 * (`web/src/features/dashboard/widgets/NotificationStatsWidget.tsx`).
 *
 * It binds the injected [NotificationStatsSource] (the P1/S8 shared-layer seam) to two lifecycle-aware
 * [UiState] streams — the aggregate [stats] (web `useNotificationStats`) and the recent delivery
 * [logs] (web `useNotificationLogs`) — and performs no HTTP itself (ADR-002). Between them they cover
 * every state the web widget renders: loading (no cache), content, empty, hard error, and — through
 * the ADR-013 freshness contract — stale / offline (cached figures kept visible with the staleness +
 * error flags). The stats feed is never treated as structurally empty (matching the web `stats ? …`
 * branch, where a resolved all-zero stats object still renders the grid, not the empty state).
 *
 * [refresh]/[retry] bump a single trigger that restarts a fresh upstream collection of BOTH feeds (the
 * web `statsRefetch()` + `logsRefetch()`), and [onViewOpened] emits the P1/S11 `view.opened`
 * diagnostics event exactly once per surface open.
 *
 * @param source the shared cache-then-network stats + logs seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationStatsWidgetViewModel(
    private val source: NotificationStatsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The aggregate delivery stats as cache-then-network UI state. The emptiness predicate is `false`
     * so a resolved stats object always renders content (web parity: `{stats ? grid : EmptyState}`
     * shows the grid for an all-zero object; the empty surface is the `!stats` transient).
     */
    val stats: StateFlow<UiState<NotificationStats>> =
        refreshTrigger
            .flatMapLatest { source.stats() }
            .asUiState { false }

    /** The recent delivery log as cache-then-network UI state (empty list → empty, but logs never gate the panel). */
    val logs: StateFlow<UiState<List<NotificationLog>>> =
        refreshTrigger
            .flatMapLatest { source.logs() }
            .asUiState { it.isEmpty() }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf("slug" to NotificationStatsRegistration.SLUG))
    }

    /** Re-fetches both feeds (web `statsRefetch()` + `logsRefetch()`); restarts fresh collections. */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf("slug" to NotificationStatsRegistration.SLUG))
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "notificationStats.refresh"

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: NotificationStatsSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { NotificationStatsWidgetViewModel(source, logger) }
            }
    }
}
