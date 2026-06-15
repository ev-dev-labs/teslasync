// The data seam the StatisticsPage analytics surface binds to, plus its production binding over the shared S8 holders
// and a page-local cache-then-network repository for the one read the shared Analytics store does not yet expose. The
// view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing
// the web page's data reads: the primary `useQuery('/analytics/period-stats')`, plus `useBatteryHealthAnalytics`
// (`/analytics/battery-health`), `useMileageStats` (`/mileage/stats`), `useStateSummary` (`/vehicle-states/summary`)
// and `useFleetAnalytics` (`/analytics/fleet`), the global `useSelectedVehicle` scope, and `useUnits`/`useFormatting`
// (the `/settings` document).
//
// Four of the six feeds are shared-core cache-then-network `Resource` streams the S8 holders already expose
// (battery-health ▸ EnergyStore, mileage + state-summary + fleet ▸ AnalyticsStore, settings ▸ SettingsStore), and the
// active-vehicle scope is the app-scoped SelectedVehicleStore selection. The fifth — `/analytics/period-stats` — has
// no shared store method (the web reads it with a bare `useQuery`, not a named hook), so it is served by the
// co-located [StatisticsExtrasRepository]: a [CachingRepository] over the SAME shared resilient client + offline cache
// the shared repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical), wired by the
// host from the primitives the DataContainer exposes. A narrow seam so the view-model depends on an abstraction (real
// adapters ↔ test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.analytics.statistics

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
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/** The trailing fleet window the vehicle-comparison bar chart reads (web `useFleetAnalytics(30, …)`). */
private const val FLEET_WINDOW_DAYS = 30

/**
 * Page-local cache-then-network repository for the `/analytics/period-stats` read — the web `useQuery` the shared
 * [AnalyticsStore] has no method for (it ports only the named `useAnalytics` hooks). It reuses the exact shared
 * machinery — the resilient [ApiHttpClient], the offline [CacheStore], and the [CachingRepository] cache-then-network
 * operator — so the SI payload is cached verbatim and the freshness/offline contract matches every other feed. The
 * period totals share the [CacheDomain.Analytics] partition (logout still clears the whole domain in one call).
 */
class StatisticsExtrasRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = defaultApiJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.Analytics

    /**
     * The cache-then-network `GET /analytics/period-stats?vehicle_id={id}` feed (web
     * `request('/analytics/period-stats?vehicle_id=' + activeId)`). Cached per vehicle so each scope reads
     * independently.
     */
    fun periodStats(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_PERIOD_STATS:$vehicleId") {
            api.request<JsonElement>(path = "/analytics/period-stats", query = mapOf("vehicle_id" to vehicleId))
        }

    private companion object {
        const val KEY_PERIOD_STATS = "period-stats"
    }
}

/**
 * The single seam the [StatisticsPageViewModel] depends on so it binds to an abstraction (the shared Energy +
 * Analytics + Settings holders, the page-local period-stats repository, and the app-scoped selection in production; a
 * fake in tests), never to a concrete store or the network. Every read feed is a cache-then-network `Resource` flow
 * (the web read hooks); the selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface StatisticsPageSource {
    /**
     * The cache-then-network `GET /analytics/period-stats` feed for [vehicleId] (web primary `useQuery`). Backed by
     * [StatisticsExtrasRepository]; the view-model only requests it for a real selection (web `enabled: !!activeId`).
     */
    fun periodStats(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /analytics/battery-health` feed for [vehicleId] (web `useBatteryHealthAnalytics`). */
    fun batteryHealthAnalytics(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /mileage/stats` feed for [vehicleId] (web `useMileageStats`). */
    fun mileageStats(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /vehicle-states/summary` feed for [vehicleId] (web `useStateSummary`). */
    fun stateSummary(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /analytics/fleet?days=30` feed (web `useFleetAnalytics`) — fleet-wide, no scope. */
    fun fleetAnalytics(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`/`useFormatting`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the page-local [StatisticsExtrasRepository] + the shared **S8** [EnergyStore] +
 * [AnalyticsStore] + [SettingsStore] + the app-scoped [SelectedVehicleStore] — the memoized, multi-observer feeds
 * every surface shares app-wide. The live values flow through unchanged so the view-model renders the full state
 * matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun statisticsPageSourceOf(
    extras: StatisticsExtrasRepository,
    energyStore: EnergyStore,
    analyticsStore: AnalyticsStore,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): StatisticsPageSource =
    object : StatisticsPageSource {
        override fun periodStats(vehicleId: String): Flow<Resource<JsonElement>> = extras.periodStats(vehicleId)

        override fun batteryHealthAnalytics(vehicleId: String): Flow<Resource<JsonElement>> =
            energyStore.batteryHealthAnalytics(vehicleId)

        override fun mileageStats(vehicleId: String): Flow<Resource<JsonElement>> = analyticsStore.mileageStats(vehicleId)

        override fun stateSummary(vehicleId: String): Flow<Resource<JsonElement>> = analyticsStore.stateSummary(vehicleId)

        override fun fleetAnalytics(): Flow<Resource<JsonElement>> = analyticsStore.fleetAnalytics(days = FLEET_WINDOW_DAYS)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
