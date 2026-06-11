// The data port the Vehicle Location Map widget binds to (P1/S8 state-holder seam) — the native
// analogue of the web `useVehicles` + `useVehicleState` hook composition
// (web/src/api/hooks/useVehicles.ts), vehicle resolution included. The view never performs HTTP
// itself; the [VehiclesStoreLocationMapSource] (or a test fake) drives this. Cache-then-network
// freshness is preserved end to end (ADR-013): every emission's cached/stale/error flags flow through
// the projection so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LocationMapWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.locationmap

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * Streams the cache-then-network `GET /vehicles/{id}/state` readings the widget renders. A
 * single-method seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on
 * a concrete store or the network.
 */
fun interface LocationMapSource {
    /** The cache-then-network latest-state feed (cached value first, then the refreshed value). */
    fun stream(): Flow<Resource<VehicleLocationData?>>
}

/**
 * Parse a raw [Resource] of the [VehicleStateEnvelope] into a [Resource] of a parsed
 * [VehicleLocationData], preserving every freshness flag (cached / refreshing / stale / offline) so
 * the view-model can render the full state matrix. Pure, so the parse-and-preserve contract is
 * unit-tested without a network or cache. An envelope carrying no `state` projects to `null` (web's
 * `state = stateData?.state` being `undefined` → the empty map).
 */
internal fun Resource<VehicleStateEnvelope>.toVehicleLocation(): Resource<VehicleLocationData?> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let(VehicleLocationData::fromEnvelope),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = VehicleLocationData.fromEnvelope(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let(VehicleLocationData::fromEnvelope),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * The shared-state-holder-backed [LocationMapSource]. It resolves the scoped vehicle (the native
 * analogue of the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins, otherwise
 * the app-wide active vehicle from [activeVehicleId]), then maps the shared [VehiclesStore.vehicleState]
 * cache-then-network feed (web `useVehicleState`) into parsed readings. With no vehicle the stream
 * emits a resolved-empty success (`null` reading) so the surface shows the "No location data available"
 * empty map, mirroring the web hook's disabled query (`enabled: vehicleId > 0`, with the `id ?? 0`
 * fallback). The web `refetchInterval` poll cadence is a render-layer concern (a platform
 * pull-to-refresh / live poll re-collects this feed) and is intentionally not reproduced at this layer.
 * No HTTP touches the view — the [VehiclesStore] (S7/S8) owns it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehiclesStoreLocationMapSource(
    private val vehiclesStore: VehiclesStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : LocationMapSource {
    override fun stream(): Flow<Resource<VehicleLocationData?>> =
        activeVehicleId.flatMapLatest { active ->
            when (val vehicleId = explicitVehicleId?.takeIf { it > 0 } ?: active) {
                null -> flowOf(Resource.Success<VehicleLocationData?>(data = null, fetchedAt = NO_FETCH, stale = false))
                else -> vehiclesStore.vehicleState(vehicleId).map { it.toVehicleLocation() }
            }
        }

    private companion object {
        /** Sentinel "never fetched" stamp for the synthetic no-vehicle empty emission. */
        const val NO_FETCH = 0L
    }
}
