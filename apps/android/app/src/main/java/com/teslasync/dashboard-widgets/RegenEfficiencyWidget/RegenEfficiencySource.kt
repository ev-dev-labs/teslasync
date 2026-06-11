// The data port the Regen Braking widget binds to (P1/S8 state-holder seam) — the native analogue of
// the web `useVehicles` + `useRegenEfficiency` hook composition
// (web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx + web/src/api/hooks/useDriving.ts),
// vehicle resolution included. The view never performs HTTP itself; a shared-store-backed adapter (or
// a test fake) drives this seam. Cache-then-network freshness is preserved end to end (ADR-013):
// every emission's cached/stale/error flags flow through the parse so the view-model can render the
// full state matrix.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RegenEfficiencyWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.regenefficiency

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.driving.DrivingStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * Streams the two cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list
 * (used only to resolve the default vehicle when no explicit id is configured — web
 * `vehicles?.[0]?.id`) and the per-vehicle [regenEfficiency] card (the rendered `GET /analytics/regen`
 * feed, already parsed into a [RegenEfficiencySnapshot]). A narrow two-method seam so the view-model
 * depends on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or the
 * network.
 */
interface RegenEfficiencySource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /analytics/regen?vehicle_id=` feed for [vehicleId] (web `useRegenEfficiency`). */
    fun regenEfficiency(vehicleId: Long): Flow<Resource<RegenEfficiencySnapshot?>>
}

/**
 * Parse a raw [Resource] of the `GET /analytics/regen` JSON into a [Resource] of a parsed
 * [RegenEfficiencySnapshot], preserving every freshness flag (cached / refreshing / stale / offline) so
 * the view-model can render the full state matrix. Pure, so the parse-and-preserve contract is
 * unit-tested without a network or cache. A present-but-not-object body parses to `null` (web's
 * `data ?` falsy gate → the "No regen data" empty state).
 */
internal fun Resource<JsonElement>.toRegenEfficiencySnapshot(): Resource<RegenEfficiencySnapshot?> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let(RegenEfficiencySnapshot::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = RegenEfficiencySnapshot.fromJson(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let(RegenEfficiencySnapshot::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * Binds the widget to the shared **S8** state holders: the [VehiclesStore] supplies the memoized
 * enrolled-vehicle list (web `useVehicles`) and the [DrivingStore] supplies the per-vehicle regen card
 * (web `useRegenEfficiency`). The live values (incl. each store's background refresh) flow through
 * unchanged; re-collecting a feed performs a genuine cache-then-network re-fetch, which backs the
 * widget's manual refresh / error-retry affordance. No HTTP touches the view.
 */
class StoreRegenEfficiencySource(
    private val vehiclesStore: VehiclesStore,
    private val drivingStore: DrivingStore,
) : RegenEfficiencySource {
    override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

    override fun regenEfficiency(vehicleId: Long): Flow<Resource<RegenEfficiencySnapshot?>> =
        drivingStore.regenEfficiency(vehicleId.toString()).map { it.toRegenEfficiencySnapshot() }
}

/**
 * Binds the widget directly to the shared **S7** repositories — the cache-then-network `Flow`s the S8
 * stores also wrap. Use this when a host wants the widget to own its own collection rather than fold
 * into the shared store's memoized feeds; the freshness contract is identical. No HTTP touches the view.
 */
class RepositoryRegenEfficiencySource(
    private val vehiclesRepository: VehiclesRepository,
    private val drivingRepository: DrivingRepository,
) : RegenEfficiencySource {
    override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesRepository.vehicles()

    override fun regenEfficiency(vehicleId: Long): Flow<Resource<RegenEfficiencySnapshot?>> =
        drivingRepository.regenEfficiency(vehicleId.toString()).map { it.toRegenEfficiencySnapshot() }
}
