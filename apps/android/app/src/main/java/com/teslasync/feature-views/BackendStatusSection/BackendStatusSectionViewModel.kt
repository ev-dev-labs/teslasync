// UI-thread-free state holder backing the Backend Status feature view — the native port of the web
// component's hook composition (web/src/features/system/components/status/BackendStatusSection.tsx). It binds
// the shared Admin + Settings feeds (P1/S8) through [BackendStatusSectionSource], composing the three
// cache-then-network streams onto the shared [UiState] surface (loading / content / empty / stale / offline /
// error) and carrying the freshness stamp + error kind.
//
// Loading gating mirrors the web `isLoading = extLoading || poolLoading`: the shell shows skeletons until
// BOTH the health and pool feeds have resolved once (a still-first-loading pool keeps the skeletons even
// after health arrives). The health feed is the spine for the error / offline surface (the core component
// table + system runtime read off it); the pool and version feeds are folded in best-effort from whatever
// is cached, so a still-loading or failed pool / version never blanks the surface — exactly like the web
// rendering `pool` / `version` opportunistically with `?.` and section guards. It exposes the single refresh
// action plus the PII-safe `view.opened` diagnostic; the view performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BackendStatusSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backendstatussection

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * @param source the cache-then-network seam (a shared Admin/Settings-data-layer adapter in production, a
 *   fake in tests). The view-model owns no networking — it only composes the three feeds and projects them.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BackendStatusSectionViewModel(
    private val source: BackendStatusSectionSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects all three cache-then-network feeds (the web `refetch()` affordance);
    // the repository-backed source re-fetches on re-subscribe, exactly as the shared stores' own
    // trigger ▸ flatMapLatest pipelines do for their memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The composed surface as cache-then-network UI state (loading / content / empty / stale / offline /
     * error), carrying the freshness stamp + error kind from the **health** feed (the spine that backs the
     * component table + runtime section and the only feed that can raise the hard error surface). Empty is
     * the native data-contract addition: it fires only when nothing resolved on any sub-section.
     */
    val state: StateFlow<UiState<BackendStatusData>> =
        refreshTrigger
            .flatMapLatest { composedFeed() }
            .asUiState(isEmpty = { it.isEmpty })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the freshness/error retry). */
    fun refresh() {
        logger.info("backendStatus.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no component status, pool figure, or runtime detail. Call from the composable's
     * first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordBackendStatusSectionOpened(logger)
    }

    /**
     * Composes the three feeds: the health envelope drives the resulting [Resource] phase / freshness, while
     * the pool envelope participates only in the first-load gate (web `extLoading || poolLoading`) and the
     * version envelope is purely additive (best-effort, read from whatever is cached). All three cached
     * payloads are parsed into the combined [BackendStatusData].
     */
    private fun composedFeed(): Flow<Resource<BackendStatusData>> =
        combine(source.systemHealth(), source.connectionPool(), source.versionInfo()) { health, pool, version ->
            combineResources(health, pool, version)
        }

    private fun combineResources(
        health: Resource<JsonElement>,
        pool: Resource<JsonElement>,
        version: Resource<JsonElement>,
    ): Resource<BackendStatusData> {
        val data = BackendStatusData.from(health.cached, pool.cached, version.cached)
        val poolFirstLoading = pool is Resource.Loading && pool.cached == null
        return when {
            // Hard error with no cached health → the error surface + retry (web has no error branch, but the
            // native data contract requires one; pool/version errors never reach here — they fold in best-effort).
            health is Resource.Error && health.cached == null ->
                Resource.Error(cached = null, fetchedAt = health.fetchedAt, stale = health.stale, error = health.error)
            // First load on health → skeletons.
            health is Resource.Loading && health.cached == null ->
                Resource.Loading(cached = null, fetchedAt = health.fetchedAt, stale = health.stale)
            // Health resolved but pool still on its very first load → keep skeletons (web `poolLoading`).
            poolFirstLoading -> Resource.Loading(cached = null, fetchedAt = null, stale = false)
            // Health refreshing over a cached value → content with a refresh in flight.
            health is Resource.Loading -> Resource.Loading(cached = data, fetchedAt = health.fetchedAt, stale = health.stale)
            // Health failed after having a cache → keep the last-known content, flagged offline/stale.
            health is Resource.Error -> Resource.Error(cached = data, fetchedAt = health.fetchedAt, stale = true, error = health.error)
            // Both resolved successfully.
            else -> Resource.Success(data = data, fetchedAt = (health as Resource.Success).fetchedAt, stale = health.stale)
        }
    }

    companion object {
        /**
         * Wire the surface from the shared **S8** holders — the memoized, multi-observer feeds every Admin /
         * Settings surface shares (incl. their standard-cadence background refresh).
         */
        fun create(
            admin: AdminStore,
            settings: SettingsStore,
            logger: Logger,
        ): BackendStatusSectionViewModel = BackendStatusSectionViewModel(admin.asBackendStatusSectionSource(settings), logger)

        /**
         * Wire the surface from the shared **S7** repositories — the cold cache-then-network feeds where the
         * refresh trigger re-subscribing performs a genuine re-fetch (the web `refetch()`).
         */
        fun create(
            admin: AdminRepository,
            settings: SettingsRepository,
            logger: Logger,
        ): BackendStatusSectionViewModel = BackendStatusSectionViewModel(admin.asBackendStatusSectionSource(settings), logger)
    }
}
