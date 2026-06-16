// The data seam the RouteEfficiencyPage surface binds to, plus its production binding over the shared-core Driving
// repository, the app-scoped active-vehicle selection and the shared Settings holder. The view (composable) performs
// NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the web page's reads
// (`useRouteEfficiency(vehicleId, start, end)` -> `GET /analytics/route-efficiency`, the `useSelectedVehicle` scope,
// and the `useUnits` settings document).
//
// The route-efficiency feed is the shared-core cache-then-network `Resource` stream the S7 [DrivingRepository] already
// exposes (`routeEfficiency` -> `GET /analytics/route-efficiency?vehicle_id[&start][&end]`). The Android DI graph
// ([io.teslasync.android.data.DataContainer]) wires no DrivingStore yet, so the host constructs the shared
// [io.teslasync.shared.core.data.repo.HttpDrivingRepository] over the SAME resilient client + offline cache the other
// repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical) and hands it in here —
// exactly as the sibling DrivesListPage surface does. A narrow seam so the view-model depends on an abstraction (real
// adapter <-> test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.driving.routeefficiency

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [RouteEfficiencyPageViewModel] depends on so it binds to an abstraction (the shared driving
 * repository + the app-scoped selection + the shared settings holder in production, a fake in tests), never to a
 * concrete repository or the network. The route-efficiency feed + the settings feed are cache-then-network `Resource`
 * flows (the web read hooks); the selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface RouteEfficiencyPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /**
     * The cache-then-network `GET /analytics/route-efficiency?vehicle_id={vehicleId}[&start][&end]` feed
     * (web `useRouteEfficiency`). The [start]/[end] `YYYY-MM-DD` params are sent only when present.
     */
    fun routeEfficiency(
        vehicleId: String,
        start: String?,
        end: String?,
    ): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` source). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [DrivingRepository] + the app-scoped [SelectedVehicleStore] + the shared
 * [SettingsStore] — the memoized cache-then-network feeds every driving surface shares, scoped to the active vehicle.
 * The live values flow through unchanged so the view-model renders the full state matrix (loading / content / empty /
 * error / stale / offline). No HTTP touches the view.
 */
fun routeEfficiencyPageSourceOf(
    drivingRepository: DrivingRepository,
    selectedVehicleStore: SelectedVehicleStore,
    settingsStore: SettingsStore,
): RouteEfficiencyPageSource =
    object : RouteEfficiencyPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun routeEfficiency(
            vehicleId: String,
            start: String?,
            end: String?,
        ): Flow<Resource<JsonElement>> = drivingRepository.routeEfficiency(vehicleId, start, end)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }
