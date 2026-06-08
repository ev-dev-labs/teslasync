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
 * HTTP-backed [AuthModeRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The single contract read uses the [CacheDomain.AuthMode] partition, whose 5-minute
 * default TTL mirrors the web hook's `AUTH_MODE_STALE_MS` `staleTime`
 * (web/src/api/hooks/useAuthMode.ts) — long enough that consumer mount/unmount churn does not
 * thrash a refetch, short enough that an operator reconfiguring `open` → `forward_auth` is picked
 * up within a coffee break.
 *
 * The read goes through the generic cache-then-network operator ([observe]). There are no
 * mutations — the web hook file declares none — so there is nothing to invalidate. The endpoint
 * is the version-namespaced `/system/auth-mode`; the resilient client adds the `/api/v1` prefix
 * exactly once, matching the web `request('/system/auth-mode')` call verbatim.
 */
public class HttpAuthModeRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<AuthModeResponse>(store, clock, json, AuthModeResponse.serializer()),
    AuthModeRepository {
    override val domain: CacheDomain = CacheDomain.AuthMode

    override fun authMode(): Flow<Resource<AuthModeResponse>> = observe(KEY) { api.request<AuthModeResponse>(path = AUTH_MODE_PATH) }

    private companion object {
        const val KEY = "auth-mode"
        const val AUTH_MODE_PATH = "/system/auth-mode"
    }
}
