package io.teslasync.shared.core.presentation.onboarding

import io.teslasync.shared.core.data.repo.OnboardingRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the first-run onboarding gate — the cross-platform port of the
 * web `useOnboarding` hook domain (web/src/api/hooks/useOnboarding.ts). Every native onboarding
 * surface (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing the endpoint, the staleTime, the poll cadence, or the stop-when-complete rule.
 *
 * The single read is exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013):
 * the cached gate first for an instant cold start, then the refreshed value. On top of that it
 * reproduces the web hook's polling behaviour exactly:
 *  - it re-runs the cache-then-network read every [pollIntervalMillis] (default 30s, the web
 *    `refetchInterval`) WHILE the gate is incomplete;
 *  - it STOPS polling the moment the gate completes — the verbatim web
 *    `query.state.data?.is_complete ? false : 30_000`, decided through [Onboarding.shouldPoll] off
 *    the freshest known status;
 *  - [SharingStarted.WhileSubscribed] suspends the loop when nothing observes it and resumes —
 *    re-fetching from scratch — on the next subscription, mirroring the web remount-refetch.
 *
 * [refresh] restarts the poll loop from the top (re-fetching immediately), the analogue of the
 * TanStack `refetch` consumers call after kicking off a Tesla connect / vehicle sync so the gate
 * re-checks without waiting out the interval. The holder makes no network calls itself; it
 * delegates entirely to the injected [OnboardingRepository] (S7), whose read surfaces transport
 * failures as [Resource.Error] (the gate then stays pessimistically incomplete and keeps polling).
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the gate is routed through.
 * @property scope the coroutine scope the shared poll runs in; cancelling it stops polling.
 * @property pollIntervalMillis delay between successive reads while incomplete (web
 *   `refetchInterval` 30s).
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class OnboardingStore(
    private val repo: OnboardingRepository,
    private val scope: CoroutineScope,
    private val pollIntervalMillis: Long = Onboarding.POLL_INTERVAL_MILLIS,
) {
    private val trigger = MutableStateFlow(0)

    /**
     * The live onboarding gate. Cold until first collected; then emits the cached value (if any)
     * followed by the network refresh, re-fetching every [pollIntervalMillis] until the gate
     * completes, and restarting whenever [refresh] is called while it is being observed.
     */
    public val status: StateFlow<Resource<OnboardingStatus>> =
        trigger
            .flatMapLatest { pollFlow() }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = INITIAL,
            )

    /**
     * Re-runs the cache-then-network read, then — mirroring the web `refetchInterval` — waits
     * [pollIntervalMillis] and runs it again, but ONLY while [Onboarding.shouldPoll] holds for the
     * freshest known status. Once the gate completes the loop breaks and the terminal completed
     * [Resource] stays as the flow's last value, exactly as the web query stops refetching but
     * keeps its `is_complete` data.
     */
    private fun pollFlow(): Flow<Resource<OnboardingStatus>> =
        flow {
            while (true) {
                var latest: OnboardingStatus? = null
                repo.status().collect { resource ->
                    emit(resource)
                    // Track the freshest known gate: Resource.cached is the fresh data on Success
                    // and the last-known value on Loading/Error, so this ends each cycle holding
                    // the best status to decide stop-vs-continue on.
                    resource.cached?.let { latest = it }
                }
                if (!Onboarding.shouldPoll(latest)) break
                delay(pollIntervalMillis)
            }
        }

    /** Restarts the poll loop (immediate re-fetch) if observed; a no-op when nobody is subscribed. */
    public fun refresh() {
        trigger.update { it + 1 }
    }

    private companion object {
        // Keep the poll alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L

        val INITIAL: Resource<OnboardingStatus> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
