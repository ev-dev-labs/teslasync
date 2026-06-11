// The data port the Geofence Status widget binds to (P1/S8 state-holder seam) — the native analogue of
// the web component's hook composition (web/src/features/dashboard/widgets/GeofenceWidget.tsx:
// useVehicles + useVehicleState + useGeofences), vehicle resolution included. The view never performs
// HTTP itself; the [VehiclesLocationsGeofenceSource] adapter (or a test fake) drives this. Cache-then-
// network freshness is preserved end to end (ADR-013): every emission's cached/stale/error flags flow
// through the combine so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/GeofenceWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.geofence

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.locations.LocationsStore
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

/** `fetchedAt` stamp used for the synthetic no-vehicle state emission (no real fetch occurred). */
private const val NO_VEHICLE_FETCHED_AT = 0L

/**
 * Streams the cache-then-network combined geofence snapshot the widget renders. A single-method seam so
 * the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store or the
 * network.
 */
public fun interface GeofenceWidgetSource {
    /** The cache-then-network feed (cached value first for an instant cold start, then the refreshed value). */
    public fun stream(): Flow<Resource<GeofenceFeed>>
}

/**
 * Binds the widget to the shared **S8** holders — the memoized, multi-observer feeds every Vehicles /
 * Locations surface shares. It resolves the target vehicle from the enrolled list (web
 * `vehicleId ?? vehicles[0].id ?? 0`), then merges the cache-then-network `GET /geofences` feed (the
 * primary, freshness-bearing content) with the latest `GET /vehicles/{id}/state` value (folded into the
 * snapshot as the vehicle position). When no vehicle resolves, the state side is a synthetic empty
 * success (`null` position), so the geofence list still renders with every fence "outside" — the web
 * `useVehicleState(0)` disabled-query behaviour (`hasCoords === false`). Re-collecting these feeds
 * performs a genuine cache-then-network re-fetch, backing the widget's manual refresh affordance (the
 * web `stateRefetch()` + `fenceRefetch()`). No HTTP touches the view — the stores (S7/S8) own it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public fun geofenceWidgetSource(
    vehicles: VehiclesStore,
    locations: LocationsStore,
    explicitVehicleId: Long? = null,
): GeofenceWidgetSource =
    GeofenceWidgetSource {
        vehicles.vehicles().flatMapLatest { vehiclesRes ->
            val id = resolveVehicleId(explicitVehicleId, vehiclesRes.cached?.map { it.id })
            val fenceFlow = locations.geofences()
            val stateFlow =
                if (id > 0L) {
                    vehicles.vehicleState(id)
                } else {
                    flowOf(Resource.Success(VehicleStateEnvelope(state = null, live = false), NO_VEHICLE_FETCHED_AT, stale = false))
                }
            combine(fenceFlow, stateFlow) { fences, state -> combineGeofenceResources(fences, state) }
        }
    }

/**
 * Resolves the scoped vehicle id — the web `vehicleId ?? vehicles?.[0]?.id ?? 0`: an explicit
 * [explicitVehicleId] (the widget's placement prop) wins, otherwise the first enrolled vehicle, else 0
 * (no vehicle ⇒ the geofence list still renders with no current position).
 */
internal fun resolveVehicleId(
    explicitVehicleId: Long?,
    vehicleIds: List<Long>?,
): Long = explicitVehicleId ?: vehicleIds?.firstOrNull() ?: 0L

/**
 * Folds the two upstream feeds into one [Resource]<[GeofenceFeed]> with the web's combined freshness
 * contract (`isLoading = stateLoading || fenceLoading`, `isError = stateIsError || fenceIsError`,
 * `updatedAt = max(...)`): a first load on either side (no cached value) is [Resource.Loading] with no
 * data (the skeleton); an error on either side keeps the best-effort merged value visible as a stale,
 * error-flagged [Resource.Error] (the offline freshness chip, never a blanked surface — the web does not
 * pass `error` to its `WidgetShell`); a refresh in flight over existing data is [Resource.Loading] with
 * the merged value; and two successes are a fresh [Resource.Success]. The geofence list is the primary
 * content; the vehicle position is folded in (or `null`). Pure + internal so it is unit-tested without a
 * UI host or coroutines.
 */
internal fun combineGeofenceResources(
    fences: Resource<List<Geofence>>,
    state: Resource<VehicleStateEnvelope>,
): Resource<GeofenceFeed> {
    val merged = GeofenceFeed(coords = coordsOf(state.cached?.state), fences = fences.cached ?: emptyList())
    val mergedFetchedAt = listOfNotNull(fences.fetchedAtOrNull(), state.fetchedAtOrNull()).maxOrNull()
    val fenceFirstLoading = fences is Resource.Loading && fences.cached == null
    val stateFirstLoading = state is Resource.Loading && state.cached == null

    return when {
        fenceFirstLoading || stateFirstLoading ->
            Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fences is Resource.Error || state is Resource.Error ->
            Resource.Error(
                cached = merged,
                fetchedAt = mergedFetchedAt,
                stale = true,
                error = (fences as? Resource.Error)?.error ?: (state as Resource.Error).error,
            )

        fences is Resource.Loading || state is Resource.Loading ->
            Resource.Loading(cached = merged, fetchedAt = mergedFetchedAt, stale = fences.stale || state.stale)

        else ->
            Resource.Success(merged, fetchedAt = mergedFetchedAt ?: NO_VEHICLE_FETCHED_AT, stale = false)
    }
}

/**
 * The vehicle position, or `null` when there is no state or the reading is `(0, 0)` — the web
 * `hasCoords = vLat !== 0 || vLon !== 0` gate (an unset position is treated as "no coordinate").
 */
private fun coordsOf(state: VehicleState?): GeoCoordinate? {
    if (state == null) return null
    return if (state.latitude != 0.0 || state.longitude != 0.0) {
        GeoCoordinate(state.latitude, state.longitude)
    } else {
        null
    }
}

/** The freshness stamp carried by any [Resource] arm, or `null` when nothing has been fetched. */
private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }
