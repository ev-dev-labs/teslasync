// The data seam the SleepEfficiencyPage surface binds to, plus its production binding over the shared S8 holders and a
// page-local cache-then-network repository for the one read the shared stores do not expose to the Android graph. The
// view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing
// the web page's data reads: `useSleepEfficiency` (`GET /analytics/sleep`), the global `useSelectedVehicle` scope, and
// `useUnits`/`useFormatting` (the `/settings` document).
//
// The sleep-efficiency feed has no shared store method wired into the Android [io.teslasync.android.data.DataContainer]
// (no AnalyticsStore method ports the sleep read), so it is served by the co-located [SleepExtrasRepository]: a
// [CachingRepository] over the SAME shared resilient client + offline cache the shared repositories use (so the
// ADR-013 freshness contract + SI-verbatim caching are identical), wired by the host from the primitives the
// DataContainer already exposes. Settings is the shared S8 [SettingsStore] feed, and the active-vehicle scope is the
// app-scoped [SelectedVehicleStore] selection. A narrow seam so the view-model depends on an abstraction (real adapters
// ↔ a test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.battery.sleepefficiency

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
 * Page-local cache-then-network repository for the `/analytics/sleep` read — the web `useSleepEfficiency` hook the
 * Android [io.teslasync.android.data.DataContainer] has no shared store for. It reuses the exact shared machinery — the
 * resilient [ApiHttpClient], the offline [CacheStore], and the [CachingRepository] cache-then-network operator — so the
 * SI payload is cached verbatim and the freshness/offline contract matches every other feed. The read shares the
 * [CacheDomain.Analytics] partition (logout still clears the whole domain in one call).
 */
class SleepExtrasRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = defaultApiJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.Analytics

    /**
     * The cache-then-network `GET /analytics/sleep?vehicle_id={id}&days={days}` feed (web
     * `useSleepEfficiency(vehicleId, days)`). Cached per vehicle + window so each scope reads independently.
     */
    fun sleepEfficiency(
        vehicleId: String,
        days: Int,
    ): Flow<Resource<JsonElement>> =
        observe("$KEY_SLEEP:$vehicleId:$days") {
            api.request<JsonElement>(
                path = "/analytics/sleep",
                query = mapOf("vehicle_id" to vehicleId, "days" to days.toString()),
            )
        }

    private companion object {
        const val KEY_SLEEP = "sleep-efficiency"
    }
}

/**
 * The single seam the [SleepEfficiencyPageViewModel] depends on so it binds to an abstraction (the page-local sleep
 * repository + the shared Settings holder + the app-scoped selection in production; a fake in tests), never to a
 * concrete store or the network. Every read feed is a cache-then-network `Resource` flow (the web read hooks); the
 * selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface SleepEfficiencyPageSource {
    /** The cache-then-network `GET /analytics/sleep` feed for [vehicleId] (web `useSleepEfficiency`). */
    fun sleepEfficiency(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`/`useFormatting`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the page-local [SleepExtrasRepository] + the shared **S8** [SettingsStore] + the app-scoped
 * [SelectedVehicleStore] — the memoized, multi-observer feeds every surface shares app-wide. The live values flow
 * through unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale /
 * offline). No HTTP touches the view.
 */
fun sleepEfficiencyPageSourceOf(
    extras: SleepExtrasRepository,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): SleepEfficiencyPageSource =
    object : SleepEfficiencyPageSource {
        override fun sleepEfficiency(vehicleId: String): Flow<Resource<JsonElement>> =
            extras.sleepEfficiency(vehicleId, SLEEP_DEFAULT_DAYS)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
