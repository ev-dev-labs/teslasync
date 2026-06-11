package io.teslasync.android.data.dashboard

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.DashboardStats
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.dashboard.DashboardStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/**
 * Page ViewModel for the fleet-overview dashboard. Binds the shared [DashboardStore] (the KMP port of
 * the web `useDashboard` hook) to a lifecycle-aware [UiState] and exposes the single refresh action.
 *
 * It owns no networking — the store and its repository do (ADR-002). All this layer adds is the
 * Compose projection of the cache-then-network [io.teslasync.shared.core.data.repo.Resource] and the
 * [stateScope]-bound re-sharing, so the screen stays a stateless Composable.
 */
class DashboardViewModel(
    private val store: DashboardStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    /** The fleet summary as cache-then-network UI state (loading / content / empty / stale / error). */
    val stats: StateFlow<UiState<DashboardStats>> = store.stats.asUiState(isEmpty = ::isZeroSummary)

    /** Re-fetches the summary (pull-to-refresh). A no-op while nobody observes [stats]. */
    fun refresh() {
        logger.info("dashboard.refresh")
        store.refresh()
    }

    /** A fresh install with no fleet data yet decodes to an all-zero summary — render the empty state. */
    private fun isZeroSummary(value: DashboardStats): Boolean = value == DashboardStats()
}
