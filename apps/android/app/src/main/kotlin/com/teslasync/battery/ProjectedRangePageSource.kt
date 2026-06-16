// The data seam the ProjectedRangePage surface binds to, plus its production binding over the shared S8 holders and a
// page-local cache-then-network repository for the one read the shared stores do not expose to the Android graph. The
// view (composable) performs NO HTTP — it only collects state from the view-model, which drives this seam, reproducing
// the web page's data reads: the `/analytics/range-projection` query (web `useQuery(['range-projection', id])`), the
// global `useSelectedVehicle` scope, and `useUnits` (the `/settings` document).
//
// The Android [io.teslasync.android.data.DataContainer] wires no analytics-range store, so the projection feed is served
// by the co-located [RangeProjectionRepository]: a [CachingRepository] over the SAME shared resilient client + offline
// cache the shared repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical), wired by
// the host from the primitives the DataContainer already exposes. A narrow seam so the view-model depends on an
// abstraction (real adapters ↔ a test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.battery.projectedrange

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
 * Page-local cache-then-network repository for the `/analytics/range-projection` read the Android
 * [io.teslasync.android.data.DataContainer] has no shared store for. It reuses the exact shared machinery — the
 * resilient [ApiHttpClient], the offline [CacheStore], and the [CachingRepository] cache-then-network operator — so the
 * SI payload is cached verbatim and the freshness/offline contract matches every other feed. Cached per vehicle in the
 * [CacheDomain.Analytics] partition (logout still clears the whole domain in one call).
 */
class RangeProjectionRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = defaultApiJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.Analytics

    /**
     * The cache-then-network `GET /analytics/range-projection?vehicle_id={id}` feed (web
     * `useQuery(['range-projection', id], () => request('/analytics/range-projection?vehicle_id='+id))`). Cached per
     * vehicle so each scope reads independently.
     */
    fun rangeProjection(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY:$vehicleId") {
            api.request<JsonElement>(
                path = "/analytics/range-projection",
                query = mapOf("vehicle_id" to vehicleId),
            )
        }

    private companion object {
        const val KEY = "range-projection"
    }
}

/**
 * The single seam the [ProjectedRangePageViewModel] depends on so it binds to an abstraction (the page-local
 * projection repository, the shared Settings holder, and the app-scoped selection in production; a fake in tests),
 * never to a concrete store or the network. The read feed is a cache-then-network `Resource` flow (the web read hook);
 * the selection is the global active-vehicle scope. No HTTP touches the view.
 */
interface ProjectedRangePageSource {
    /** The cache-then-network `GET /analytics/range-projection` feed for [vehicleId] (web `useQuery`). */
    fun rangeProjection(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`). */
    fun settings(): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the page-local [RangeProjectionRepository] + the shared **S8** [SettingsStore] + the app-scoped
 * [SelectedVehicleStore] — the memoized, multi-observer feeds every surface shares app-wide. The live values flow
 * through unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale /
 * offline). No HTTP touches the view.
 */
fun projectedRangePageSourceOf(
    repository: RangeProjectionRepository,
    settingsStore: SettingsStore,
    selectedVehicleStore: SelectedVehicleStore,
): ProjectedRangePageSource =
    object : ProjectedRangePageSource {
        override fun rangeProjection(vehicleId: String): Flow<Resource<JsonElement>> =
            repository.rangeProjection(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
