// Pure, framework-free model + projection + diagnostics for the MapTileLayer shared surface — the native
// analogue of every decision the web component makes (web/src/components/maps/MapTileLayer.tsx) before it
// hands a tile source to the map framework. No Compose, no Android UI, no HTTP: every declaration here is
// exercised off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a tile-source
// SELECTOR. It reads the deployment map-config (`useQuery(['map-config'], getMapConfig)` -> the
// `GET /system/map-config` document `{ provider: 'free' | 'azure' | 'google', api_key }`), chooses one of
// three tile-definition sets (community CARTO / OSM / Esri / OpenTopoMap when no key, else Azure Maps or
// Google tiles), and returns the `{ url, attribution }` for the requested `style` (dark / streets /
// satellite / terrain), defaulting to the dark entry. The two sibling exports are leaflet plumbing:
// MapInvalidator (a resize re-tile) has no native analogue (the Maps SDK re-tiles on its own), and
// MapFullscreenControl is a FullscreenButton overlay — reproduced as map-free chrome in the view.
//
// Why this model carries the tile URL/attribution resolution (the parity-critical core) but the view applies
// the STYLE dimension through the shared TeslaMap wrapper rather than a raster overlay: the house rule
// (followed by the sibling LocationMapWidget surface) is that a surface NEVER imports the maps SDK directly —
// it composes the `components/maps` wrappers. There is no tile-overlay wrapper and this prompt's allowed-file
// set is this surface only, so the leaflet `{s}{z}{x}{y}{r}` URL templates + per-provider attribution are
// reproduced and asserted here, the live map applies the resolved [MapStyleId] via TeslaMap, and the resolved
// attribution is surfaced as honest chrome. The free-default provider is valid content (its community
// attribution is shown), never a hidden/blank surface — the same absent-state honesty the sibling RouteDisplay
// surface documents: the `/system/map-config` feed always resolves to a usable provider, so there is no
// genuine "no data" empty branch in the web source to reproduce.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/MapTileLayer — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maptilelayer

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.maps.MapStyleId
import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.abs

/**
 * Canonical registry metadata for the MapTileLayer surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`MapTileLayer`); [ID] is
 * the stable `viewModel` key the composable binds the surface with.
 */
object MapTileLayerRegistration {
    /** Stable surface id (also the `viewModel` key the host binds this surface with). */
    const val ID: String = "map-tile-layer"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "MapTileLayer"
}

/**
 * The Android string-resource names the surface resolves through the i18n facade (P1/S10). The web source is
 * anonymous (its only literals are tile-provider brand names in the attribution HTML, marked `i18n-ignore`),
 * so the surrounding cache-then-network microcopy (loading / error / stale / offline / fullscreen / map label)
 * reuses catalog keys that already ship — the same approach the sibling ActiveVehicleSegment / UserCell
 * surfaces take — rather than inventing new ones. Each name maps to a `translation_*` resource in `values/`.
 */
object MapTileLayerKeys {
    /** Map region a11y label / error-surface resource noun — `translation_mapOverview_title`. */
    const val MAP_LABEL: String = "translation_mapOverview_title"

    /** Loading affordance label — `translation_common_loading`. */
    const val LOADING: String = "translation_common_loading"

    /** Loading a11y label — `translation_a11y_loading`. */
    const val LOADING_A11Y: String = "translation_a11y_loading"

    /** Hard-error chip title — `translation_queryError_title`. */
    const val ERROR_TITLE: String = "translation_queryError_title"

    /** Retry affordance label — `translation_common_retry`. */
    const val RETRY: String = "translation_common_retry"

    /** Stale chip — `translation_mqtt_stale`. */
    const val STALE: String = "translation_mqtt_stale"

    /** Offline chip — `translation_common_offline`. */
    const val OFFLINE: String = "translation_common_offline"

    /** Enter-fullscreen accessible label — `translation_common_fullscreen_enter`. */
    const val FULLSCREEN_ENTER: String = "translation_common_fullscreen_enter"

