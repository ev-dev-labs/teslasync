// The data seam the MapTileLayer surface binds to for the deployment map-tile configuration it reads — the
// native analogue of the web `useQuery(['map-config'], getMapConfig)` hook (web/src/components/maps/MapTileLayer.tsx
// composed with web/src/api/settings.ts `getMapConfig`, `GET /system/map-config`). The view (composable)
// performs NO HTTP — it only collects state from the [MapTileLayerViewModel], which drives this seam (ADR-002),
// satisfying the "no direct HTTP from the view" contract. A concrete adapter over the shared resilient client +
// offline cache backs it in production; a test fake backs it in unit tests.
//
// There is no shared-core map-config state holder yet, and this prompt's allowed-file set is this surface only,
// so the cache-then-network feed is co-located here as a [CachingRepository] of [MapConfig] over the shared
// [ApiHttpClient] + [CacheStore] (ADR-013) — the exact shape of the sibling `HttpSystemRepository`
// (`/system/rate-limits`): the bare `/system/map-config` body is decoded directly off the wire (no `{data}`
// envelope), cached under the `System` partition's own key, and served stale on a transport failure so the
// surface's stale / offline states stay honest. The web hook's `staleTime: 5 * 60 * 1000` is reproduced as the
// per-read TTL so the freshness flag flips on the same window.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/MapTileLayer) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `MapTileLayer*` filename cannot match the
// `MapTileLayerSource` seam plus its co-located production repository + binders.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maptilelayer

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.data.repo.CachingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json

/**
 * The single seam the [MapTileLayerViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never a concrete client — the Android counterpart of the web `useQuery(['map-config'])` read. The
 * `GET /system/map-config` document is carried as the [MapConfig] the backend serves so the tile resolution
 * reads the provider + key verbatim. No HTTP touches the view.
 */
fun interface MapTileLayerSource {
    /** Cache-then-network `GET /system/map-config` feed (web `getMapConfig`). */
    fun mapConfig(): Flow<Resource<MapConfig>>
}

/** Cache key for the single map-config read, under the shared `System` partition. */
const val MAP_CONFIG_KEY: String = "map-config"

/** Version-namespaced path; the resilient client adds the `/api/v1` prefix exactly once. */
const val MAP_CONFIG_PATH: String = "/system/map-config"

/** Per-read staleness window — the web hook's `staleTime: 5 * 60 * 1000` reproduced verbatim. */
const val MAP_CONFIG_TTL_MILLIS: Long = 5L * 60L * 1000L

/**
 * HTTP-backed map-config repository over the resilient [ApiHttpClient] and the offline cache (ADR-013) — the
 * co-located analogue of `HttpSystemRepository`. The single read uses the [CacheDomain.System] partition under
 * [MAP_CONFIG_KEY] with the web-faithful 5-minute TTL. The backend answers with a bare `httpx.WriteJSON` body
 * (NOT a `{data:T}` envelope), so the typed [MapConfig] is decoded directly off the wire; a transport failure
 * surfaces as a [Resource.Error] serving the cached value (stale) rather than throwing across the flow boundary.
 * There are no mutations — the web hook declares none — so there is nothing to invalidate (logout clears the
 * whole domain).
 */
class MapConfigRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<MapConfig>(store, clock, json, MapConfig.serializer()) {
    override val domain: CacheDomain = CacheDomain.System

    /** Shared, refreshable `GET /system/map-config` feed (web `getMapConfig`). */
    fun mapConfig(): Flow<Resource<MapConfig>> =
        observe(MAP_CONFIG_KEY, MAP_CONFIG_TTL_MILLIS) {
            api.request<MapConfig>(path = MAP_CONFIG_PATH)
        }
}

/**
 * Binds the surface to a co-located [MapConfigRepository] — the cold cache-then-network `Flow`. Re-collecting
 * it performs a genuine cache-then-network re-fetch, which backs the surface's manual refresh / error-retry
 * affordance. No HTTP touches the view.
 */
fun MapConfigRepository.asMapTileLayerSource(): MapTileLayerSource {
    val repo = this
    return MapTileLayerSource { repo.mapConfig() }
}

/**
 * Convenience binder for a host that holds the shared resilient [api] client + offline [cache] (the same pair
 * the app's `DataContainer` assembles every repository over): builds the map-config repository and adapts it to
 * the surface seam in one call. No HTTP touches the view.
 */
fun mapTileLayerSource(
    api: ApiHttpClient,
    cache: CacheStore,
    clock: Clock = SystemClock,
): MapTileLayerSource = MapConfigRepository(api, cache, clock).asMapTileLayerSource()
