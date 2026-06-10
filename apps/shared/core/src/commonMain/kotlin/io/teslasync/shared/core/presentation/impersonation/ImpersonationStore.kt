package io.teslasync.shared.core.presentation.impersonation

import io.teslasync.shared.core.data.repo.ImpersonationRepository
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
 * UI-free shared state holder for admin impersonation — the cross-platform port of the web
 * `useImpersonation` hook domain (web/src/api/hooks/useImpersonation.ts). Every native Impersonation
 * surface (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, the open-mode normalisation, or the invalidate-all rule.
 *
 * Reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013):
 *  - [status] mirrors the web `useImpersonationStatus` — the live impersonation state, refreshable
 *    via [refresh]. The web hook polls every 30s; that cadence is an S8/UI concern (the platform
 *    layer drives [refresh] on a timer), exactly as the other ports treat `refetchInterval`.
 *  - [candidates] mirrors the web `useImpersonationCandidates` — the impersonatable subjects. The
 *    web hook defaults `enabled: false` (consumers opt in); the [StateFlow] is cold until collected
 *    (`WhileSubscribed`), so a screen that never observes it issues no `/candidates` query — the
 *    faithful analogue of the opt-in.
 *
 * Two derived predicate flows fold the current best-known [status] through
 * [ImpersonationDerivations], mirroring the web `isImpersonationOpenMode` / `isImpersonationActive`
 * helpers:
 *  - [isOpenMode] is `true` only once the state resolves to open mode (`false` while loading);
 *  - [isActive] is `true` only while a session is active (the banner-visible signal).
 *
 * Mutations are non-throwing suspend [Result]s; on success each calls [refreshAll], which re-collects
 * BOTH observed feeds. The web start/end invalidate every query because the answering principal
 * changed; the repository (S7) reproduces the cross-domain part by clearing the whole offline cache
 * and priming the status partition with the new state, so this holder only needs to restart its own
 * feeds — they re-read the primed cache (the banner flips immediately) and then re-fetch from the
 * network. The holder makes no network calls itself.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class ImpersonationStore(
    private val repo: ImpersonationRepository,
    private val scope: CoroutineScope,
) {
    private val statusTrigger = MutableStateFlow(0)
    private val candidatesTrigger = MutableStateFlow(0)

    /**
     * The live impersonation state (web `useImpersonationStatus`). Cold until first collected; then
     * emits the cached value (if any) followed by the network refresh, and re-fetches whenever
     * [refresh] or [refreshAll] is called while it is being observed.
     */
    public val status: StateFlow<Resource<ImpersonationStatus>> =
        statusTrigger
            .flatMapLatest { repo.impersonationStatus() }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = INITIAL_STATUS,
            )

    /**
     * The impersonatable-subjects feed (web `useImpersonationCandidates`). Cold until first
     * collected — the analogue of the web hook's `enabled: false` opt-in — and refreshable via
     * [refreshCandidates] or [refreshAll].
     */
    public val candidates: StateFlow<Resource<ImpersonationCandidatesResponse>> =
        candidatesTrigger
            .flatMapLatest { repo.impersonationCandidates() }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = INITIAL_CANDIDATES,
            )

    /**
     * `true` only once the state resolves to open mode — the web `isImpersonationOpenMode`. Derived
     * from [status]'s current best-known value, so it is `false` while loading/errored.
     */
    public val isOpenMode: StateFlow<Boolean> =
        status
            .map { ImpersonationDerivations.isImpersonationOpenMode(it.cached) }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = false,
            )

    /**
     * `true` only while an impersonation session is active — the web `isImpersonationActive`.
     * Derived from [status]'s current best-known value.
     */
    public val isActive: StateFlow<Boolean> =
        status
            .map { ImpersonationDerivations.isImpersonationActive(it.cached) }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = false,
            )

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Starts impersonating [request].subject (web `useStartImpersonation`). On success the repository
     * has already wiped the cache + primed the new active state, so [refreshAll] re-collects both
     * feeds: the status feed reads the primed active value, then re-fetches as the new principal.
     */
    public suspend fun startImpersonation(request: ImpersonationStartRequest): Result<ImpersonationStatus> =
        repo.startImpersonation(request).onSuccess { refreshAll() }

    /**
     * Ends the current session (web `useEndImpersonation`). Idempotent. On success the repository has
     * wiped the cache + primed inactive, so [refreshAll] re-collects both feeds as the original admin.
     */
    public suspend fun endImpersonation(): Result<Unit> = repo.endImpersonation().onSuccess { refreshAll() }

    // ---- Refresh ------------------------------------------------------------------

    /** Re-fetches the [status] feed if it is being observed; a no-op when nobody is subscribed. */
    public fun refresh() {
        statusTrigger.update { it + 1 }
    }

    /** Re-fetches the [candidates] feed if it is being observed; a no-op when nobody is subscribed. */
    public fun refreshCandidates() {
        candidatesTrigger.update { it + 1 }
    }

    /**
     * Re-fetches BOTH observed feeds — the holder-side analogue of the web mutations'
     * argument-less `invalidateQueries()`. A feed nobody is observing is a no-op.
     */
    public fun refreshAll() {
        refresh()
        refreshCandidates()
    }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL_STATUS: Resource<ImpersonationStatus> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
        val INITIAL_CANDIDATES: Resource<ImpersonationCandidatesResponse> =
            Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
