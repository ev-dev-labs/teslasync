// The state holder backing the ApiLogsPage admin surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/admin/pages/ApiLogsPage.tsx). It owns the page's local
// interaction state (the four filters, the page index, the expanded-row id) as a single immutable
// [ApiLogsInteraction] snapshot, and projects the two cache-then-network reads (`/api-logs` page + `/api-logs/
// stats`) onto the shared lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState]. The logs feed
// is the spine that drives the loading / empty / error phase; the stats feed folds in best-effort (web
// `stats?.…`) so a still-loading or failed stats read never blanks the logs table. All derivation logic lives
// in the framework-free model (ApiLogsPageModel.kt); this holder is the thin orchestration layer and performs
// no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.apilogs

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.admin.AdminStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * The page's local interaction snapshot — the union of the web component's `useUrlNumber`/`useUrlString`
 * params + the expanded-row `useState`, folded into one immutable value so the composable reads a single
 * source. [filters] is the projection the model's client-side filter predicate consumes.
 */
data class ApiLogsInteraction(
    val page: Int = 0,
    val method: String = "",
    val status: String = "",
    val endpoint: String = "",
    val service: String = "",
    val expandedId: Long? = null,
) {
    /** The four active filters as the model's filter shape (web URL params). */
    val filters: ApiLogsFilters get() = ApiLogsFilters(method, status, endpoint, service)
}

/**
 * @param source the P1/S8 data seam (real [AdminStore] adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ApiLogsPageViewModel(
    private val source: ApiLogsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableInteraction = MutableStateFlow(ApiLogsInteraction())
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `useState`/`useUrlState` group). */
    val interaction: StateFlow<ApiLogsInteraction> = mutableInteraction.asStateFlow()

    /**
     * The combined logs + stats surface as cache-then-network UI state (loading / content / empty / stale /
     * offline / error). Re-collected whenever the page index changes (a new `/api-logs?offset` read) or the
     * refresh trigger bumps. The logs feed drives the phase + freshness; stats fold in best-effort.
     */
    val state: StateFlow<UiState<ApiLogsData>> =
        combine(
            mutableInteraction.map { it.page }.distinctUntilChanged(),
            refreshTrigger,
        ) { page, _ -> page }
            .flatMapLatest { page ->
                combine(source.apiLogs(page), source.apiLogStats()) { logs, stats ->
                    combineResources(logs, stats)
                }
            }
            .asUiState(isEmpty = { it.isEmpty })

    // ── Filter setters (web `setFilter(key, value)` — each resets the page + collapses the open row) ─────────

    fun setMethod(value: String): Unit = updateFilters { it.copy(method = value) }

    fun setStatus(value: String): Unit = updateFilters { it.copy(status = value) }

    fun setEndpoint(value: String): Unit = updateFilters { it.copy(endpoint = value) }

    /** Select a service from the dropdown or a "By Service" chip (web `selectService`). */
    fun selectService(value: String): Unit = updateFilters { it.copy(service = value) }

    /** Clear every filter (web `clearFilters`). */
    fun clearFilters(): Unit =
        mutableInteraction.update {
            it.copy(method = "", status = "", endpoint = "", service = "", page = 0, expandedId = null)
        }

    // ── Pagination + expansion (web `setPage` / `setExpandedId`) ─────────────────────────────────────────────

    /** Go to [page] (0-based, clamped at zero), collapsing the open row (web `setPage`). */
    fun setPage(page: Int): Unit = mutableInteraction.update { it.copy(page = page.coerceAtLeast(0), expandedId = null) }

    /** Toggle the expanded detail for [id] (web `setExpandedId(expandedId === id ? null : id)`). */
    fun toggleExpanded(id: Long): Unit =
        mutableInteraction.update { it.copy(expandedId = if (it.expandedId == id) null else id) }

    // ── Refresh / retry (web query `refetch` + the error-state retry) ───────────────────────────────────────

    /** Re-collect both cache-then-network feeds (the web `refetchInterval` / error retry affordance). */
    fun refresh() {
        logger.info("apiLogs.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordApiLogsPageOpened(logger)
    }

    private fun updateFilters(transform: (ApiLogsInteraction) -> ApiLogsInteraction) {
        mutableInteraction.update { transform(it).copy(page = 0, expandedId = null) }
    }

    /**
     * Composes the logs (spine) + stats (best-effort) resources into one [Resource] of the combined payload,
     * mirroring the sibling Admin surfaces: the logs feed dictates the phase + freshness, while stats are read
     * from whatever is cached so a still-loading / failed stats read never blanks the table.
     */
    private fun combineResources(
        logs: Resource<JsonElement>,
        stats: Resource<JsonElement>,
    ): Resource<ApiLogsData> {
        val data = ApiLogsData.from(logs.cached, stats.cached)
        return when {
            logs is Resource.Error && logs.cached == null ->
                Resource.Error(cached = null, fetchedAt = logs.fetchedAt, stale = logs.stale, error = logs.error)
            logs is Resource.Loading && logs.cached == null ->
                Resource.Loading(cached = null, fetchedAt = logs.fetchedAt, stale = logs.stale)
            logs is Resource.Loading ->
                Resource.Loading(cached = data, fetchedAt = logs.fetchedAt, stale = logs.stale)
            logs is Resource.Error ->
                Resource.Error(cached = data, fetchedAt = logs.fetchedAt, stale = true, error = logs.error)
            else ->
                Resource.Success(data = data, fetchedAt = (logs as Resource.Success).fetchedAt, stale = logs.stale)
        }
    }
}
