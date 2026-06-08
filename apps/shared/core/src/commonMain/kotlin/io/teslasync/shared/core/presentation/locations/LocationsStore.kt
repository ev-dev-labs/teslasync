package io.teslasync.shared.core.presentation.locations

import io.teslasync.shared.core.data.repo.LocationRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.geofencesKey
import io.teslasync.shared.core.data.repo.visitedLocationsKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the Locations store — the cross-platform port of the web
 * `useLocations` hook domain (web/src/api/hooks/useLocations.ts). Every native Locations screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing the endpoints, query keys, the `enabled: !!vehicleId` gate, the `safeArray` guard,
 * or the per-mutation invalidation rule.
 *
 * The two reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013), each
 * lazily created on first access and shared so every observer of the same key folds into one upstream
 * collection:
 *  - [visitedLocations] mirrors the web `useLocations` — the per-vehicle visited-location list. It
 *    gates on [locationsEnabled] (the web `enabled: !!vehicleId`): a null/empty id returns a feed that
 *    never fetches and stays at the initial Loading slot, so a screen can bind before a vehicle is
 *    selected; all such disabled feeds collapse to one stable instance.
 *  - [geofences] mirrors the web `useGeofences` — the (vehicle-agnostic) geofence list, a single
 *    shared feed.
 *
 * The single mutation [bulkDeleteGeofences] mirrors the web `useBulkGeofencesDelete`; on success it
 * refreshes EXACTLY the feed the web hook invalidates — the geofences feed only (the web
 * `invalidateQueries(locationKeys.geofences)`), never the visited-location list. Refreshing
 * re-collects the cache-then-network feed, which always re-fetches while replaying the last cached
 * value first (the web behaviour of keeping prior data during a refetch). The holder makes no network
 * calls itself — it delegates entirely to the injected [LocationRepository] (S7). Values stay SI;
 * conversion is display-only (S5). Toasts and optimistic UI are render-layer concerns and are
 * intentionally NOT reproduced here. This holder mirrors the web hook's single-threaded usage and is
 * not internally synchronised; create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class LocationsStore(
    private val repo: LocationRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val locationFeeds = mutableMapOf<String, StateFlow<Resource<List<VisitedLocation>>>>()
    private var geofenceFeed: StateFlow<Resource<List<Geofence>>>? = null

    // ---- Reads --------------------------------------------------------------------

    /**
     * Shared, refreshable `GET /locations?vehicle_id={vehicleId}` feed (web `useLocations`). When
     * [vehicleId] is null or empty the returned feed never fetches and stays at the initial Loading
     * slot — the analogue of `enabled: !!vehicleId`.
     */
    public fun visitedLocations(vehicleId: String?): StateFlow<Resource<List<VisitedLocation>>> {
        if (!locationsEnabled(vehicleId)) return DISABLED_LOCATIONS
        val id = vehicleId!!
        return locationFeeds.getOrPut(visitedLocationsKey(id)) {
            trigger(visitedLocationsKey(id))
                .flatMapLatest { repo.visitedLocations(id) }
                .stateIn(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), INITIAL_LOCATIONS)
        }
    }

    /** Shared, refreshable `GET /geofences` feed (web `useGeofences`); a single vehicle-agnostic feed. */
    public fun geofences(): StateFlow<Resource<List<Geofence>>> =
        geofenceFeed ?: trigger(geofencesKey())
            .flatMapLatest { repo.geofences() }
            .stateIn(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), INITIAL_GEOFENCES)
            .also { geofenceFeed = it }

    // ---- Mutation -----------------------------------------------------------------

    /**
     * Bulk-deletes geofences, then refreshes the geofences feed (web `useBulkGeofencesDelete`, which
     * invalidates `locationKeys.geofences` only). The visited-location list is deliberately left
     * untouched, matching the web hook's single targeted `invalidateQueries`.
     */
    public suspend fun bulkDeleteGeofences(ids: List<Long>): Result<GeofenceBulkResult> =
        repo.bulkDeleteGeofences(ids).onSuccess { refresh(geofencesKey()) }

    /** Re-fetches the geofences feed if it is being observed; a no-op otherwise. */
    public fun refreshGeofences() {
        refresh(geofencesKey())
    }

    /** Re-fetches [vehicleId]'s visited-location feed if it is being observed; a no-op otherwise. */
    public fun refreshLocations(vehicleId: String) {
        refresh(visitedLocationsKey(vehicleId))
    }

    // ---- Internals ----------------------------------------------------------------

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL_LOCATIONS: Resource<List<VisitedLocation>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
        val INITIAL_GEOFENCES: Resource<List<Geofence>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        // One stable disabled slot, so a screen bound before a vehicle is selected never fetches and
        // always sees the same instance (web `enabled: !!vehicleId`).
        val DISABLED_LOCATIONS: StateFlow<Resource<List<VisitedLocation>>> = MutableStateFlow(INITIAL_LOCATIONS)
    }
}
