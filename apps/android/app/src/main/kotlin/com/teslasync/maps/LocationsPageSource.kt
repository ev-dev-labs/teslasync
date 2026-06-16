// The data seam the LocationsPage surface binds to, plus its production binding over the shared-core Location
// repository and the app-scoped active-vehicle selection. The view (composable) performs NO HTTP — it only collects
// state from the view-model, which drives this seam, reproducing the web page's read (`useLocations(vehicleId)` via
// the inline `request('/locations?vehicle_id=…')`) within the `useSelectedVehicle` scope.
//
// The visited-location feed is the shared-core cache-then-network `Resource` stream the S7 [LocationRepository]
// already exposes (`GET /locations?vehicle_id=` ▸ `safeArray`-guarded `VisitedLocation` list). The Android DI graph
// ([io.teslasync.android.data.DataContainer]) wires no LocationsStore yet, so the host constructs the shared
// [io.teslasync.shared.core.data.repo.HttpLocationRepository] over the SAME resilient client + offline cache the
// other repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical) and hands it in
// here — exactly as the sibling DrivesList surface does for its driving repository. A narrow seam so the view-model
// depends on an abstraction (real adapter ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.maps.locations

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.LocationRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.locations.VisitedLocation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [LocationsPageViewModel] depends on so it binds to an abstraction (the shared location
 * repository + the app-scoped selection in production, fakes in tests), never to a concrete repository or the
 * network. The visited-location feed is a cache-then-network `Resource` flow (the web read); the selection is the
 * global active-vehicle scope. No HTTP touches the view.
 */
interface LocationsPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /** The cache-then-network `GET /locations?vehicle_id={vehicleId}` feed (web `useLocations`). */
    fun visitedLocations(vehicleId: String): Flow<Resource<List<VisitedLocation>>>
}

/**
 * Binds the surface to the shared **S7** [LocationRepository] + the app-scoped [SelectedVehicleStore] — the memoized
 * cache-then-network feed every locations surface shares, scoped to the active vehicle. The live values flow through
 * unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale / offline).
 * No HTTP touches the view.
 */
fun locationsPageSourceOf(
    locationRepository: LocationRepository,
    selectedVehicleStore: SelectedVehicleStore,
): LocationsPageSource =
    object : LocationsPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun visitedLocations(vehicleId: String): Flow<Resource<List<VisitedLocation>>> =
            locationRepository.visitedLocations(vehicleId)
    }
