// The state holder backing the DBHealthPage system surface (P1/S8) — the native counterpart of the web page's three
// TanStack-Query reads + its `sortKey` interaction state (web/src/features/system/pages/DBHealthPage.tsx, the
// database-health dashboard). It projects the three shared cache-then-network feeds onto the shared lifecycle-aware
// [UiState] surface via [BaseFeedViewModel.asUiState]: the `/dev-tools/db-stats` feed is the spine that drives the
// page's loading / empty / error phase (the summary cards, the top-15 chart, and the table all read from it); the
// `/dev-tools/migration-status` + `/dev-tools/runtime-info` feeds fold in best-effort, each carrying its own
// loading / empty / error sub-state so a still-loading or failed sidebar read never blanks the dashboard
// (web: every `useQuery` has its own `isLoading` / `data` gate). The table sort is local interaction state applied
// client-side at the render boundary (web `sortKey` useState + `sortedTables` useMemo) — it never re-fetches. All
// derivation logic lives in the framework-free model (DBHealthPageModel.kt); this holder performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.dbhealth

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * The page's local interaction snapshot — the native port of the web component's `sortKey` `useState`. The default
 * mirrors the web hook (`useState<SortKey>('size')`). Folding it into one immutable value keeps the composable
 * reading a single source.
 */
data class DBHealthInteraction(
    val sortKey: TableSortKey = TableSortKey.Size,
)

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.admin.AdminStore] adapter ↔ test
 *   fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DBHealthPageViewModel(
    private val source: DBHealthSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableInteraction = MutableStateFlow(DBHealthInteraction())
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `sortKey` useState). Applied client-side; never re-fetches. */
    val interaction: StateFlow<DBHealthInteraction> = mutableInteraction.asStateFlow()

    /**
     * The combined three-read surface as cache-then-network UI state (loading / content / empty / stale / offline /
     * error). Re-collected whenever the refresh trigger bumps. The `/dev-tools/db-stats` feed drives the phase +
     * freshness; the migration + pool feeds fold in best-effort, each carrying its own sub-state.
     */
    val state: StateFlow<UiState<DBHealthData>> =
        refreshTrigger
            .flatMapLatest {
                combine(
                    source.dbStats(),
                    source.migrations(),
                    source.connectionPool(),
                ) { stats, migrations, pool -> combineResources(stats, migrations, pool) }
            }
            .asUiState(isEmpty = { it.isEmpty })

    /** Choose the column the table is sorted by (web `setSortKey`). Client-side only — no re-fetch. */
    fun setSortKey(key: TableSortKey): Unit = mutableInteraction.update { it.copy(sortKey = key) }

    /** Re-collect every cache-then-network feed (the web `refetchInterval` / error-state retry affordance). */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDBHealthPageOpened(logger)
    }

    /**
     * Composes the three reads into one [Resource] of the combined payload, mirroring the sibling SystemStatus
     * surface: the db-stats feed dictates the page phase + freshness, while the migration + pool feeds are read from
     * whatever is cached (with their ADR-013 first-load flags) so a still-loading / failed sidebar read never blanks
     * the dashboard and each sidebar panel renders its own sub-state.
     */
    private fun combineResources(
        stats: Resource<JsonElement>,
        migrations: Resource<JsonElement>,
        pool: Resource<JsonElement>,
    ): Resource<DBHealthData> {
        val data =
            DBHealthData.from(
                statsJson = stats.cached,
                migrationJson = migrations.cached,
                migrationLoadingNoCache = migrations is Resource.Loading && migrations.cached == null,
                migrationErrorNoCache = migrations is Resource.Error && migrations.cached == null,
                poolJson = pool.cached,
                poolLoadingNoCache = pool is Resource.Loading && pool.cached == null,
                poolErrorNoCache = pool is Resource.Error && pool.cached == null,
            )
        return when {
            stats is Resource.Error && stats.cached == null ->
                Resource.Error(cached = null, fetchedAt = stats.fetchedAt, stale = stats.stale, error = stats.error)
            stats is Resource.Loading && stats.cached == null ->
                Resource.Loading(cached = null, fetchedAt = stats.fetchedAt, stale = stats.stale)
            stats is Resource.Loading ->
                Resource.Loading(cached = data, fetchedAt = stats.fetchedAt, stale = stats.stale)
            stats is Resource.Error ->
                Resource.Error(cached = data, fetchedAt = stats.fetchedAt, stale = true, error = stats.error)
            else ->
                Resource.Success(data = data, fetchedAt = (stats as Resource.Success).fetchedAt, stale = stats.stale)
        }
    }

    private companion object {
        const val EVENT_REFRESH = "dbHealth.refresh"
    }
}
