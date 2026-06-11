// The data port the Destination ETA widget binds to (P1/S8 state-holder seam) — the native analogue of
// the web `useVehicles` + `useLocationSnapshotLatest` hook composition (web/src/api/hooks/useVehicles.ts),
// vehicle resolution included. The view never performs HTTP itself; the
// [VehiclesStoreDestinationETASource] (or a test fake) drives this. Cache-then-network freshness is
// preserved end to end (ADR-013): every emission's cached/stale/error flags flow through the parse so
// the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DestinationETAWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.destinationeta

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * Streams the cache-then-network `GET /location-snapshots/latest?vehicle_id=` snapshots the widget
 * renders. A single-method seam so the view-model depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store or the network.
 */
fun interface DestinationETASource {
    /** The cache-then-network latest-location feed (cached value first, then the refreshed value). */
    fun stream(): Flow<Resource<LocationSnapshotData?>>
}

/**
 * Parse a raw [Resource] of the `GET /location-snapshots/latest` JSON into a [Resource] of a parsed
 * [LocationSnapshotData], preserving every freshness flag (cached / refreshing / stale / offline) so
 * the view-model can render the full state matrix. Pure, so the parse-and-preserve contract is
 * unit-tested without a network or cache. A present-but-not-object body parses to `null` (web's outer
 * `!snapshot` gate → the "No location data" empty state).
 */
internal fun Resource<JsonElement>.toLocationSnapshot(): Resource<LocationSnapshotData?> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let(LocationSnapshotData::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = LocationSnapshotData.fromJson(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let(LocationSnapshotData::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * The shared-state-holder-backed [DestinationETASource]. It resolves the scoped vehicle (the native
 * analogue of the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins, otherwise
 * the app-wide active vehicle from [activeVehicleId]), then maps the shared
 * [VehiclesStore.locationSnapshotLatest] cache-then-network feed (web `useLocationSnapshotLatest`) into
 * parsed snapshots. With no vehicle the stream emits a resolved-empty success (`null` snapshot) so the
 * surface shows the "No location data" empty state, mirroring the web hook's disabled query
 * (`enabled: vehicleId > 0`, with the `vid ?? 0` fallback). The web `refetchInterval` poll cadence is a
 * render-layer concern (a platform pull-to-refresh / live poll re-collects this feed) and is
 * intentionally not reproduced at this layer. No HTTP touches the view — the [VehiclesStore] (S7/S8)
 * owns it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehiclesStoreDestinationETASource(
    private val vehiclesStore: VehiclesStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : DestinationETASource {
    override fun stream(): Flow<Resource<LocationSnapshotData?>> =
        activeVehicleId.flatMapLatest { active ->
            when (val vehicleId = explicitVehicleId?.takeIf { it > 0 } ?: active) {
                null -> flowOf(Resource.Success<LocationSnapshotData?>(data = null, fetchedAt = NO_FETCH, stale = false))
                else -> vehiclesStore.locationSnapshotLatest(vehicleId).map { it.toLocationSnapshot() }
            }
        }

    private companion object {
        /** Sentinel "never fetched" stamp for the synthetic no-vehicle empty emission. */
        const val NO_FETCH = 0L
    }
}
