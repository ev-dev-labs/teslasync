// The data port the Position Heatmap widget binds to (P1/S8 state-holder seam) — the native analogue
// of the web `useVehicles` + `useVehiclePositions` hook composition
// (web/src/api/hooks/useVehicles.ts), vehicle resolution included. The view never performs HTTP
// itself; the [VehiclesStorePositionHeatmapSource] (or a test fake) drives this. Cache-then-network
// freshness is preserved end to end (ADR-013): every emission's cached/stale/error flags flow through
// the parse so the view-model can render the full state matrix. The `/positions` payload arrives as a
// raw JSON array (the shared repository already `safeArray`-guards it), so this file owns the decode
// from `JsonElement` to the `latitude`/`longitude` pairs the heatmap renders (web optional-chaining →
// null-safe reads). Coordinates are WGS-84 degrees and are NOT converted.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/PositionHeatmapWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.positionheatmap

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * Streams the cache-then-network `GET /vehicles/{id}/positions` readings the widget renders. A
 * single-method seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on
 * a concrete store or the network.
 */
fun interface PositionHeatmapSource {
    /** The cache-then-network positions feed (cached value first, then the refreshed value). */
    fun stream(): Flow<Resource<List<HeatPosition>>>
}

/**
 * Decode a raw `/positions` [JsonElement] (a JSON array) into the `latitude`/`longitude` pairs the
 * heatmap renders — the native analogue of the web component reading `positions` rows. Every array
 * element is kept so the badge count matches the web `safePositions.length`; a row missing or with a
 * non-numeric coordinate is coerced to `0,0` (the clustering then skips it, the web `0,0` `continue`),
 * which keeps the count honest without smearing a phantom cluster. A non-array payload yields an empty
 * list (the web `safeArray` guard).
 */
internal fun JsonElement.parseHeatPositions(): List<HeatPosition> {
    val array = this as? JsonArray ?: return emptyList()
    return array.map { element ->
        val obj = element as? JsonObject
        HeatPosition(
            latitude = (obj?.get("latitude") as? JsonPrimitive)?.doubleOrNull ?: 0.0,
            longitude = (obj?.get("longitude") as? JsonPrimitive)?.doubleOrNull ?: 0.0,
        )
    }
}

/**
 * Parse a raw [Resource] of the positions [JsonElement] into a [Resource] of decoded [HeatPosition]s,
 * preserving every freshness flag (cached / refreshing / stale / offline) so the view-model can render
 * the full state matrix. Pure, so the parse-and-preserve contract is unit-tested without a network or
 * cache.
 */
internal fun Resource<JsonElement>.toHeatPositions(): Resource<List<HeatPosition>> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.parseHeatPositions(),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = data.parseHeatPositions(),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.parseHeatPositions(),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * The shared-state-holder-backed [PositionHeatmapSource]. It resolves the scoped vehicle (the native
 * analogue of the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins, otherwise
 * the app-wide active vehicle from [activeVehicleId]), then maps the shared
 * [VehiclesStore.vehiclePositions] cache-then-network feed (web `useVehiclePositions`, default
 * [VehiclesRepository.DEFAULT_POSITIONS_LIMIT] = 100) into decoded readings. With no vehicle the stream
 * emits a resolved-empty success (empty list) so the surface shows the "No position data" empty map,
 * mirroring the web hook's disabled query (`enabled: vehicleId > 0`, with the `id ?? 0` fallback). No
 * HTTP touches the view — the [VehiclesStore] (S7/S8) owns it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehiclesStorePositionHeatmapSource(
    private val vehiclesStore: VehiclesStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
    private val limit: Int = VehiclesRepository.DEFAULT_POSITIONS_LIMIT,
) : PositionHeatmapSource {
    override fun stream(): Flow<Resource<List<HeatPosition>>> =
        activeVehicleId.flatMapLatest { active ->
            when (val vehicleId = explicitVehicleId?.takeIf { it > 0 } ?: active) {
                null -> flowOf(Resource.Success<List<HeatPosition>>(data = emptyList(), fetchedAt = NO_FETCH, stale = false))
                else -> vehiclesStore.vehiclePositions(vehicleId, limit).map { it.toHeatPositions() }
            }
        }

    private companion object {
        /** Sentinel "never fetched" stamp for the synthetic no-vehicle empty emission. */
        const val NO_FETCH = 0L
    }
}
