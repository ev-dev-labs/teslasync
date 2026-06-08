package io.teslasync.shared.core.presentation.authmode

import io.teslasync.shared.core.data.repo.AuthModeRepository
import io.teslasync.shared.core.data.repo.AuthModeResponse
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the deployment auth-mode contract — the cross-platform port of
 * the web `useAuthMode` hook domain (web/src/api/hooks/useAuthMode.ts). Every auth-coupled native
 * surface (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather
 * than re-implementing the endpoint, the long staleTime, or the `forward_auth` / subject
 * derivations.
 *
 * The single read is exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013):
 * the cached contract first for an instant cold start, then the refreshed value, refreshable via
 * [refresh]. The two web convenience hooks are exposed as derived flows that fold the raw
 * contract through [AuthModeDerivations]:
 *  - [isForwardAuth] mirrors `useIsForwardAuth` — `true` only once `mode == forward_auth`,
 *    `false` while loading/errored;
 *  - [authSubject] mirrors `useAuthSubject` — the resolved subject, or `null` in open mode / when
 *    the proxy stripped the header / before the contract resolves.
 *
 * Both derivations read the *current best-known* contract ([Resource.cached]) so they default to
 * the safe "no auth" value before the first success, verbatim with the web hooks reading the
 * query's `data`. There are no mutations — the web hook file declares none — so there is no
 * invalidation surface here. The holder makes no network calls itself; it delegates entirely to
 * the injected [AuthModeRepository] (S7).
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the contract is routed through.
 * @property scope the coroutine scope the shared flows run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class AuthModeStore(
    private val repo: AuthModeRepository,
    private val scope: CoroutineScope,
) {
    private val trigger = MutableStateFlow(0)

    /**
     * The live auth-mode contract. Cold until first collected; then emits the cached value (if
     * any) followed by the network refresh, and re-fetches whenever [refresh] is called while it
     * is being observed.
     */
    public val authMode: StateFlow<Resource<AuthModeResponse>> =
        trigger
            .flatMapLatest { repo.authMode() }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = INITIAL,
            )

    /**
     * `true` only once the contract resolves to forward-auth mode — the web `useIsForwardAuth`.
     * Derived from [authMode]'s current best-known value, so it is `false` while loading/errored.
     */
    public val isForwardAuth: StateFlow<Boolean> =
        authMode
            .map { AuthModeDerivations.isForwardAuth(it.cached) }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = false,
            )

    /**
     * The current request's resolved subject, or `null` (open mode / stripped header / not yet
     * resolved) — the web `useAuthSubject`. Derived from [authMode]'s current best-known value.
     */
    public val authSubject: StateFlow<String?> =
        authMode
            .map { AuthModeDerivations.subject(it.cached) }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = null,
            )

    /** Re-fetches the contract if it is being observed; a no-op when nobody is subscribed. */
    public fun refresh() {
        trigger.update { it + 1 }
    }

    private companion object {
        // Keep the contract's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L

        val INITIAL: Resource<AuthModeResponse> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
