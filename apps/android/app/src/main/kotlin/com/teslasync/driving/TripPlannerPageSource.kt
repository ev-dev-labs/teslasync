// The data seam the TripPlannerPage surface binds to, plus its production binding over the shared-core Driving
// repository, the shared Vehicles + Settings state holders, the app-scoped active-vehicle selection, and the
// resilient API client. The view (composable) performs NO HTTP — it only collects state from the view-model,
// which drives this seam, reproducing the web page's data access:
//   • `usePlanTrip` (`POST /trip-planner/plan`) — the one mutation that computes the plan;
//   • `useGeocodeSearch` (`GET /geocode/search`) — the AddressInput autocomplete feed;
//   • `useSelectedVehicle` — the global active-vehicle scope + the fleet list for the picker;
//   • `useVehicleState` — the active vehicle's live battery level for the "Vehicle at N%" chip;
//   • `useUnits` / `useFormatting` — the `/settings` document;
//   • the `navigation_request` vehicle command behind "Send to Car".
//
// The Android DI graph ([io.teslasync.android.data.DataContainer]) wires no DrivingStore yet, so the host
// constructs the shared [io.teslasync.shared.core.data.repo.HttpDrivingRepository] over the SAME resilient client
// + offline cache the other repositories use (so the ADR-013 freshness contract + SI-verbatim caching are
// identical) and hands it in here — exactly as the sibling DrivesListPage / RegenEfficiencyPage surfaces do. A
// narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete
// repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.driving.tripplanner

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.driving.TripPlanRequest
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * The single seam the [TripPlannerPageViewModel] depends on so it binds to an abstraction (the shared driving
 * repository + the shared vehicles/settings holders + the app-scoped selection + the resilient client in
 * production, fakes in tests), never to a concrete repository or the network. No HTTP touches the view.
 */
interface TripPlannerPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /** Persists a new active-vehicle selection (web `setVehicleId`), scoping subsequent reads. */
    fun selectVehicle(id: Long)

    /** The cache-then-network `GET /vehicles` fleet feed (web `useVehicles`) backing the picker options. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicles/{id}/state` feed (web `useVehicleState`) for the battery chip. */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` / `useFormatting` source). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /geocode/search?q=` feed for [query] (web `useGeocodeSearch`). */
    fun geocode(query: String): Flow<Resource<JsonElement>>

    /** `POST /trip-planner/plan` with the [request] body (web `usePlanTrip`); returns the computed plan (SI). */
    suspend fun planTrip(request: TripPlanRequest): Result<JsonElement>

    /**
     * `POST /vehicles/{id}/command` with the `navigation_request` body (web `handleSendToCar`). Best-effort: the
     * web page swallows failures, surfacing only a toast, so callers treat a failed [Result] as a no-op.
     */
    suspend fun sendNavigation(
        vehicleId: Long,
        lat: Double,
        lng: Double,
    ): Result<JsonElement>
}

/**
 * Binds the surface to the shared **S7** [DrivingRepository] + the shared [VehiclesStore] / [SettingsStore] + the
 * app-scoped [SelectedVehicleStore] + the resilient [ApiHttpClient] — the memoized cache-then-network feeds every
 * driving surface shares, scoped to the active vehicle. The live values flow through unchanged so the view-model
 * renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun tripPlannerPageSourceOf(
    drivingRepository: DrivingRepository,
    vehiclesStore: VehiclesStore,
    selectedVehicleStore: SelectedVehicleStore,
    settingsStore: SettingsStore,
    api: ApiHttpClient,
): TripPlannerPageSource =
    object : TripPlannerPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun selectVehicle(id: Long) = selectedVehicleStore.select(id)

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> =
            vehiclesStore.vehicleState(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun geocode(query: String): Flow<Resource<JsonElement>> = drivingRepository.geocodeSearch(query)

        override suspend fun planTrip(request: TripPlanRequest): Result<JsonElement> =
            drivingRepository.planTrip(request)

        override suspend fun sendNavigation(
            vehicleId: Long,
            lat: Double,
            lng: Double,
        ): Result<JsonElement> {
            val body =
                buildJsonObject {
                    put("command", "navigation_request")
                    putJsonObject("params") {
                        put("lat", lat)
                        put("lon", lng)
                    }
                }
            return api.safeRequest<JsonElement>(
                method = HttpMethodKind.POST,
                path = "/vehicles/$vehicleId/command",
                body = body,
            )
        }
    }