    /** Exit-fullscreen accessible label — `translation_common_fullscreen_exit`. */
    const val FULLSCREEN_EXIT: String = "translation_common_fullscreen_exit"
}

/**
 * The deployment map-tile configuration — the native port of the web `MapConfig` (`GET /system/map-config`).
 * The backend serves a bare body `{ provider, api_key }` (no `{data}` envelope, like `/system/rate-limits`),
 * so this is decoded directly off the wire. Both fields default so a missing/partial document degrades to the
 * community provider rather than throwing (the web reads `mapConfig?.provider` defensively).
 */
@Serializable
data class MapConfig(
    @SerialName("provider") val provider: String = PROVIDER_FREE,
    @SerialName("api_key") val apiKey: String = "",
) {
    companion object {
        /** The default community configuration (no key) — what an unconfigured deployment serves. */
        val FREE: MapConfig = MapConfig(provider = PROVIDER_FREE, apiKey = "")
    }
}

/** Wire value for the keyless community provider (CARTO / OSM / Esri / OpenTopoMap). */
const val PROVIDER_FREE: String = "free"

/** Wire value for the Azure Maps provider. */
const val PROVIDER_AZURE: String = "azure"

/** Wire value for the Google Maps provider. */
const val PROVIDER_GOOGLE: String = "google"

/**
 * The resolved tile provider — the native tag for the web's three tile-definition sets. [Free] is the keyless
 * community fallback; [Azure] / [Google] require a non-blank `api_key` (the web `provider === 'azure' &&
 * api_key` guard), otherwise the resolution falls back to [Free].
 */
enum class MapProvider { Free, Azure, Google }

/**
 * One tile source — the native port of the web `TileDef`. [url] is a leaflet-style template
 * (`{s}`/`{z}`/`{x}`/`{y}`/`{r}` substituted by [tileUrl]); [attribution] is the display-ready, plain-text
 * reduction of the web HTML attribution (the brand `&copy; <a>…</a>` becomes `© …`), since a native Caption
 * renders text, not HTML.
 */
data class TileDef(
    val url: String,
    val attribution: String,
)

// ── Tile URL templates (1:1 with the web `freeTiles` / `azureTiles` / `googleTiles`). ──────────────────────

/** CARTO dark base raster (community). */
const val FREE_DARK_URL: String = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"

/** OpenStreetMap standard raster (community). */
const val FREE_STREETS_URL: String = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"

/** Esri World Imagery raster (community). Note the `{z}/{y}/{x}` axis order (web verbatim). */
const val FREE_SATELLITE_URL: String =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

/** OpenTopoMap terrain raster (community). */
const val FREE_TERRAIN_URL: String = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"

/** Azure Maps tile endpoint prefix; the deployment `api_key` is appended before the per-style tileset. */
const val AZURE_TILE_BASE: String =
    "https://atlas.microsoft.com/map/tile?api-version=2024-04-01&subscription-key="

/** Google tile endpoint prefix; the per-style `lyrs` + the deployment key complete each URL. */
const val GOOGLE_TILE_BASE: String = "https://mt1.google.com/vt/lyrs="

/** Plain-text attribution for the CARTO dark community base (web `&copy; <a>CARTO</a>`). */
const val ATTRIBUTION_CARTO: String = "© CARTO"

/** Plain-text attribution for OpenStreetMap (web `&copy; <a>OpenStreetMap</a>`). */
const val ATTRIBUTION_OSM: String = "© OpenStreetMap"

/** Plain-text attribution for Esri World Imagery (web `&copy; Esri`). */
const val ATTRIBUTION_ESRI: String = "© Esri"

/** Plain-text attribution for OpenTopoMap (web `&copy; <a>OpenTopoMap</a>`). */
const val ATTRIBUTION_OPENTOPO: String = "© OpenTopoMap"

/** Plain-text attribution for Azure Maps (web `&copy; Azure Maps`). */
const val ATTRIBUTION_AZURE: String = "© Azure Maps"

/** Plain-text attribution for Google Maps (web `&copy; Google Maps`). */
const val ATTRIBUTION_GOOGLE: String = "© Google Maps"

