// The data seam the SoftwareUpdatesPage vehicle-systems surface binds to, plus its production binding over the
// shared-core VehicleSystems repository, the app-scoped active-vehicle selection, and the shared Vehicles holder.
// The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam,
// reproducing the web page's reads: `request<SoftwareUpdate[]>('/software-updates')` (the canonical KMP seam is
// `VehicleSystemsRepository.softwareUpdates`), the `useSelectedVehicle` scope (the active `vehicle_id`), and the
// `vehicles` list the page resolves each row's owner name against (web `vehicleMap`).
//
// The software-update read is the shared-core cache-then-network `Resource` stream the S7
// [io.teslasync.shared.core.data.repo.VehicleSystemsRepository] already exposes (`GET /software-updates` ▸
// `softwareUpdates`, `safeArray`-guarded). The Android DI graph wires no VehicleSystemsStore yet, so the host
// constructs the shared [io.teslasync.shared.core.data.repo.HttpVehicleSystemsRepository] over the SAME resilient
// client + offline cache the other repositories use (so the ADR-013 freshness contract + SI-verbatim caching are
// identical) and hands it in here — exactly as the sibling TripList / DrivesList surfaces do. The raw SI JSON is
// parsed into the SI-agnostic [SoftwareUpdate] list once at this seam (the model's pure [parseSoftwareUpdates]),
// so the view-model + view never touch JSON. A narrow seam: the view-model depends on an abstraction (real
// adapter ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located binding helper.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.vehiclesystems.softwareupdates

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehicleSystemsRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map

/**
 * The single seam the [SoftwareUpdatesPageViewModel] depends on so it binds to an abstraction (the shared
 * VehicleSystems repository + the app-scoped selection + the shared Vehicles holder in production, fakes in tests),
 * never to a concrete repository or the network. The software-update feed + the vehicles feed are cache-then-network
 * `Resource` flows (the web read sources); the selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface SoftwareUpdatesPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /**
     * The `GET /software-updates` feed (web `request<SoftwareUpdate[]>`), surfaced as a cache-then-network
     * [Resource] stream of the parsed [SoftwareUpdate] list. The shared `safeArray` array-guard + the model's
     * verbatim [parseSoftwareUpdates] are applied at this data seam, so this always resolves to a list (never null).
     */
    fun softwareUpdates(vehicleId: String): Flow<Resource<List<SoftwareUpdate>>>

    /** The cache-then-network `GET /vehicles` feed (web `useSelectedVehicle().vehicles`) for the owner-name map. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>
}

/**
 * Binds the surface to the shared **S7** [VehicleSystemsRepository] + the app-scoped [SelectedVehicleStore] + the
 * shared [VehiclesStore] — the memoized cache-then-network feeds the surface shares. The live values flow through
 * unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale / offline);
 * the raw SI JSON is parsed into [SoftwareUpdate]s once here. No HTTP touches the view.
 */
fun softwareUpdatesPageSourceOf(
    repository: VehicleSystemsRepository,
    selectedVehicleStore: SelectedVehicleStore,
    vehiclesStore: VehiclesStore,
): SoftwareUpdatesPageSource =
    object : SoftwareUpdatesPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun softwareUpdates(vehicleId: String): Flow<Resource<List<SoftwareUpdate>>> =
            repository.softwareUpdates(vehicleId).map { resource ->
                resource.mapData { json -> parseSoftwareUpdates(json) }
            }

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()
    }

/** Re-projects a [Resource]'s payload while preserving its freshness/error envelope (the shared-store `mapData`). */
private fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
