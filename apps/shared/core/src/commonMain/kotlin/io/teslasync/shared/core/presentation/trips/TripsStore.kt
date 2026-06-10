package io.teslasync.shared.core.presentation.trips

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TRIPS_FAMILY
import io.teslasync.shared.core.data.repo.TripsRepository
import io.teslasync.shared.core.data.repo.tripDetailKey
import io.teslasync.shared.core.data.repo.tripsKeyInFamily
import io.teslasync.shared.core.data.repo.tripsListKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the Trips domain — the cross-platform port of the web `useTrips`
 * hook domain (web/src/api/hooks/useTrips.ts). Every native Trips screen (the list page, the detail
 * page, and the dashboard/sharing trip widgets on Android/Apple via KMP, Windows via the C# port)
 * binds to this single holder rather than re-implementing the endpoints, the query keys, the
 * `safeArray` guard, or the param truthy-projection.
 *
 * Both reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each is
 * lazily created on first access, shared so every observer of the same `(feed, args)` folds into one
 * upstream collection, and refreshable. [trips] keys on the full [TripsParams] (the web
 * `['trips', params]` tuple) and [trip] on the id (the web `['trips', id]` tuple); refreshing
 * re-collects the cache-then-network feed, which always re-fetches while replaying the last cached
 * rows first (the web behaviour of keeping prior data during a refetch).
 *
 * The web hook file declares no mutations, so this holder exposes none. It does expose [refresh] —
 * the holder-side analogue of `invalidateQueries({ queryKey: ['trips'] })` — re-collecting every
 * observed feed under the `['trips']` family (both the list and the detail), so a platform
 * pull-to-refresh can reload the section without re-implementing the family math. The holder makes no
 * network calls itself — it delegates entirely to the injected [TripsRepository] (S7). A feed nobody
 * is observing is a no-op to refresh.
 *
 * The web hooks' lack of an explicit `staleTime`/poll cadence and the `useTrip` `enabled: !!id` lazy
 * gate are render-layer concerns and are intentionally NOT reproduced here; a platform
 * pull-to-refresh drives re-collection, and a screen simply does not collect [trip] until it has an
 * id. Values stay SI; conversion is display-only (S5). This holder mirrors the web hook's
 * single-threaded usage and is not internally synchronised; create and drive it from one confinement
 * (the platform main scope).
 *
 * @property repo the S7 data port every feed is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class TripsStore(
    private val repo: TripsRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val listFeeds = mutableMapOf<String, StateFlow<Resource<List<Trip>>>>()
    private val detailFeeds = mutableMapOf<String, StateFlow<Resource<Trip>>>()

    // ---- Reads --------------------------------------------------------------------

    /** Shared, refreshable `GET /trips` list feed for [params] (web `useTrips`). */
    public fun trips(params: TripsParams = TripsParams()): StateFlow<Resource<List<Trip>>> =
        feed(tripsListKey(params), listFeeds) { repo.trips(params) }

    /** Shared, refreshable `GET /trips/{id}` detail feed (web `useTrip`). */
    public fun trip(id: String): StateFlow<Resource<Trip>> = feed(tripDetailKey(id), detailFeeds) { repo.trip(id) }

    // ---- Refresh ------------------------------------------------------------------

    /**
     * Re-fetches every observed Trips feed (both the list and the detail) — the holder-side analogue
     * of the web `invalidateQueries({ queryKey: tripKeys.all })`. A feed nobody observes is a no-op.
     */
    public fun refresh() {
        refreshFamily(TRIPS_FAMILY)
    }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection (via [refreshFamily]), and
     * [SharingStarted.WhileSubscribed] keeps a single upstream shared across observers while at least
     * one is active.
     */
    private fun <T> feed(
        key: String,
        feeds: MutableMap<String, StateFlow<Resource<T>>>,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                )
        }

    /**
     * Re-fetches every observed feed whose key belongs to [family] under TanStack prefix-invalidation
     * semantics ([tripsKeyInFamily]). The keys are snapshotted before iterating so a concurrent feed
     * creation cannot disturb the walk; a family nobody observes is a no-op.
     */
    private fun refreshFamily(family: String) {
        triggers.keys
            .filter { tripsKeyInFamily(it, family) }
            .toList()
            .forEach { triggers[it]?.update { n -> n + 1 } }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
