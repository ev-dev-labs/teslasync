package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.sessions.ActiveSessionsResponse
import io.teslasync.shared.core.presentation.sessions.RevokeAllOthersResponse
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for active-session / device management — the cross-platform analogue of the web
 * `useSessions` hook domain (web/src/api/hooks/useSessions.ts). Every native Sessions surface
 * (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively through this
 * interface, so a single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The single read ([sessions]) streams a cache-then-network [Resource] (ADR-013): the cached value
 * first for an instant cold start, then the refreshed value. It resolves to
 * [ActiveSessionsResponse.Open] when the backend reports the 501 `AUTH_MODE_OPEN` sentinel —
 * normalised to a *successful* no-op exactly as the web `queryFn` does (so the section renders an
 * inline "requires forward-auth" empty state instead of an error), and otherwise to
 * [ActiveSessionsResponse.Session] with the rows (always an array, never null).
 *
 * The two mutations are non-throwing suspend [Result]s; on success each invalidates the single list
 * cache key (the data-layer analogue of the web hooks invalidating `sessionKeys.list`). Neither
 * optimistically removes a row — the web hooks deliberately wait for the step-up dialog and the
 * actual DELETE before refreshing — so the S8 store simply re-reads on success.
 *
 * Payloads are plain device metadata (ids, user-agent, ip, ISO stamps, a current flag) — not
 * display-unit-bearing — so the exact server shape round-trips unchanged; conversion would be
 * display-only (S5).
 */
public interface SessionRepository {
    /**
     * `GET /auth/sessions` — the active-session list (web `useSessions`). Resolves to
     * [ActiveSessionsResponse.Open] on the 501 `AUTH_MODE_OPEN` sentinel (a successful no-op) and
     * to [ActiveSessionsResponse.Session] otherwise; a real transport/HTTP failure surfaces through
     * [Resource.Error].
     */
    public fun sessions(): Flow<Resource<ActiveSessionsResponse>>

    /**
     * `DELETE /auth/sessions/{id}` — revoke a single session (web `useRevokeSession`). Idempotent
     * upstream (204 even when already revoked). On success the list key is evicted so the row
     * disappears on the next read.
     */
    public suspend fun revokeSession(id: String): Result<Unit>

    /**
     * `DELETE /auth/sessions/all-others` — revoke every other session for the current subject (web
     * `useRevokeAllOtherSessions`). Returns the count of revoked rows. On success the list key is
     * evicted so the remaining single row is re-read.
     */
    public suspend fun revokeAllOtherSessions(): Result<RevokeAllOthersResponse>
}
