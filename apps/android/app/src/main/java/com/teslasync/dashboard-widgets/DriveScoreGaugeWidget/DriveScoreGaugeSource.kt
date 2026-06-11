// The data port the Drive Score Gauge widget binds to (P1/S8 state-holder seam) — the native analogue
// of the web `useVehicles` + `useDriveScore` hook composition
// (web/src/features/dashboard/widgets/DriveScoreGaugeWidget.tsx + web/src/api/hooks/useDriving.ts),
// vehicle resolution included. The view never performs HTTP itself; a shared-store-backed adapter (or
// a test fake) drives this seam. Cache-then-network freshness is preserved end to end (ADR-013):
// every emission's cached/stale/error flags flow through the parse so the view-model can render the
// full state matrix.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DriveScoreGaugeWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivescoregauge

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
 * `vehicles?.[0]?.id`) and the per-vehicle [driveScore] card (the rendered `GET /drives/score` feed,
 * already parsed into a [DriveScoreSnapshot]). A narrow two-method seam so the view-model depends on
 * an abstraction (real adapter ↔ test fake), never on a concrete store/repository or the network.
 */
interface DriveScoreGaugeSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /drives/score?vehicle_id=` feed for [vehicleId] (web `useDriveScore`). */
    fun driveScore(vehicleId: Long): Flow<Resource<DriveScoreSnapshot?>>
}

/**
 * Parse a raw [Resource] of the `GET /drives/score` JSON into a [Resource] of a parsed
 * [DriveScoreSnapshot], preserving every freshness flag (cached / refreshing / stale / offline) so the
 * view-model can render the full state matrix. Pure, so the parse-and-preserve contract is unit-tested
 * without a network or cache. A present-but-not-object body parses to `null` (web's `score ?` falsy
 * gate → the "No score yet" empty state).
 */
internal fun Resource<JsonElement>.toDriveScoreSnapshot(): Resource<DriveScoreSnapshot?> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let(DriveScoreSnapshot::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = DriveScoreSnapshot.fromJson(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let(DriveScoreSnapshot::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * Binds the widget to the shared **S8** state holders: the [VehiclesStore] supplies the memoized
 * enrolled-vehicle list (web `useVehicles`) and the [DrivingStore] supplies the per-vehicle drive-score
 * card (web `useDriveScore`). The live values (incl. each store's background refresh) flow through
 * unchanged; re-collecting a feed performs a genuine cache-then-network re-fetch, which backs the
 * widget's manual refresh / error-retry affordance. No HTTP touches the view.
 */
class StoreDriveScoreGaugeSource(
    private val vehiclesStore: VehiclesStore,
    private val drivingStore: DrivingStore,
) : DriveScoreGaugeSource {
    override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

    override fun driveScore(vehicleId: Long): Flow<Resource<DriveScoreSnapshot?>> =
        drivingStore.driveScore(vehicleId.toString()).map { it.toDriveScoreSnapshot() }
}

/**
 * Binds the widget directly to the shared **S7** repositories — the cache-then-network `Flow`s the S8
 * stores also wrap. Use this when a host wants the widget to own its own collection rather than fold
 * into the shared store's memoized feeds; the freshness contract is identical. No HTTP touches the view.
 */
class RepositoryDriveScoreGaugeSource(
    private val vehiclesRepository: VehiclesRepository,
    private val drivingRepository: DrivingRepository,
) : DriveScoreGaugeSource {
    override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesRepository.vehicles()

    override fun driveScore(vehicleId: Long): Flow<Resource<DriveScoreSnapshot?>> =
        drivingRepository.driveScore(vehicleId.toString()).map { it.toDriveScoreSnapshot() }
}
