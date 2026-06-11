// The data port the Vehicle Access widget binds to — the native analogue of the web hooks the component
// composes: `useVehicles` (the fleet list, for the default vehicle), `useVehicleDrivers` +
// `useVehicleInvitations` (the per-vehicle shared-driver + invitation feeds), and `useVehicleMobileEnabled`
// (the per-vehicle mobile-access envelope). See web/src/features/dashboard/widgets/VehicleAccessWidget.tsx,
// web/src/api/hooks/useVehicleAccess.ts and web/src/api/hooks/useVehicles.ts. The view never performs HTTP;
// a concrete adapter over the shared S7/S8 data layer (or a test fake) drives this seam. Cache-then-network
// freshness is preserved end to end (ADR-013): the view-model projects each emission's cached/stale/error
// flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VehicleAccessWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehicleaccess

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehicleAccessRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleAccessStore
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleDriver
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleInvitation
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the four cache-then-network feeds the widget needs: the fleet [vehicles] list (web `useVehicles`,
 * used to resolve the default vehicle), and — scoped to one vehicle id — the [drivers] feed (web
 * `useVehicleDrivers`), the [invitations] feed (web `useVehicleInvitations`) and the [mobileEnabled]
 * envelope (web `useVehicleMobileEnabled`). A narrow seam so the view-model depends on an abstraction (real
 * adapter ↔ test fake), never on a concrete store/repository or the network.
 */
interface VehicleAccessSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network shared-driver list (web `useVehicleDrivers`). */
    fun drivers(vehicleId: String): Flow<Resource<List<VehicleDriver>>>

    /** Stream one vehicle's cache-then-network access-invitation list (web `useVehicleInvitations`). */
    fun invitations(vehicleId: String): Flow<Resource<List<VehicleInvitation>>>

    /** Stream one vehicle's cache-then-network mobile-access envelope (web `useVehicleMobileEnabled`). */
    fun mobileEnabled(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the
 * widget's manual refresh affordance (the web `refetch()`). The fleet list + mobile envelope live on the
 * [VehiclesRepository]; the drivers + invitations feeds on the [VehicleAccessRepository]. No HTTP touches
 * the view.
 */
fun vehicleAccessSource(
    vehicles: VehiclesRepository,
    access: VehicleAccessRepository,
): VehicleAccessSource =
    object : VehicleAccessSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun drivers(vehicleId: String): Flow<Resource<List<VehicleDriver>>> = access.vehicleDrivers(vehicleId)

        override fun invitations(vehicleId: String): Flow<Resource<List<VehicleInvitation>>> = access.vehicleInvitations(vehicleId)

        override fun mobileEnabled(vehicleId: String): Flow<Resource<JsonElement>> = vehicles.vehicleMobileEnabled(vehicleId)
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app; the
 * live values (incl. each store's background refresh) flow through unchanged. The fleet list + mobile
 * envelope come from the [VehiclesStore]; the drivers + invitations feeds from the [VehicleAccessStore]. No
 * HTTP touches the view.
 */
fun vehicleAccessSource(
    vehicles: VehiclesStore,
    access: VehicleAccessStore,
): VehicleAccessSource =
    object : VehicleAccessSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun drivers(vehicleId: String): Flow<Resource<List<VehicleDriver>>> = access.vehicleDrivers(vehicleId)

        override fun invitations(vehicleId: String): Flow<Resource<List<VehicleInvitation>>> = access.vehicleInvitations(vehicleId)

        override fun mobileEnabled(vehicleId: String): Flow<Resource<JsonElement>> = vehicles.vehicleMobileEnabled(vehicleId)
    }
