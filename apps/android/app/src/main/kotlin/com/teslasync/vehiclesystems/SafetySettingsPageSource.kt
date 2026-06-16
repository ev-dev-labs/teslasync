// The data seam the SafetySettingsPage vehicle-systems surface binds to, plus its production binding over a page-local
// cache-then-network repository. The view (composable) performs NO HTTP — it only collects state from the view-model,
// which drives this seam, reproducing the web page's three data reads: the live `useSecurityLatest`
// (`GET /security/latest?vehicle_id={id}`), the primary `useQuery('/safety/latest?vehicle_id={id}')`, and the history
// `useQuery('/safety?vehicle_id={id}&limit=100')`, plus the global `useSelectedVehicle` scope and `useUnits` (the
// `/settings` document).
//
// None of the three reads has a shared-core S8 store method (the web reads `/safety/latest` + `/safety` with bare
// `useQuery`, and `useSecurityLatest` is a per-vehicle Vehicles read the Android container does not surface), so all
// three are served by the co-located [SafetyExtrasRepository]: a [CachingRepository] over the SAME shared resilient
// client + offline cache the shared repositories use (so the ADR-013 freshness contract + SI-verbatim caching are
// identical), wired by the host from the primitives the DataContainer exposes — exactly how the shipped
// StatisticsPage binds its page-local `/analytics/period-stats` feed. The settings document comes from the shared
// SettingsStore. A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
// concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.safetysettings

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

/** The history page size the table + chart read (web `'/safety?vehicle_id=' + activeId + '&limit=100'`). */
private const val HISTORY_LIMIT = "100"

/** web `staleTime: 15_000` — the live `/security/latest` + primary `/safety/latest` reads. */
private const val LIVE_TTL_MILLIS = 15_000L

/** web `staleTime: 30_000` — the `/safety` history read. */
private const val HISTORY_TTL_MILLIS = 30_000L

/**
 * Page-local cache-then-network repository for the three reads the shared stores have no method for (web `useQuery` +
 * `useSecurityLatest`). It reuses the exact shared machinery — the resilient [ApiHttpClient], the offline
 * [CacheStore], and the [CachingRepository] cache-then-network operator — so each SI payload is cached verbatim and
 * the freshness/offline contract matches every other feed. All three feeds share the [CacheDomain.VehicleSystems]
 * partition (logout clears the whole domain in one call) and cache per vehicle under their own key.
 */
class SafetyExtrasRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = defaultApiJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.VehicleSystems

    /** The cache-then-network `GET /security/latest?vehicle_id={id}` feed (web `useSecurityLatest`). */
    fun securityLatest(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_SECURITY_LATEST:$vehicleId", LIVE_TTL_MILLIS) {
            api.request<JsonElement>(path = "/security/latest", query = mapOf("vehicle_id" to vehicleId))
        }

    /** The cache-then-network `GET /safety/latest?vehicle_id={id}` feed (web primary `useQuery`). */
    fun safetyLatest(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_SAFETY_LATEST:$vehicleId", LIVE_TTL_MILLIS) {
            api.request<JsonElement>(path = "/safety/latest", query = mapOf("vehicle_id" to vehicleId))
        }

    /** The cache-then-network `GET /safety?vehicle_id={id}&limit=100` history feed (web `useQuery`). */
    fun safetyHistory(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_SAFETY_HISTORY:$vehicleId", HISTORY_TTL_MILLIS) {
            api.request<JsonElement>(
                path = "/safety",
                query = mapOf("vehicle_id" to vehicleId, "limit" to HISTORY_LIMIT),
            )
        }

    private companion object {
        const val KEY_SECURITY_LATEST = "safety:security-latest"
        const val KEY_SAFETY_LATEST = "safety:latest"
        const val KEY_SAFETY_HISTORY = "safety:history"
    }
}

/**
 * The single seam the [SafetySettingsPageViewModel] depends on so it binds to an abstraction (the page-local safety
 * repository + the shared Settings holder + the app-scoped selection in production; a fake in tests), never to a
 * concrete repository or the network. Every read feed is a cache-then-network `Resource` flow (the web read hooks);
 * the selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface SafetySettingsPageSource {
    /** The cache-then-network `GET /security/latest` feed for [vehicleId] (web `useSecurityLatest`). */
    fun securityLatest(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /safety/latest` feed for [vehicleId] (web primary `useQuery`). */
    fun safetyLatest(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /safety?limit=100` history feed for [vehicleId] (web `useQuery`). */
    fun safetyHistory(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the page-local [SafetyExtrasRepository] + the shared **S8** [SettingsStore] + the app-scoped
 * [SelectedVehicleStore] — the memoized, multi-observer feeds every surface shares app-wide. The live values flow
 * through unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale /
 * offline). No HTTP touches the view.
 */
fun safetySettingsPageSourceOf(
    extras: SafetyExtrasRepository,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): SafetySettingsPageSource =
    object : SafetySettingsPageSource {
        override fun securityLatest(vehicleId: String): Flow<Resource<JsonElement>> = extras.securityLatest(vehicleId)

        override fun safetyLatest(vehicleId: String): Flow<Resource<JsonElement>> = extras.safetyLatest(vehicleId)

        override fun safetyHistory(vehicleId: String): Flow<Resource<JsonElement>> = extras.safetyHistory(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
