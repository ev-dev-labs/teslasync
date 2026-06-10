package io.teslasync.shared.core.presentation.dashboard

import io.teslasync.shared.core.data.repo.DashboardRepository
import io.teslasync.shared.core.data.repo.DashboardStats
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the fleet-overview dashboard summary — the cross-platform port
 * of the web `useDashboard` hook domain (web/src/api/hooks/useDashboard.ts). Every native
 * Dashboard screen (Android/Apple via KMP, Windows via the C# port) binds to this single holder
 * rather than re-implementing the endpoint, the query key, or the refetch rule.
 *
 * The single read ([stats]) is exposed as a hot [StateFlow] of a cache-then-network [Resource]
 * (ADR-013): the cached summary first for an instant cold start, then the refreshed value,
 * re-fetchable via [refresh]. There are no mutations — the web hook file contains only a single
 * `useQuery` (`useDashboardStats`) — so there is no invalidation surface here, and the web hook
 * applies no `select`/derivation, so neither does this holder. Values stay SI; conversion is
 * display-only (S5).
 *
 * The holder makes no network calls itself; it delegates entirely to the injected
 * [DashboardRepository] (S7). It mirrors the web hook's single-threaded usage and is not
 * internally synchronised; create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the summary is routed through.
 * @property scope the coroutine scope the shared flow runs in; cancelling it stops it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class DashboardStore(
    private val repo: DashboardRepository,
    private val scope: CoroutineScope,
) {
    private val trigger = MutableStateFlow(0)

    /**
     * The live dashboard summary. Cold until first collected; then emits the cached value (if any)
     * followed by the network refresh, and re-fetches whenever [refresh] is called while it is
     * being observed. [SharingStarted.WhileSubscribed] keeps a single upstream shared across
     * observers while at least one is active.
     */
    public val stats: StateFlow<Resource<DashboardStats>> =
        trigger
            .flatMapLatest { repo.stats() }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = INITIAL,
            )

    /** Re-fetches the summary if it is being observed; a no-op when nobody is subscribed. */
    public fun refresh() {
        trigger.update { it + 1 }
    }

    private companion object {
        // Keep the summary's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L

        val INITIAL: Resource<DashboardStats> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
