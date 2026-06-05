package io.teslasync.shared.core.presentation.sessions

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SessionRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for active-session / device management — the cross-platform port of the
 * web `useSessions` hook domain (web/src/api/hooks/useSessions.ts). Every native Sessions screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing the endpoint, the 30s staleTime, the open-mode normalisation, or the
 * invalidate-on-revoke rule.
 *
 * The single read is exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013): the
 * cached value first for an instant cold start, then the refreshed value, refreshable via [refresh].
 * It carries [ActiveSessionsResponse.Open] when the deployment is in open mode (the web hook's
 * normalised 501 `AUTH_MODE_OPEN`) and [ActiveSessionsResponse.Session] with the rows otherwise; the
 * web hook applies no `select`, so neither does this holder.
 *
 * The two mutations are non-throwing suspend [Result]s; on success each refreshes the single feed
 * ([refresh]) — exactly as the web hooks invalidate `sessionKeys.list`. Neither optimistically
 * removes a row (the web hooks deliberately wait for the step-up dialog + the actual DELETE before
 * the list disappears the row), and a failed mutation refreshes nothing (the web `onError` skips
 * invalidation). The repository (S7) evicts the same list key on the same success, so the refresh
 * re-fetches rather than replaying a stale entry. The holder makes no network calls itself.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised; create
 * and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the feed and both mutations are routed through.
 * @property scope the coroutine scope the shared feed runs in; cancelling it stops it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class SessionsStore(
    private val repo: SessionRepository,
    private val scope: CoroutineScope,
) {
    private val trigger = MutableStateFlow(0)

    /**
     * The live active-session list. Cold until first collected; then emits the cached value (if any)
     * followed by the network refresh, and re-fetches whenever [refresh] is called while it is being
     * observed.
     */
    public val sessions: StateFlow<Resource<ActiveSessionsResponse>> =
        trigger
            .flatMapLatest { repo.sessions() }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = INITIAL,
            )

    /**
     * Revokes a single session by [id], then refreshes the list feed on success (web
     * `useRevokeSession`, which invalidates `sessionKeys.list`). A failed revoke refreshes nothing.
     */
    public suspend fun revokeSession(id: String): Result<Unit> = repo.revokeSession(id).onSuccess { refresh() }

    /**
     * Revokes every other session for the current subject, then refreshes the list feed on success
     * (web `useRevokeAllOtherSessions`, which invalidates `sessionKeys.list`). Returns the revoked
     * count. A failed revoke refreshes nothing.
     */
    public suspend fun revokeAllOtherSessions(): Result<RevokeAllOthersResponse> = repo.revokeAllOtherSessions().onSuccess { refresh() }

    /** Re-fetches the list if it is being observed; a no-op when nobody is subscribed. */
    public fun refresh() {
        trigger.update { it + 1 }
    }

    private companion object {
        // Keep the feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L

        val INITIAL: Resource<ActiveSessionsResponse> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
