// The data seam the VehicleAccessPage vehicles surface binds to, plus its production binding over the shared
// Vehicles holder + the shared-core vehicle-access repository. The view (composable) performs NO HTTP — it only
// collects state from the view-model, which drives this seam, reproducing the web page's reads and mutations:
//   reads:      useVehicle(id)            (GET /vehicles/{id})            — the parent vehicle, for the breadcrumb;
//               useVehicleDrivers(id)     (GET /vehicles/{id}/drivers)    — the shared-driver list;
//               useVehicleInvitations(id) (GET /vehicles/{id}/invitations)— the access-invitation list.
//   mutations:  useRefreshVehicleDrivers     (POST /vehicles/{id}/drivers/refresh)
//               useRefreshVehicleInvitations (POST /vehicles/{id}/invitations/refresh)
//               useRemoveVehicleDriver       (DELETE /vehicles/{id}/drivers)
//               useCreateVehicleInvitation   (POST /vehicles/{id}/invitations)
//               useRevokeVehicleInvitation   (POST /vehicles/{id}/invitations/{invitationId}/revoke)
//
// The vehicle read is the shared **S8** VehiclesStore's memoized `GET /vehicles/{id}` feed (web `useVehicle`). The
// drivers + invitations reads and the five mutations are the shared **S7** VehicleAccessRepository's
// cache-then-network `Resource` flows + non-throwing `Result` mutations: each mutation evicts ONLY the affected
// vehicle's feed key on success, exactly as the matching web hook invalidates ONLY its one `vehicleAccessKeys.*(id)`
// tuple. The Android DI graph ([io.teslasync.android.data.DataContainer]) wires no VehicleAccessStore yet, so the
// host constructs the shared [io.teslasync.shared.core.data.repo.HttpVehicleAccessRepository] over the SAME resilient
// client + offline cache the other repositories use (so the ADR-013 freshness contract is identical) and hands it in
// here — exactly as the sibling TripDetail / DrivesList surfaces construct their page-local repository. A narrow seam
// so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or the
// network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.vehicles.vehicleaccess

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehicleAccessRepository
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleDriver
import io.teslasync.shared.core.presentation.vehicleaccess.VehicleInvitation
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [VehicleAccessPageViewModel] depends on so it binds to an abstraction (the shared Vehicles
 * holder + the shared vehicle-access repository in production, a fake in tests), never to a concrete store/
 * repository or the network. The three reads are cache-then-network `Resource` streams; the five mutations are
 * non-throwing suspend `Result`s. No HTTP touches the view.
 */
interface VehicleAccessPageSource {
    /** The `GET /vehicles/{id}` detail feed (web `useVehicle(id)`), for the breadcrumb display name. */
    fun vehicle(vehicleId: String): Flow<Resource<Vehicle>>

    /** The `GET /vehicles/{id}/drivers` feed (web `useVehicleDrivers(id)`); always resolves to a list. */
    fun vehicleDrivers(vehicleId: String): Flow<Resource<List<VehicleDriver>>>

    /** The `GET /vehicles/{id}/invitations` feed (web `useVehicleInvitations(id)`); always resolves to a list. */
    fun vehicleInvitations(vehicleId: String): Flow<Resource<List<VehicleInvitation>>>

    /** Re-syncs the driver list from Tesla (web `useRefreshVehicleDrivers`); evicts the drivers key on success. */
    suspend fun refreshVehicleDrivers(vehicleId: String): Result<Unit>

    /** Re-syncs the invitation list (web `useRefreshVehicleInvitations`); evicts the invitations key on success. */
    suspend fun refreshVehicleInvitations(vehicleId: String): Result<Unit>

    /** Removes the shared driver [shareUserId] (web `useRemoveVehicleDriver`); evicts the drivers key on success. */
    suspend fun removeVehicleDriver(
        vehicleId: String,
        shareUserId: Long,
    ): Result<Unit>

    /** Mints a new access invitation (web `useCreateVehicleInvitation`); evicts the invitations key on success. */
    suspend fun createVehicleInvitation(vehicleId: String): Result<Unit>

    /** Revokes the pending invitation [invitationId] (web `useRevokeVehicleInvitation`); evicts invitations key. */
    suspend fun revokeVehicleInvitation(
        vehicleId: String,
        invitationId: String,
    ): Result<Unit>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] (for the vehicle read) + the shared **S7**
 * [VehicleAccessRepository] (for the drivers/invitations reads + the five mutations) — the memoized
 * cache-then-network feeds + cache-evicting mutations every vehicle-access surface shares. The live values flow
 * through unchanged so the view-model renders the full state matrix (loading / content / empty / stale / offline /
 * error). No HTTP touches the view.
 */
fun vehicleAccessPageSourceOf(
    vehiclesStore: VehiclesStore,
    accessRepository: VehicleAccessRepository,
): VehicleAccessPageSource =
    object : VehicleAccessPageSource {
        override fun vehicle(vehicleId: String): Flow<Resource<Vehicle>> = vehiclesStore.vehicle(vehicleId)

        override fun vehicleDrivers(vehicleId: String): Flow<Resource<List<VehicleDriver>>> =
            accessRepository.vehicleDrivers(vehicleId)

        override fun vehicleInvitations(vehicleId: String): Flow<Resource<List<VehicleInvitation>>> =
            accessRepository.vehicleInvitations(vehicleId)

        override suspend fun refreshVehicleDrivers(vehicleId: String): Result<Unit> =
            accessRepository.refreshVehicleDrivers(vehicleId).map { }

        override suspend fun refreshVehicleInvitations(vehicleId: String): Result<Unit> =
            accessRepository.refreshVehicleInvitations(vehicleId).map { }

        override suspend fun removeVehicleDriver(
            vehicleId: String,
            shareUserId: Long,
        ): Result<Unit> = accessRepository.removeVehicleDriver(vehicleId, shareUserId)

        override suspend fun createVehicleInvitation(vehicleId: String): Result<Unit> =
            accessRepository.createVehicleInvitation(vehicleId).map { }

        override suspend fun revokeVehicleInvitation(
            vehicleId: String,
            invitationId: String,
        ): Result<Unit> = accessRepository.revokeVehicleInvitation(vehicleId, invitationId)
    }
