// The data port the Charging Telemetry widget binds to (P1/S8 state-holder seam) — the native
// analogue of the web `useVehicles` + `useChargingTelemetryLatest` hook composition
// (web/src/api/hooks/useVehicles.ts), vehicle resolution included. The view never performs HTTP
// itself; the [VehiclesStoreChargingTelemetrySource] (or a test fake) drives this. Cache-then-network
// freshness is preserved end to end (ADR-013): every emission's cached/stale/error flags flow through
// the parse so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ChargingTelemetryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargingtelemetry

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
 * Streams the cache-then-network `GET /charging-telemetry/latest?vehicle_id=` snapshots the widget
 * renders. A single-method seam so the view-model depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store or the network.
 */
fun interface ChargingTelemetrySource {
    /** The cache-then-network latest-telemetry feed (cached value first, then the refreshed value). */
    fun stream(): Flow<Resource<ChargingTelemetrySnapshot?>>
}

/**
 * Parse a raw [Resource] of the `GET /charging-telemetry/latest` JSON into a [Resource] of a parsed
 * [ChargingTelemetrySnapshot], preserving every freshness flag (cached / refreshing / stale / offline)
 * so the view-model can render the full state matrix. Pure, so the parse-and-preserve contract is
 * unit-tested without a network or cache. A present-but-not-object body parses to `null` (web's outer
 * falsy `data ?` gate → the "Not currently charging" empty state).
 */
internal fun Resource<JsonElement>.toChargingTelemetrySnapshot(): Resource<ChargingTelemetrySnapshot?> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let(ChargingTelemetrySnapshot::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = ChargingTelemetrySnapshot.fromJson(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let(ChargingTelemetrySnapshot::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * The shared-state-holder-backed [ChargingTelemetrySource]. It resolves the scoped vehicle (the native
 * analogue of the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins,
 * otherwise the app-wide active vehicle from [activeVehicleId]), then maps the shared
 * [VehiclesStore.chargingTelemetryLatest] cache-then-network feed (web `useChargingTelemetryLatest`)
 * into parsed snapshots. With no vehicle the stream emits a resolved-empty success (`null` snapshot)
 * so the surface shows the "Not currently charging" empty state, mirroring the web hook's disabled
 * query (`enabled: vehicleId > 0`). The web `refetchInterval` poll cadence is a render-layer concern
 * (a platform pull-to-refresh / live poll re-collects this feed) and is intentionally not reproduced
 * at this layer. No HTTP touches the view — the [VehiclesStore] (S7/S8) owns it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehiclesStoreChargingTelemetrySource(
    private val vehiclesStore: VehiclesStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : ChargingTelemetrySource {
    override fun stream(): Flow<Resource<ChargingTelemetrySnapshot?>> =
        activeVehicleId.flatMapLatest { active ->
            when (val vehicleId = explicitVehicleId ?: active) {
                null -> flowOf(Resource.Success<ChargingTelemetrySnapshot?>(data = null, fetchedAt = NO_FETCH, stale = false))
                else -> vehiclesStore.chargingTelemetryLatest(vehicleId).map { it.toChargingTelemetrySnapshot() }
            }
        }

    private companion object {
        /** Sentinel "never fetched" stamp for the synthetic no-vehicle empty emission. */
        const val NO_FETCH = 0L
    }
}
