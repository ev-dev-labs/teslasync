package io.teslasync.android.sharedsurfaces.maptilelayer

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.maps.MapStyleId
import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device coverage of the pure MapTileLayer model — the native port of every decision the web
 * `MapTileLayer` component makes before it hands a tile source to the map framework
 * (web/src/components/maps/MapTileLayer.tsx). Asserts the provider resolution guard, the per-provider tile
 * sets + their plain-text attributions, the leaflet `{s}{z}{x}{y}{r}` URL substitution (including the Esri
 * `{z}/{y}/{x}` axis order and the Azure / Google query-param forms), the render projection, the error-kind
 * fold, and the PII-safe `view.opened` diagnostic — the parity-critical core, exercised in `testReleaseUnitTest`.
 */
class MapTileLayerModelTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    // ── Provider resolution (web `mapConfig?.provider === 'azure' && api_key`) ──────────────────────────────

    @Test
    fun nullConfigResolvesToTheCommunityProvider() {
        assertEquals(MapProvider.Free, resolveProvider(null))
    }

    @Test
    fun freeConfigResolvesToTheCommunityProvider() {
        assertEquals(MapProvider.Free, resolveProvider(MapConfig.FREE))
    }

    @Test
    fun azureWithAKeyResolvesToAzure() {
        assertEquals(MapProvider.Azure, resolveProvider(MapConfig(provider = PROVIDER_AZURE, apiKey = "k")))
    }

    @Test
    fun googleWithAKeyResolvesToGoogle() {
        assertEquals(MapProvider.Google, resolveProvider(MapConfig(provider = PROVIDER_GOOGLE, apiKey = "k")))
    }

    @Test
    fun namedProviderWithoutAKeyFallsBackToCommunity() {
        assertEquals(MapProvider.Free, resolveProvider(MapConfig(provider = PROVIDER_AZURE, apiKey = "")))
        assertEquals(MapProvider.Free, resolveProvider(MapConfig(provider = PROVIDER_GOOGLE, apiKey = "  ")))
    }

    @Test
    fun unknownProviderFallsBackToCommunity() {
        assertEquals(MapProvider.Free, resolveProvider(MapConfig(provider = "mapbox", apiKey = "k")))
    }

    // ── Tile sets + attributions (1:1 with the web `freeTiles` / `azureTiles` / `googleTiles`) ──────────────

    @Test
    fun communityTileSetMatchesTheWebSourceTemplatesAndAttributions() {
        val free = freeTiles()
        assertEquals(FREE_DARK_URL, free.getValue(MapStyleId.Dark).url)
        assertEquals(ATTRIBUTION_CARTO, free.getValue(MapStyleId.Dark).attribution)
        assertEquals(FREE_STREETS_URL, free.getValue(MapStyleId.Streets).url)
        assertEquals(ATTRIBUTION_OSM, free.getValue(MapStyleId.Streets).attribution)
        assertEquals(FREE_SATELLITE_URL, free.getValue(MapStyleId.Satellite).url)
        assertEquals(ATTRIBUTION_ESRI, free.getValue(MapStyleId.Satellite).attribution)
        assertEquals(FREE_TERRAIN_URL, free.getValue(MapStyleId.Terrain).url)
        assertEquals(ATTRIBUTION_OPENTOPO, free.getValue(MapStyleId.Terrain).attribution)
    }

    @Test
    fun azureTileSetEmbedsTheKeyAndPerStyleTilesets() {
        val azure = azureTiles("SECRET")
        assertTrue(azure.getValue(MapStyleId.Dark).url.contains("subscription-key=SECRET"))
        assertTrue(azure.getValue(MapStyleId.Dark).url.contains("tilesetId=microsoft.base.darkgrey"))
        assertTrue(azure.getValue(MapStyleId.Streets).url.contains("tilesetId=microsoft.base.road"))
        assertTrue(azure.getValue(MapStyleId.Satellite).url.contains("tilesetId=microsoft.imagery"))
        assertEquals(ATTRIBUTION_AZURE, azure.getValue(MapStyleId.Terrain).attribution)
    }

    @Test
    fun googleTileSetEmbedsTheKeyAndPerStyleLayers() {
        val google = googleTiles("SECRET")
        assertTrue(google.getValue(MapStyleId.Dark).url.contains("lyrs=r"))
        assertTrue(google.getValue(MapStyleId.Streets).url.contains("lyrs=m"))
        assertTrue(google.getValue(MapStyleId.Satellite).url.contains("lyrs=s"))
        assertTrue(google.getValue(MapStyleId.Terrain).url.contains("lyrs=p"))
        assertTrue(google.getValue(MapStyleId.Dark).url.contains("key=SECRET"))
        assertEquals(ATTRIBUTION_GOOGLE, google.getValue(MapStyleId.Dark).attribution)
    }

    @Test
    fun resolveTileDefSelectsTheStyleForTheResolvedProvider() {
        val azure = resolveTileDef(MapConfig(provider = PROVIDER_AZURE, apiKey = "k"), MapStyleId.Streets)
        assertTrue(azure.url.contains("tilesetId=microsoft.base.road"))
        val community = resolveTileDef(null, MapStyleId.Satellite)
        assertEquals(ATTRIBUTION_ESRI, community.attribution)
    }

    // ── URL substitution (leaflet `L.Util.template`) ───────────────────────────────────────────────────────

    @Test
    fun subdomainRotationIsDeterministicAndWraps() {
        assertEquals("a", subdomainFor(1, 2))
        assertEquals("b", subdomainFor(2, 2))
        assertEquals("c", subdomainFor(1, 1))
        assertEquals("", subdomainFor(0, 0, emptyList()))
    }

    @Test
    fun tileUrlSubstitutesEveryLeafletPlaceholder() {
        val url = tileUrl(FREE_DARK_URL, x = 1, y = 2, zoom = 3)
        assertEquals("https://a.basemaps.cartocdn.com/dark_all/3/1/2.png", url)
        assertFalse(url.contains("{"))
    }

    @Test
    fun tileUrlPreservesTheEsriAxisOrder() {
        val url = tileUrl(FREE_SATELLITE_URL, x = 1, y = 2, zoom = 3)
        assertTrue(url.endsWith("/tile/3/2/1"))
    }

    @Test
    fun tileUrlSubstitutesAzureAndGoogleQueryParams() {
        val azure = tileUrl(azureTiles("k").getValue(MapStyleId.Dark).url, x = 7, y = 8, zoom = 9)
        assertTrue(azure.contains("zoom=9"))
        assertTrue(azure.contains("x=7"))
        assertTrue(azure.contains("y=8"))
        val google = tileUrl(googleTiles("k").getValue(MapStyleId.Dark).url, x = 7, y = 8, zoom = 9)
        assertTrue(google.contains("x=7&y=8&z=9"))
    }

    // ── Projection ─────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun nullConfigProjectsToTheCommunityDarkDefault() {
        val projection = projectMapTileLayer(null, MapStyleId.Dark)
        assertEquals(MapProvider.Free, projection.provider)
        assertTrue(projection.isDefaultProvider)
        assertFalse(projection.usesNativeBaseMap)
        assertEquals(ATTRIBUTION_CARTO, projection.attribution)
        assertEquals(FREE_DARK_URL, projection.tile.url)
    }

    @Test
    fun customProviderProjectionCarriesTheStyleAndIsNotDefault() {
        val azure = projectMapTileLayer(MapConfig(provider = PROVIDER_AZURE, apiKey = "k"), MapStyleId.Satellite)
        assertEquals(MapProvider.Azure, azure.provider)
        assertEquals(MapStyleId.Satellite, azure.style)
        assertFalse(azure.isDefaultProvider)
        assertEquals(ATTRIBUTION_AZURE, azure.attribution)
        val google = projectMapTileLayer(MapConfig(provider = PROVIDER_GOOGLE, apiKey = "k"), MapStyleId.Terrain)
        assertTrue(google.usesNativeBaseMap)
    }

    @Test
    fun mapConfigDefaultsToTheCommunityProvider() {
        val empty = MapConfig()
        assertEquals(PROVIDER_FREE, empty.provider)
        assertEquals("", empty.apiKey)
    }

    // ── Error classification ───────────────────────────────────────────────────────────────────────────────

    @Test
    fun errorKindFoldsConnectivityAndStatus() {
        assertEquals(QueryErrorKind.Offline, mapTileLayerErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.ServerError, mapTileLayerErrorKind(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.NotFound, mapTileLayerErrorKind(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.Waiting, mapTileLayerErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, mapTileLayerErrorKind(null, null))
    }

    // ── Diagnostics + keys ─────────────────────────────────────────────────────────────────────────────────

    @Test
    fun viewOpenedDiagnosticCarriesOnlyTheSlug() {
        val logger = RecordingLogger()
        recordMapTileLayerOpened(logger)
        assertEquals(1, logger.events.size)
        assertEquals(EVENT_VIEW_OPENED, logger.events.single().first)
        assertEquals(mapOf(SURFACE_KEY to MapTileLayerRegistration.SLUG), logger.events.single().second)
    }

    @Test
    fun registrationAndKeysAreStable() {
        assertEquals("MapTileLayer", MapTileLayerRegistration.SLUG)
        assertEquals("translation_common_loading", MapTileLayerKeys.LOADING)
        assertEquals("translation_common_offline", MapTileLayerKeys.OFFLINE)
        assertEquals("translation_mqtt_stale", MapTileLayerKeys.STALE)
        assertEquals("translation_common_fullscreen_enter", MapTileLayerKeys.FULLSCREEN_ENTER)
    }
}
