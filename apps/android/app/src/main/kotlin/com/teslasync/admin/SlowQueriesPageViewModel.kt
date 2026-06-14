// The state holder backing the SlowQueriesPage admin surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hook (web/src/features/admin/pages/SlowQueriesPage.tsx). It owns the page's local
// interaction state (the selected order-by + row limit) as a single immutable [SlowQueriesInteraction] snapshot
// and projects the single cache-then-network read (`GET /admin/observability/slow-queries`) onto the shared
// lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState]. The feed re-collects whenever the
// order-by / limit changes (a new `?order_by&limit` read, web `useSlowQueries(orderBy, limit)`) or the refresh
// trigger bumps. The HTTP 503 / subsystem-not-configured branch (web `error.status === 503`) is preserved
// through [UiState.httpStatus] for the render layer to surface the "subsystem unavailable" banner. All
// derivation logic lives in the framework-free model (SlowQueriesPageModel.kt); this holder performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.slowqueries

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.OperatorConfidenceRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.SlowQueriesResponse
import io.teslasync.shared.core.presentation.operatorconfidence.SlowQueryOrderBy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * The page's local interaction snapshot — the union of the web component's `orderBy`/`limit` `useState` pair,
 * folded into one immutable value so the composable reads a single source. Defaults mirror the web hook
 * (`useSlowQueries(orderBy = 'mean_time', limit = 25)`).
 */
data class SlowQueriesInteraction(
    val orderBy: SlowQueryOrderBy = OperatorConfidenceRepository.DEFAULT_SLOW_QUERY_ORDER_BY,
    val limit: Int = OperatorConfidenceRepository.DEFAULT_SLOW_QUERY_LIMIT,
)

/**
 * @param source the P1/S8 data seam (real
 *   [io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore] adapter ↔ test fake);
 *   the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SlowQueriesPageViewModel(
    private val source: SlowQueriesSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableInteraction = MutableStateFlow(SlowQueriesInteraction())
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `useState` pair: order-by + limit). */
    val interaction: StateFlow<SlowQueriesInteraction> = mutableInteraction.asStateFlow()

    /**
     * The slow-query report as cache-then-network UI state (loading / content / empty / stale / offline /
     * error). Re-collected whenever the order-by / limit changes (a new feed key, web
     * `useSlowQueries(orderBy, limit)`) or the refresh trigger bumps. The empty predicate is the model's
     * "no rows" guard (web `rows.length === 0`), so a report with at least one row resolves to content (the
     * table) rather than the empty panel.
     */
    val state: StateFlow<UiState<SlowQueriesResponse>> =
        combine(mutableInteraction, refreshTrigger) { interaction, _ -> interaction }
            .flatMapLatest { interaction -> source.slowQueries(interaction.orderBy, interaction.limit) }
            .asUiState(isEmpty = { it.isEmptyRows })

    // ── Interaction setters (web `setOrderBy` / `setLimit`) ──────────────────────────────────────────────────────

    /** Choose the column the report is ordered by (web `setOrderBy`). */
    fun setOrderBy(orderBy: SlowQueryOrderBy): Unit = mutableInteraction.update { it.copy(orderBy = orderBy) }

    /** Choose how many rows to request (web `setLimit`). */
    fun setLimit(limit: Int): Unit = mutableInteraction.update { it.copy(limit = limit) }

    // ── Refresh / retry (web query `refetch` + the error-state retry) ────────────────────────────────────────────

    /** Re-fetch the active slow-query feed (the web `refetchInterval` / error-retry affordance). */
    fun refresh() {
        logger.info("slowQueries.refresh")
        val active = mutableInteraction.value
        source.refresh(active.orderBy, active.limit)
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSlowQueriesPageOpened(logger)
    }
}
