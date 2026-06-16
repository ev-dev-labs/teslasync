// The data seam the MaintenancePage vehicle-systems surface binds to, plus its production binding over the shared
// Settings holder, the app-scoped active-vehicle selection, and a page-local cache-then-network repository for the two
// reads the Android DI graph exposes no shared store for. The view (composable) performs NO HTTP — it only collects
// state from the view-model, which drives this seam, reproducing the web page's reads: `request('/maintenance')`
// (items) and `request('/maintenance/records')` (records), gated on `useSelectedVehicle`, plus `useFormatting`
// (the `/settings` document).
//
// Neither feed has a shared store method wired into the Android [io.teslasync.android.data.DataContainer], so they are
// served by the co-located [MaintenanceRepository]: a [CachingRepository] over the SAME shared resilient client +
// offline cache the shared repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical),
// constructed by the host from the primitives the container already exposes — exactly as the sibling BatteryHealth /
// TripDetail surfaces do for routes the Android graph has no store for. A narrow seam so the view-model depends on an
// abstraction (real adapters ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.maintenance

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.data.repo.CachingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.defaultApiJson
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * Page-local cache-then-network repository for the two `/maintenance` reads the Android
 * [io.teslasync.android.data.DataContainer] has no shared store for. It reuses the exact shared machinery — the
 * resilient [ApiHttpClient], the offline [CacheStore], and the [CachingRepository] cache-then-network operator — so
 * the payload is cached verbatim and the freshness/offline contract matches every other feed. Both reads share the
 * [CacheDomain.VehicleSystems] partition (logout still clears the whole domain in one call). The endpoints are the
 * version-namespaced `/maintenance` + `/maintenance/records`; the resilient client adds the `/api/v1` prefix exactly
 * once, matching the web `request('/maintenance')` / `request('/maintenance/records')` calls verbatim.
 */
class MaintenanceRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = defaultApiJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.VehicleSystems

    /** The cache-then-network `GET /maintenance` feed (web `useQuery(['maintenance', vehicleId])`). */
    fun items(): Flow<Resource<JsonElement>> =
        observe(KEY_ITEMS) { api.request<JsonElement>(path = MaintenancePageRegistration.ITEMS_PATH) }

    /** The cache-then-network `GET /maintenance/records` feed (web `useQuery(['service-records', vehicleId])`). */
    fun records(): Flow<Resource<JsonElement>> =
        observe(KEY_RECORDS) { api.request<JsonElement>(path = MaintenancePageRegistration.RECORDS_PATH) }

    private companion object {
        const val KEY_ITEMS = "maintenance-items"
        const val KEY_RECORDS = "maintenance-records"
    }
}

/**
 * The single seam the [MaintenancePageViewModel] depends on so it binds to an abstraction (the page-local maintenance
 * repository + the shared Settings holder + the app-scoped active-vehicle selection in production; a fake in tests),
 * never to a concrete repository or the network. Every read feed is a cache-then-network `Resource` flow (the web read
 * hooks); the selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface MaintenancePageSource {
    /** The cache-then-network `GET /maintenance` items feed (web `request<MaintenanceItem[]>('/maintenance')`). */
    fun items(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /maintenance/records` feed (web `request<ServiceRecord[]>('/maintenance/records')`). */
    fun records(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useFormatting`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the page-local [MaintenanceRepository] + the shared **S8** [SettingsStore] + the app-scoped
 * [SelectedVehicleStore] — the memoized, multi-observer feeds the surface shares. The live values flow through
 * unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale / offline).
 * No HTTP touches the view.
 */
fun maintenancePageSourceOf(
    repository: MaintenanceRepository,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): MaintenancePageSource =
    object : MaintenancePageSource {
        override fun items(): Flow<Resource<JsonElement>> = repository.items()

        override fun records(): Flow<Resource<JsonElement>> = repository.records()

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
