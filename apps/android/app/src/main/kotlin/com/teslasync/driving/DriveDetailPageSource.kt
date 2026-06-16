// The data seam the DriveDetailPage driving surface binds to, plus its production binding over the page-local
// drive-detail repository, the shared S8 Vehicles holder, and the app-scoped live unit formatter. The view
// (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing
// the web page's reads: `useDrive(id)` (the single `GET /drives/{id}` detail feed), `useVehicle(drive.vehicleId)`
// (the owning vehicle's display name for the header), and `useUnits()` (the SI → display boundary).
//
// Each feed is a shared-core cache-then-network `Resource` stream; the drive feed comes from the page-local
// [DriveDetailRepository], the vehicle list from the shared `VehiclesStore.vehicles()`. A narrow seam so the
// view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.driving.drivedetail

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [DriveDetailPageViewModel] depends on so it binds to an abstraction (the page-local drive
 * repository + the shared Vehicles holder + the live unit formatter in production, a fake in tests), never to a
 * concrete repository or the network. The drive + vehicles feeds are cache-then-network `Resource` flows (the web
 * read hooks); [unitFormatter] is the app-scoped SI → display formatter. No HTTP touches the view.
 */
interface DriveDetailPageSource {
    /** The cache-then-network `GET /drives/{id}` detail feed (web `useDrive(id)`). */
    fun drive(id: Long): Flow<Resource<Drive>>

    /** The cache-then-network `GET /vehicles` list feed (web `useVehicle`) — supplies the owning vehicle name. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The live display-unit formatter (web `useUnits`) — the single SI → display boundary. */
    fun unitFormatter(): StateFlow<UnitFormatter>
}

/**
 * Binds the surface to the page-local [DriveDetailRepository] + the shared **S8** [VehiclesStore] + the
 * app-scoped [unitFormatter]. The live values flow through unchanged so the view-model renders the full state
 * matrix (loading / content / error / stale / offline). No HTTP touches the view.
 */
fun driveDetailPageSourceOf(
    driveRepository: DriveDetailRepository,
    vehiclesStore: VehiclesStore,
    unitFormatter: StateFlow<UnitFormatter>,
): DriveDetailPageSource =
    object : DriveDetailPageSource {
        override fun drive(id: Long): Flow<Resource<Drive>> = driveRepository.drive(id)

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun unitFormatter(): StateFlow<UnitFormatter> = unitFormatter
    }
