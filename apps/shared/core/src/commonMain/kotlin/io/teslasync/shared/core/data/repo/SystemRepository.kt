package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.system.RateLimitStatusResponse
import kotlinx.coroutines.flow.Flow

/** Cache/feed key for [SystemRepository.rateLimitStatus] — web `systemKeys.rateLimits`. */
public const val SYSTEM_RATE_LIMITS_KEY: String = "rate-limits"

/**
 * The S7 data port for the System surface — the cross-platform analogue of the web `useSystem`
 * hook domain (web/src/api/hooks/useSystem.ts), mounted under `/api/v1/system/…`. Every native
 * System screen (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively
 * through this interface, so a single fake stands in for the whole domain in the S8 state-holder
 * tests.
 *
 * The domain is READ-ONLY — `useSystem.ts` contains exactly one `useQuery` (`useRateLimitStatus`)
 * and zero mutations — so [rateLimitStatus] streams a cache-then-network [Resource] (ADR-013): the
 * cached value first for an instant cold start, then the refreshed value. There is no invalidation
 * surface because there is nothing to mutate.
 *
 * The web hook's `staleTime` (15s, `RATE_LIMIT_STALE_TIME_MS`) maps verbatim onto the
 * [io.teslasync.shared.core.cache.CacheDomain.System] freshness window; its `refetchInterval`
 * (30s, `RATE_LIMIT_REFETCH_INTERVAL_MS`) and visibility-paused polling
 * (`refetchIntervalInBackground:false`) are render-layer concerns and are intentionally NOT
 * reproduced at this layer — a platform live-poll / pull-to-refresh cadence drives re-collection.
 * Payloads are SI-agnostic budget rows (scope ids, counts, a window-seconds int, a severity enum,
 * ISO stamps) and round-trip verbatim with no conversion.
 */
public interface SystemRepository {
    /**
     * `GET /system/rate-limits` → [RateLimitStatusResponse] (web `useRateLimitStatus`). Streams the
     * cached budget snapshot first, then the refreshed one; a transport failure surfaces as
     * [Resource.Error] serving the cached value (stale) rather than throwing across the flow.
     */
    public fun rateLimitStatus(): Flow<Resource<RateLimitStatusResponse>>
}
