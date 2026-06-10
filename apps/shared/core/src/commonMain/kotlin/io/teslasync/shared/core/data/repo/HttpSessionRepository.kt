package io.teslasync.shared.core.data.repo

import io.ktor.http.encodeURLPathPart
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.sessions.ActiveSessionsResponse
import io.teslasync.shared.core.presentation.sessions.RevokeAllOthersResponse
import io.teslasync.shared.core.presentation.sessions.SessionListPayload
import io.teslasync.shared.core.presentation.sessions.SessionsDerivations
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

/**
 * HTTP-backed [SessionRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The single list read uses the [CacheDomain.Sessions] partition under one [LIST_KEY]
 * (mirroring the web `sessionKeys.list` tuple `['sessions','list']`), whose 30-second default TTL
 * matches the web hook's `staleTime`.
 *
 * The read decodes the raw `{ mode, sessions }` body and normalises it through
 * [SessionsDerivations.sessionResponse] (`sessions ?? []`). The 501 `AUTH_MODE_OPEN` sentinel is
 * caught and mapped to [ActiveSessionsResponse.Open] — a *successful* no-op cached like any other
 * value — exactly as the web `queryFn` does; any other [ApiError] propagates so the read surfaces a
 * [Resource.Error]. The endpoint is the version-namespaced `/auth/sessions`; the resilient client
 * adds the `/api/v1` prefix exactly once, matching the web `request('/auth/sessions')` call verbatim.
 *
 * Both mutations call the API directly and, on success, evict ONLY the single list key ([evict]) —
 * the data-layer analogue of the web hooks invalidating `sessionKeys.list`.
 */
public class HttpSessionRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<ActiveSessionsResponse>(
        store,
        clock,
        json,
        ActiveSessionsResponse.serializer(),
    ),
    SessionRepository {
    override val domain: CacheDomain = CacheDomain.Sessions

    // ---- Read ---------------------------------------------------------------------

    override fun sessions(): Flow<Resource<ActiveSessionsResponse>> =
        observe(LIST_KEY) {
            try {
                val payload = api.request<SessionListPayload>(path = SESSIONS_PATH)
                SessionsDerivations.sessionResponse(payload.sessions)
            } catch (e: ApiError.Http) {
                // The backend's 501 AUTH_MODE_OPEN is a "feature unavailable" signal, not an error:
                // surface it as a successful open-mode value, exactly like the web queryFn.
                if (e.code == SessionsDerivations.AUTH_MODE_OPEN_CODE) {
                    ActiveSessionsResponse.Open
                } else {
                    throw e
                }
            }
        }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun revokeSession(id: String): Result<Unit> =
        // The server answers 204 No Content; read the (empty) body as raw text and discard so an
        // empty payload never triggers a spurious decode failure. The id is path-encoded, mirroring
        // the web `encodeURIComponent(id)`.
        api
            .safeRequest<String>(method = HttpMethodKind.DELETE, path = "$SESSIONS_PATH/${id.encodeURLPathPart()}")
            .map { }
            .onSuccess { evict(LIST_KEY) }

    override suspend fun revokeAllOtherSessions(): Result<RevokeAllOthersResponse> =
        api
            .safeRequest<RevokeAllOthersResponse>(method = HttpMethodKind.DELETE, path = "$SESSIONS_PATH/all-others")
            .onSuccess { evict(LIST_KEY) }

    private companion object {
        const val SESSIONS_PATH = "/auth/sessions"

        // Mirrors the web `sessionKeys.list` tuple ['sessions','list']: a single list feed.
        const val LIST_KEY = "list"
    }
}
