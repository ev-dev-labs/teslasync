// The data port the Drivetrain Health widget binds to — the native analogue of the three web hooks the
// component composes: `useVehicles` (to resolve the default vehicle — web `vehicles?.[0]?.id`),
// `useDrivetrainHealth` (the `/drivetrain/health` feed), and `useMotorLatest` (the `/motor/latest` feed).
// See web/src/features/dashboard/widgets/DrivetrainHealthWidget.tsx + web/src/api/hooks/useDriving.ts +
// web/src/api/hooks/useVehicles.ts. The view never performs HTTP; a concrete adapter over the shared
// S7/S8 data layer (or a test fake) drives this seam. Cache-then-network freshness is preserved end to end
// (ADR-013): the view-model projects each emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DrivetrainHealthWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivetrainhealth

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.driving.DrivingStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the three cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`), the
 * per-vehicle [drivetrainHealth] document (the rendered `GET /drivetrain/health?vehicle_id=` feed, keyed by
 * the string vehicle id exactly as the web `useDrivetrainHealth(vehicleIdStr)` does), and the per-vehicle
 * [motorLatest] snapshot (the `GET /motor/latest?vehicle_id=` feed). A narrow seam so the view-model
 * depends on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or the
 * network.
 */
interface DrivetrainHealthSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /drivetrain/health?vehicle_id={id}` feed (web `useDrivetrainHealth`). */
    fun drivetrainHealth(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /motor/latest?vehicle_id={id}` snapshot feed (web `useMotorLatest`). */
    fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the
 * widget's manual refresh / error-retry affordance (the web `refetch()`). The drivetrain-health feed comes
 * from the [DrivingRepository]; the vehicles list and the latest-motor snapshot from the
 * [VehiclesRepository]. No HTTP touches the view.
 */
fun drivetrainHealthSource(
    driving: DrivingRepository,
    vehicles: VehiclesRepository,
): DrivetrainHealthSource =
    object : DrivetrainHealthSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun drivetrainHealth(vehicleId: String): Flow<Resource<JsonElement>> = driving.drivetrainHealth(vehicleId)

        override fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>> = vehicles.motorLatest(vehicleId)
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app;
 * the live values (incl. each store's background refresh) flow through unchanged. No HTTP touches the view.
 */
fun drivetrainHealthSource(
    driving: DrivingStore,
    vehicles: VehiclesStore,
): DrivetrainHealthSource =
    object : DrivetrainHealthSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun drivetrainHealth(vehicleId: String): Flow<Resource<JsonElement>> = driving.drivetrainHealth(vehicleId)

        override fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>> = vehicles.motorLatest(vehicleId)
    }