/** The keyless community tile set — the native port of the web `freeTiles`. */
fun freeTiles(): Map<MapStyleId, TileDef> =
    mapOf(
        MapStyleId.Dark to TileDef(FREE_DARK_URL, ATTRIBUTION_CARTO),
        MapStyleId.Streets to TileDef(FREE_STREETS_URL, ATTRIBUTION_OSM),
        MapStyleId.Satellite to TileDef(FREE_SATELLITE_URL, ATTRIBUTION_ESRI),
        MapStyleId.Terrain to TileDef(FREE_TERRAIN_URL, ATTRIBUTION_OPENTOPO),
    )

/** The Azure Maps tile set for [key] — the native port of the web `azureTiles`. */
fun azureTiles(key: String): Map<MapStyleId, TileDef> {
    val base = AZURE_TILE_BASE + key
    return mapOf(
        MapStyleId.Dark to TileDef("$base&tilesetId=microsoft.base.darkgrey&zoom={z}&x={x}&y={y}", ATTRIBUTION_AZURE),
        MapStyleId.Streets to TileDef("$base&tilesetId=microsoft.base.road&zoom={z}&x={x}&y={y}", ATTRIBUTION_AZURE),
        MapStyleId.Satellite to TileDef("$base&tilesetId=microsoft.imagery&zoom={z}&x={x}&y={y}", ATTRIBUTION_AZURE),
        MapStyleId.Terrain to TileDef("$base&tilesetId=microsoft.base.road&zoom={z}&x={x}&y={y}", ATTRIBUTION_AZURE),
    )
}

/** The Google Maps tile set for [key] — the native port of the web `googleTiles`. */
fun googleTiles(key: String): Map<MapStyleId, TileDef> =
    mapOf(
        MapStyleId.Dark to TileDef("${GOOGLE_TILE_BASE}r&x={x}&y={y}&z={z}&key=$key", ATTRIBUTION_GOOGLE),
        MapStyleId.Streets to TileDef("${GOOGLE_TILE_BASE}m&x={x}&y={y}&z={z}&key=$key", ATTRIBUTION_GOOGLE),
        MapStyleId.Satellite to TileDef("${GOOGLE_TILE_BASE}s&x={x}&y={y}&z={z}&key=$key", ATTRIBUTION_GOOGLE),
        MapStyleId.Terrain to TileDef("${GOOGLE_TILE_BASE}p&x={x}&y={y}&z={z}&key=$key", ATTRIBUTION_GOOGLE),
    )

/**
 * Resolves the effective [MapProvider] from [config] — the native mirror of the web provider guard: Azure or
 * Google only when that provider is named AND its `api_key` is non-blank, otherwise the community [MapProvider.Free]
 * fallback. A `null` config (the web `useQuery` not-yet-loaded / failed state) is [MapProvider.Free].
 */
fun resolveProvider(config: MapConfig?): MapProvider =
    when {
        config == null -> MapProvider.Free
        config.provider == PROVIDER_AZURE && config.apiKey.isNotBlank() -> MapProvider.Azure
        config.provider == PROVIDER_GOOGLE && config.apiKey.isNotBlank() -> MapProvider.Google
        else -> MapProvider.Free
    }

/** Selects the tile set for [config]'s resolved provider — the native port of the web `tiles` choice. */
fun resolveTiles(config: MapConfig?): Map<MapStyleId, TileDef> =
    when (resolveProvider(config)) {
        MapProvider.Azure -> azureTiles(config?.apiKey.orEmpty())
        MapProvider.Google -> googleTiles(config?.apiKey.orEmpty())
        MapProvider.Free -> freeTiles()
    }

/**
 * The tile source for [style] under [config] — the native port of the web `tiles[style] || tiles.dark`: the
 * style's entry, falling back to the dark entry when a style is somehow absent.
 */
fun resolveTileDef(
    config: MapConfig?,
    style: MapStyleId,
): TileDef {
    val tiles = resolveTiles(config)
    return tiles[style] ?: tiles.getValue(MapStyleId.Dark)
}

