// The data port the Favorite Locations widget binds to (P1/S8 state-holder seam) — the native analogue
// of the web `useVehicles` + `useLocations` + `useLocationSnapshotLatest` hook composition
// (web/src/features/dashboard/widgets/LocationFavoritesWidget.tsx), vehicle resolution included. The
// view never performs HTTP itself; the [StoreLocationFavoritesSource] (or a test fake) drives this.
// Cache-then-network freshness is preserved end to end (ADR-013): both upstream feeds' cached / stale /
// error flags are folded into one merged [Resource] so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LocationFavoritesWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.locationfavorites

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.locations.LocationsStore
import io.teslasync.shared.core.presentation.locations.VisitedLocation
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement

/** Sentinel "never fetched" stamp for the synthetic no-vehicle empty emission. */
private const val NO_FETCH = 0L

/**
 * Streams the cache-then-network combined Favorite-Locations payload the widget renders. A single-method
 * seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store
 * or the network.
 */
fun interface LocationFavoritesSource {
    /** The cache-then-network combined feed (cached value first, then the refreshed value). */
    fun stream(): Flow<Resource<LocationFavoritesData>>
}

/**
 * Fold the two upstream cache-then-network feeds — the visited-location list (web `useLocations`) and
 * the latest location snapshot (web `useLocationSnapshotLatest`) — into one merged [Resource], the
 * native analogue of the web component's combined freshness (`isLoading = locLoading || snapLoading`,
 * `error = locError ?? snapError`, `isFetching`/`isStale` ORed, `updatedAt = max(...)`). Pure, so the
 * merge contract is unit-tested without a network or cache.
 *
 * Precedence mirrors the web `WidgetShell` short-circuits exactly: a first-load over EITHER feed (no
 * cached value yet) yields a hard [Resource.Loading] (the skeleton); otherwise any failure yields a
 * [Resource.Error] preferring the locations error (web `locError ?? snapError`) while carrying any
 * cached payload so the render boundary can show last-known data + offline; otherwise an in-flight
 * refresh over cached data yields [Resource.Loading] with that data; otherwise both feeds have
 * succeeded and the result is [Resource.Success]. The merged payload is `null` only when neither feed
 * has produced any value, so a genuine first failure surfaces the hard error state.
 */
fun mergeLocationFavorites(
    locations: Resource<List<VisitedLocation>>,
    snapshot: Resource<JsonElement>,
): Resource<LocationFavoritesData> {
    val locList = locations.cached
    val snapElem = snapshot.cached
    val merged: LocationFavoritesData? =
        if (locList == null && snapElem == null) {
            null
        } else {
            LocationFavoritesData(
                locations = locList ?: emptyList(),
                snapshot = LocationStatusSnapshot.fromJson(snapElem),
            )
        }
    val fetchedAt = latestFetchedAt(locations.fetchedAtOrNull(), snapshot.fetchedAtOrNull())
    val stale = locations.stale || snapshot.stale

    if (locations.isFirstLoading() || snapshot.isFirstLoading()) {
        return Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = false)
    }
    val error = (locations as? Resource.Error)?.error ?: (snapshot as? Resource.Error)?.error
    return when {
        error != null -> Resource.Error(cached = merged, fetchedAt = fetchedAt, stale = true, error = error)
        locations is Resource.Loading || snapshot is Resource.Loading ->
            Resource.Loading(cached = merged, fetchedAt = fetchedAt, stale = stale)
        else -> Resource.Success(data = merged ?: LocationFavoritesData.EMPTY, fetchedAt = fetchedAt ?: NO_FETCH, stale = stale)
    }
}

/**
 * The shared-state-holder-backed [LocationFavoritesSource]. It resolves the scoped vehicle (the native
 * analogue of the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins, otherwise
 * the app-wide active vehicle from [activeVehicleId], which self-heals from the live vehicle list — the
 * `useVehicles` data dependency), then combines the shared [LocationsStore.visitedLocations] feed (web
 * `useLocations`) with the [VehiclesStore.locationSnapshotLatest] feed (web `useLocationSnapshotLatest`)
 * via [mergeLocationFavorites]. With no vehicle the stream emits a resolved-empty success so the surface
 * shows the badge + "No favorite locations" body, mirroring the web hooks' disabled queries
 * (`enabled: !!vehicleId` / `vehicleId > 0`). The web `refetchInterval` poll cadence is a render-layer
 * concern (a platform pull-to-refresh / live poll re-collects this feed) and is intentionally not
 * reproduced here. No HTTP touches the view — the shared stores (S7/S8) own it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StoreLocationFavoritesSource(
    private val locationsStore: LocationsStore,
    private val vehiclesStore: VehiclesStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : LocationFavoritesSource {
    override fun stream(): Flow<Resource<LocationFavoritesData>> =
        activeVehicleId.flatMapLatest { active ->
            when (val vehicleId = explicitVehicleId?.takeIf { it > 0 } ?: active) {
                null -> flowOf(Resource.Success<LocationFavoritesData>(LocationFavoritesData.EMPTY, NO_FETCH, stale = false))
                else ->
                    combine(
                        locationsStore.visitedLocations(vehicleId.toString()),
                        vehiclesStore.locationSnapshotLatest(vehicleId),
                    ) { locations, snapshot -> mergeLocationFavorites(locations, snapshot) }
            }
        }
}

/** The freshness stamp of any [Resource] variant, or `null` when nothing has loaded. */
private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }

/** True while a first load is in flight with nothing cached to show yet (web per-query `isLoading`). */
private fun Resource<*>.isFirstLoading(): Boolean = this is Resource.Loading && cached == null

/** The later of two freshness stamps (web `Math.max(...)`), tolerating either being absent. */
private fun latestFetchedAt(
    a: Long?,
    b: Long?,
): Long? =
    when {
        a == null -> b
        b == null -> a
        else -> maxOf(a, b)
    }
