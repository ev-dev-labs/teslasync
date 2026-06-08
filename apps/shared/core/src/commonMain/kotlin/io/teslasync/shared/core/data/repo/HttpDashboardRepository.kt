package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

/**
 * HTTP-backed [DashboardRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The single summary read uses the [CacheDomain.Dashboard] partition, whose 1-minute
 * default TTL mirrors the web hook's `STALE_TIMES.STANDARD` (60s) `staleTime`
 * (web/src/api/hooks/useDashboard.ts) — the finer-grained refetch cadence is a UI concern (the
 * S8/platform layer chooses when to re-collect), mirroring how the web `staleTime` only gates the
 * freshness flag, not whether the cache-then-network refresh runs.
 *
 * The read goes through the generic cache-then-network operator ([observe]); the typed
 * [DashboardStats] is decoded from / written through as its canonical SI JSON, never converted.
 * There are no mutations — the web hook file declares none — so there is nothing to invalidate.
 * The endpoint is the version-namespaced `/dashboard/stats`; the resilient client adds the
 * `/api/v1` prefix exactly once, matching the web `request('/dashboard/stats')` call verbatim.
 */
public class HttpDashboardRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<DashboardStats>(store, clock, json, DashboardStats.serializer()),
    DashboardRepository {
    override val domain: CacheDomain = CacheDomain.Dashboard

    override fun stats(): Flow<Resource<DashboardStats>> = observe(KEY) { api.request<DashboardStats>(path = STATS_PATH) }

    private companion object {
        const val KEY = "stats"
        const val STATS_PATH = "/dashboard/stats"
    }
}
