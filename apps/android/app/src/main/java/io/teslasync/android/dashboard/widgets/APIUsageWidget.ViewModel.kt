@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboard.widgets

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * The data port the [ApiUsageViewModel] binds to — the native analogue of the web `useApiLogStats`
 * hook. It yields the cache-then-network sequence of parsed API call-log stats for
 * `GET /api-logs/stats`. The view never performs HTTP itself; the production [AdminApiUsageSource]
 * (or a test double) drives this seam.
 */
fun interface ApiUsageSource {
    /** Stream the cache-then-network API-usage snapshots, cached value first. */
    fun stream(): Flow<Resource<ApiUsageStats>>
}

/**
 * The repository-backed [ApiUsageSource]. It runs one cache-then-network read of
 * `GET /api-logs/stats` through the shared [AdminRepository] (the cross-platform `useAdmin` data
 * port) and parses each [Resource] emission into an [ApiUsageStats] via [ApiUsageStats.fromJson],
 * preserving every freshness flag (cached / refreshing / stale / offline / error) so the view-model
 * can render the full state matrix. Re-collecting the cold repository flow on retry performs a fresh
 * cache-then-network read, so the error/offline retry affordance genuinely re-fetches.
 */
class AdminApiUsageSource(
    private val repository: AdminRepository,
) : ApiUsageSource {
    override fun stream(): Flow<Resource<ApiUsageStats>> =
        repository.apiLogStats().map { resource -> resource.mapValue(ApiUsageStats::fromJson) }
}

/**
 * Maps a [Resource]'s payload (when present) while preserving its status and freshness stamps. Kept
 * pure so the parse-and-preserve contract is unit-tested without a network or cache.
 */
fun <T, R> Resource<T>.mapValue(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * PII-safe diagnostics for the API Usage surface (P1/S11 diagnostics contract). Records only the
 * operational `view.opened` event with the surface slug through the single sanctioned redacting
 * [Logger] — never an endpoint path, request count, or error message — so a diagnostics line can
 * never leak operational data.
 */
class ApiUsageDiagnostics(
    private val logger: Logger,
) {
    /** Record that the surface was opened, emitting `view.opened slug=APIUsageWidget`. */
    fun recordViewOpened() {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SLUG to ApiUsageRegistration.SLUG))
    }

    private companion object {
        const val EVENT_VIEW_OPENED = "view.opened"
        const val FIELD_SLUG = "slug"
    }
}

/**
 * Lifecycle-aware state holder backing the [APIUsageWidget] surface — the native port of the web
 * `APIUsageWidget`'s hook composition. It consumes the cache-then-network [ApiUsageSource] and
 * exposes the projected [UiState] so the Composable is a thin renderer; the view performs no HTTP.
 *
 * [refresh] re-runs the read by bumping a trigger that `flatMapLatest`-re-subscribes to a fresh
 * [ApiUsageSource.stream] — backing the pull-to-refresh and the error/offline retry affordance.
 *
 * @param source the cache-then-network data port (production: [AdminApiUsageSource]).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ApiUsageViewModel(
    private val source: ApiUsageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshSignal = MutableStateFlow(0)

    /** The API-usage rollup as cache-then-network UI state (loading / content / empty / stale / error). */
    val stats: StateFlow<UiState<ApiUsageStats>> =
        refreshSignal
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { !it.hasData })

    /** Re-fetches the rollup (pull-to-refresh / retry). A no-op while nobody observes [stats]. */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshSignal.update { it + 1 }
    }

    private companion object {
        const val EVENT_REFRESH = "api_usage.refresh"
    }
}