/** The leaflet subdomain rotation a `{s}` template cycles through (web default `'abc'`). */
val DEFAULT_TILE_SUBDOMAINS: List<String> = listOf("a", "b", "c")

/** One 256 px raster tile edge — the Web Mercator tile size every listed provider serves. */
const val TILE_SIZE_PX: Int = 256

/**
 * The deterministic subdomain a `{s}` template resolves to for tile ([x], [y]) — the native port of leaflet's
 * `subdomains[abs(x + y) % subdomains.length]`. A blank [subdomains] yields "" so the `{s}` token collapses.
 */
fun subdomainFor(
    x: Int,
    y: Int,
    subdomains: List<String> = DEFAULT_TILE_SUBDOMAINS,
): String = if (subdomains.isEmpty()) "" else subdomains[abs(x + y) % subdomains.size]

/**
 * Resolves a leaflet [template] to a concrete tile URL for ([x], [y], [zoom]) — the native port of leaflet's
 * `L.Util.template` substitution. `{s}` rotates through [subdomains]; `{z}`/`{x}`/`{y}` are the tile
 * coordinates; `{r}` (the retina suffix) collapses to "" (the web default, no `detectRetina`). Templates that
 * omit a token (Azure / Google use explicit `&x=` query params; Esri omits `{s}`) pass through their present
 * tokens unchanged.
 */
fun tileUrl(
    template: String,
    x: Int,
    y: Int,
    zoom: Int,
    subdomains: List<String> = DEFAULT_TILE_SUBDOMAINS,
): String =
    template
        .replace("{s}", subdomainFor(x, y, subdomains))
        .replace("{z}", zoom.toString())
        .replace("{x}", x.toString())
        .replace("{y}", y.toString())
        .replace("{r}", "")

/**
 * The fully reduced, render-ready projection — everything the composable draws for a resolved config + style:
 * the [provider], the chosen [style], the [tile] source (template [TileDef.url] + display [TileDef.attribution]),
 * and [isDefaultProvider] (the community fallback — surfaced as its own attribution rather than a hidden state).
 * Pure data so every branch is covered off-device.
 */
data class MapTileLayerProjection(
    val provider: MapProvider,
    val style: MapStyleId,
    val tile: TileDef,
    val isDefaultProvider: Boolean,
) {
    /** The display attribution for the active tile source (web `attribution`, reduced to plain text). */
    val attribution: String get() = tile.attribution

    /** Whether the live map applies a native base type for this provider (Google) vs a community raster set. */
    val usesNativeBaseMap: Boolean get() = provider == MapProvider.Google
}

/**
 * Reduces [config] + [style] into the render-ready [MapTileLayerProjection] — a faithful port of the web
 * `MapTileLayer` body (resolve provider, pick the style's tile def, default to dark). A `null` [config]
 * (loading / failed query) resolves to the community provider, exactly like the web `mapConfig?.…` default.
 */
fun projectMapTileLayer(
    config: MapConfig?,
    style: MapStyleId,
): MapTileLayerProjection {
    val provider = resolveProvider(config)
    return MapTileLayerProjection(
        provider = provider,
        style = style,
        tile = resolveTileDef(config, style),
        isDefaultProvider = provider == MapProvider.Free,
    )
}

/**
 * Classifies a `/system/map-config` failure into the recovery-oriented [QueryErrorKind] the error surface
 * renders — the same fold the sibling vehicle surfaces use: an offline/timeout failure is treated as
 * not-online; a circuit-open failure is the transient "waiting" state; otherwise the HTTP status selects copy.
 */
fun mapTileLayerErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** Structured-log field key carrying the surface slug on every diagnostic. */
const val SURFACE_KEY: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [MapTileLayerRegistration.SLUG]
 * (P1/S11) — never a deployment api_key or tile URL, so a diagnostics line can never leak a map credential.
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per open.
 */
fun recordMapTileLayerOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(SURFACE_KEY to MapTileLayerRegistration.SLUG))
}
