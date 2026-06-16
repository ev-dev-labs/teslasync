// The data seam the BatteryCellsPage battery surface binds to, plus its production binding over the shared S8 holders
// and a page-local cache-then-network repository for the one read the shared stores do not yet expose. The view
// (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing the
// web page's data reads: the primary `useQuery('/analytics/battery-cells?vehicle_id=' + activeId)`, the global
// `useSelectedVehicle` scope, and `useUnits` (the `/settings` document).
//
// The `/analytics/battery-cells` feed has no shared store method (the web reads it with a bare `useQuery`, not a named
// hook — exactly like the sibling StatisticsExtrasRepository period-stats read), so it is served by the co-located
// [BatteryCellsExtrasRepository]: a [CachingRepository] over the SAME shared resilient client + offline cache the
// shared repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical), wired by the host
// from the primitives the DataContainer exposes. The settings document + the active-vehicle scope are the shared S8
// holders. A narrow seam so the view-model depends on an abstraction (real adapters ↔ test fake), never on a concrete
// store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.battery.batterycells

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
 * Page-local cache-then-network repository for the `/analytics/battery-cells` read — the web `useQuery` no shared
 * store has a method for (the analytics store ports only the named `useAnalytics` hooks). It reuses the exact shared
 * machinery — the resilient [ApiHttpClient], the offline [CacheStore], and the [CachingRepository] cache-then-network
 * operator — so the SI payload is cached verbatim and the freshness/offline contract matches every other feed. The
 * cell snapshot shares the [CacheDomain.Analytics] partition (logout still clears the whole domain in one call).
 */
class BatteryCellsExtrasRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = defaultApiJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.Analytics

    /**
     * The cache-then-network `GET /analytics/battery-cells?vehicle_id={id}` feed (web
     * `request('/analytics/battery-cells?vehicle_id=' + activeId)`). Cached per vehicle so each scope reads
     * independently.
     */
    fun batteryCells(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_BATTERY_CELLS:$vehicleId") {
            api.request<JsonElement>(path = "/analytics/battery-cells", query = mapOf("vehicle_id" to vehicleId))
        }

    private companion object {
        const val KEY_BATTERY_CELLS = "battery-cells"
    }
}

/**
 * The single seam the [BatteryCellsPageViewModel] depends on so it binds to an abstraction (the page-local
 * battery-cells repository + the shared Settings holder + the app-scoped selection in production, a fake in tests),
 * never to a concrete store or the network. Every read feed is a cache-then-network `Resource` flow (the web read
 * hooks); the selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface BatteryCellsPageSource {
    /**
     * The cache-then-network `GET /analytics/battery-cells` feed for [vehicleId] (web primary `useQuery`). Backed by
     * [BatteryCellsExtrasRepository]; the view-model only requests it for a real selection (web `enabled: activeId !== ''`).
     */
    fun batteryCells(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the page-local [BatteryCellsExtrasRepository] + the shared **S8** [SettingsStore] + the
 * app-scoped [SelectedVehicleStore] — the memoized, multi-observer feeds every surface shares app-wide. The live
 * values flow through unchanged so the view-model renders the full state matrix (loading / content / empty / error /
 * stale / offline). No HTTP touches the view.
 */
fun batteryCellsPageSourceOf(
    extras: BatteryCellsExtrasRepository,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): BatteryCellsPageSource =
    object : BatteryCellsPageSource {
        override fun batteryCells(vehicleId: String): Flow<Resource<JsonElement>> = extras.batteryCells(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
