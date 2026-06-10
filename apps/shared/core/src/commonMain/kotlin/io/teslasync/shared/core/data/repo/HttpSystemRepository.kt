package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.presentation.system.RateLimitStatusResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

/**
 * HTTP-backed [SystemRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The single rate-limit read uses the [CacheDomain.System] partition under one
 * [SYSTEM_RATE_LIMITS_KEY] (mirroring the web `systemKeys.rateLimits` tuple
 * `['system','rate-limits']`), whose 15-second default TTL matches the web hook's
 * `RATE_LIMIT_STALE_TIME_MS` verbatim.
 *
 * The backend handler (`internal/api/ratelimit`) answers with a bare `httpx.WriteJSON` body — NOT a
 * `{data:T}` envelope — so the typed DTO is decoded directly off the wire (the web hook calls the
 * plain `request<RateLimitStatusResponse>('/system/rate-limits')`, which likewise does not unwrap).
 * The cached SI payload round-trips through the [CachingRepository] of [RateLimitStatusResponse]; a
 * transport failure surfaces as a [Resource.Error] serving the cached value (stale) rather than
 * throwing across the flow boundary. The endpoint is the version-namespaced `/system/rate-limits`;
 * the resilient client adds the `/api/v1` prefix exactly once.
 *
 * There are no mutations — the web hook file has none — so there is nothing to invalidate (logout
 * clears the whole domain).
 */
public class HttpSystemRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<RateLimitStatusResponse>(
        store,
        clock,
        json,
        RateLimitStatusResponse.serializer(),
    ),
    SystemRepository {
    override val domain: CacheDomain = CacheDomain.System

    override fun rateLimitStatus(): Flow<Resource<RateLimitStatusResponse>> =
        observe(SYSTEM_RATE_LIMITS_KEY) {
            api.request<RateLimitStatusResponse>(path = RATE_LIMITS_PATH)
        }

    private companion object {
        const val RATE_LIMITS_PATH = "/system/rate-limits"
    }
}
