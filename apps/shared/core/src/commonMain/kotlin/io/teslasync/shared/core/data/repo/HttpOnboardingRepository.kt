package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.presentation.onboarding.OnboardingStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

/**
 * HTTP-backed [OnboardingRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013) — the data-layer port of the web `useOnboarding` hook. The single contract read uses
 * the [CacheDomain.Onboarding] partition, whose 15-second default TTL mirrors the web hook's
 * `staleTime: 15_000` (web/src/api/hooks/useOnboarding.ts).
 *
 * The read goes through the generic cache-then-network operator ([observe]). There are no
 * mutations — the web hook file declares none — so there is nothing to invalidate. The endpoint is
 * the version-namespaced `/onboarding/status`; the resilient client adds the `/api/v1` prefix
 * exactly once, matching the web `request('/onboarding/status')` call verbatim.
 */
public class HttpOnboardingRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<OnboardingStatus>(store, clock, json, OnboardingStatus.serializer()),
    OnboardingRepository {
    override val domain: CacheDomain = CacheDomain.Onboarding

    override fun status(): Flow<Resource<OnboardingStatus>> = observe(KEY) { api.request<OnboardingStatus>(path = STATUS_PATH) }

    private companion object {
        const val KEY = "status"
        const val STATUS_PATH = "/onboarding/status"
    }
}
