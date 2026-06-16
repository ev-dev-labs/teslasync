// The data seam the MapOverviewPage surface binds to, plus its production binding over the shared-core Vehicles
// repository (S7), the app-scoped active-vehicle selection, and the shared Settings holder. The view (composable)
// performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the web page's
// reads:
//   • `useVehicles` (`GET /vehicles`) — the declared parity source: the fleet list backing the selector + the
//     marker name, and the page-level loading / error / success surface;
//   • `useVehiclePositions` (`GET /vehicles/{id}/positions?limit=50`) — the latest sample (the four metric cards +
//     the vehicle marker), the trail polyline, the playback samples, and the recent-history table;
//   • `useLocationSnapshotLatest` (`GET /location-snapshots/latest?vehicle_id=`) — the home / work / HomeLink badges;
//   • `useUnits` / `useFormatting` — the `/settings` document feeding the SI -> display boundary;
//   • `useSelectedVehicle` — the global active-vehicle scope.
//
// The three reads are the shared-core cache-then-network `Resource` streams the S7 [VehiclesRepository] already
// exposes. The Android DI graph ([io.teslasync.android.data.DataContainer]) wires a `VehiclesStore`, but its
// per-feed reads are shared (un-refreshable from a page); to give the page a deterministic retry that re-fetches
// (the prompt's `error -> Retry` contract) the host constructs the shared
// [io.teslasync.shared.core.data.repo.HttpVehiclesRepository] over the SAME resilient client + offline cache the
// store uses (so the ADR-013 freshness contract + SI-verbatim caching are identical) and hands it in here — exactly
// as the sibling DrivesListPage / TripPlannerPage surfaces construct their repository. A narrow seam so the
// view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.maps

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [MapOverviewPageViewModel] depends on so it binds to an abstraction (the shared vehicles
 * repository + the app-scoped selection + the shared settings holder in production, fakes in tests), never to a
 * concrete repository or the network. The fleet / positions / location / settings feeds are cache-then-network
 * `Resource` flows (the web read hooks); the selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface MapOverviewPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /** The cache-then-network `GET /vehicles` fleet feed (web `useVehicles`) — the declared parity source. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicles/{id}/positions?limit=50` feed for [vehicleId] (web `useVehiclePositions`). */
    fun positions(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /location-snapshots/latest` feed for [vehicleId] (web `useLocationSnapshotLatest`). */
    fun locationSnapshot(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` / `useFormatting` source). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] + the app-scoped [SelectedVehicleStore] + the shared
 * [SettingsStore] — the memoized cache-then-network feeds, scoped to the active vehicle. The live values flow
 * through unchanged so the view-model renders the full state matrix (loading / content / empty / error /
 * stale / offline). No HTTP touches the view.
 */
fun mapOverviewPageSourceOf(
    vehiclesRepository: VehiclesRepository,
    selectedVehicleStore: SelectedVehicleStore,
    settingsStore: SettingsStore,
): MapOverviewPageSource =
    object : MapOverviewPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesRepository.vehicles()

        override fun positions(vehicleId: Long): Flow<Resource<JsonElement>> =
            vehiclesRepository.vehiclePositions(vehicleId, MapOverviewPageRegistration.HISTORY_LIMIT)

        override fun locationSnapshot(vehicleId: Long): Flow<Resource<JsonElement>> =
            vehiclesRepository.locationSnapshotLatest(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }
