// The data port the Motor Performance widget binds to (P1/S8 state-holder seam) — the native analogue of
// the web `useVehicles` + `useMotorLatest` hook composition
// (web/src/features/dashboard/widgets/MotorPerformanceWidget.tsx + web/src/api/hooks/useVehicles.ts),
// vehicle resolution included. The view never performs HTTP itself; a shared-store-backed adapter (or a
// test fake) drives this seam. Cache-then-network freshness is preserved end to end (ADR-013): every
// emission's cached/stale/error flags flow through the parse so the view-model can render the full state
// matrix.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MotorPerformanceWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.motorperformance

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * Streams the two cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`) and the
 * per-vehicle [motorLatest] snapshot (the rendered `GET /motor/latest?vehicle_id=` feed, already parsed
 * into a [MotorSnapshot]). A narrow two-method seam so the view-model depends on an abstraction (real
 * adapter ↔ test fake), never on a concrete store/repository or the network.
 */
interface MotorPerformanceSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /motor/latest?vehicle_id={id}` feed for [vehicleId] (web `useMotorLatest`). */
    fun motorLatest(vehicleId: Long): Flow<Resource<MotorSnapshot?>>
}

/**
 * Parse a raw [Resource] of the `GET /motor/latest` JSON into a [Resource] of a parsed [MotorSnapshot],
 * preserving every freshness flag (cached / refreshing / stale / offline) so the view-model can render the
 * full state matrix. Pure, so the parse-and-preserve contract is unit-tested without a network or cache. A
 * present-but-not-object body parses to `null` (web's `!!data` falsy gate → the "No motor data" empty state).
 */
internal fun Resource<JsonElement>.toMotorSnapshot(): Resource<MotorSnapshot?> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let(MotorSnapshot::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = MotorSnapshot.fromJson(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let(MotorSnapshot::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * Binds the widget to the shared **S8** [VehiclesStore]: it supplies both the memoized enrolled-vehicle
 * list (web `useVehicles`) and the per-vehicle latest-motor snapshot (web `useMotorLatest`). The live
 * values (incl. the store's background refresh) flow through unchanged; re-collecting a feed performs a
 * genuine cache-then-network re-fetch, which backs the widget's manual refresh / error-retry affordance.
 * No HTTP touches the view.
 */
class StoreMotorPerformanceSource(
    private val vehiclesStore: VehiclesStore,
) : MotorPerformanceSource {
    override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

    override fun motorLatest(vehicleId: Long): Flow<Resource<MotorSnapshot?>> =
        vehiclesStore.motorLatest(vehicleId).map { it.toMotorSnapshot() }
}

/**
 * Binds the widget directly to the shared **S7** [VehiclesRepository] — the cache-then-network `Flow`s the
 * S8 store also wraps. Use this when a host wants the widget to own its own collection rather than fold
 * into the shared store's memoized feeds; the freshness contract is identical. No HTTP touches the view.
 */
class RepositoryMotorPerformanceSource(
    private val vehiclesRepository: VehiclesRepository,
) : MotorPerformanceSource {
    override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesRepository.vehicles()

    override fun motorLatest(vehicleId: Long): Flow<Resource<MotorSnapshot?>> =
        vehiclesRepository.motorLatest(vehicleId).map { it.toMotorSnapshot() }
}
