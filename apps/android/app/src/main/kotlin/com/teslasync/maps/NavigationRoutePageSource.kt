// The data seam the NavigationRoutePage surface binds to, plus its production binding over the shared-core Vehicles
// repository, a page-local location-history repository, the app-scoped active-vehicle selection and the shared Settings
// holder. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam,
// reproducing the web page's four reads: `useChargingTelemetryLatest(vehicleId)` (`GET /charging-telemetry/latest`), the
// `/location-snapshots/latest` snapshot read, the `/location-snapshots?limit=200` history read, the global
// `useSelectedVehicle` scope, and `useUnits` (the `/settings` document).
//
// The latest-snapshot + charging-telemetry feeds are shared-core cache-then-network `Resource<JsonElement>` streams the
// S7 [VehiclesRepository] already exposes (`locationSnapshotLatest` / `chargingTelemetryLatest`). The location-history
// list (`GET /location-snapshots?vehicle_id&limit=200`) has no method on the shared repository yet, so — exactly as the
// sibling RegenEfficiencyPage host constructs a page-local `HttpDrivingRepository` — this surface constructs a narrow
// page-local [HttpLocationHistoryRepository] over the SAME resilient client + offline cache the other repositories use
// (so the ADR-013 freshness contract + SI-verbatim caching are identical) and hands it in here. A narrow seam so the
// view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper + page-local repository.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.maps.navigationroute

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.data.repo.CachingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.defaultApiJson
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [NavigationRoutePageViewModel] depends on so it binds to an abstraction (the shared vehicles
 * repository + the page-local history repository + the app-scoped selection + the shared settings holder in production,
 * fakes in tests), never to a concrete repository or the network. Every read is a cache-then-network `Resource` flow
 * (the web read hooks); the selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface NavigationRoutePageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /** The cache-then-network `GET /location-snapshots/latest?vehicle_id` feed for [vehicleId] (web `location-latest`). */
    fun locationLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /location-snapshots?vehicle_id&limit=200` history feed (web `location-history`). */
    fun locationHistory(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /charging-telemetry/latest?vehicle_id` feed (web `useChargingTelemetryLatest`). */
    fun chargingTelemetryLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits` source). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * The page-local cache-then-network repository for the `GET /location-snapshots?vehicle_id&limit` history list — the one
 * read the shared [VehiclesRepository] does not expose yet. It reuses the shared [CachingRepository] machinery verbatim
 * (the [CacheDomain.VehicleInfo] partition, the SI-verbatim `JsonElement` cache, the ADR-013 freshness contract) over
 * the SAME resilient [ApiHttpClient] + offline [CacheStore] the container exposes, so the surface's history feed is
 * indistinguishable from the shared "latest" reads. Owns no business logic; the array shape is guarded at decode time
 * ([parseLocationHistory]) rather than here.
 */
class HttpLocationHistoryRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
) : CachingRepository<JsonElement>(store, clock, defaultApiJson, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.VehicleInfo

    /** Streams the cache-then-network location-history list for [vehicleId], capped at [limit] rows. */
    fun history(
        vehicleId: Long,
        limit: Int,
    ): Flow<Resource<JsonElement>> =
        observe(historyKey(vehicleId, limit)) {
            api.request<JsonElement>(
                path = "/location-snapshots",
                query = mapOf("vehicle_id" to vehicleId.toString(), "limit" to limit.toString()),
            )
        }

    private fun historyKey(
        vehicleId: Long,
        limit: Int,
    ): String = "location-history::$vehicleId::$limit"
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] (the latest-snapshot + charging-telemetry reads), the
 * page-local [HttpLocationHistoryRepository] (the history list), the app-scoped [SelectedVehicleStore] and the shared
 * [SettingsStore] — the memoized cache-then-network feeds scoped to the active vehicle. The live values flow through
 * unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale / offline). No
 * HTTP touches the view.
 */
fun navigationRoutePageSourceOf(
    vehiclesRepository: VehiclesRepository,
    locationHistoryRepository: HttpLocationHistoryRepository,
    selectedVehicleStore: SelectedVehicleStore,
    settingsStore: SettingsStore,
): NavigationRoutePageSource =
    object : NavigationRoutePageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun locationLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            vehiclesRepository.locationSnapshotLatest(vehicleId)

        override fun locationHistory(vehicleId: Long): Flow<Resource<JsonElement>> =
            locationHistoryRepository.history(vehicleId, NavigationRoutePageRegistration.HISTORY_LIMIT)

        override fun chargingTelemetryLatest(vehicleId: Long): Flow<Resource<JsonElement>> =
            vehiclesRepository.chargingTelemetryLatest(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }
