//
//  MapTileLayer.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0185 · MapTileLayer (Apple)
//
//  Pure-core coverage for the MapTileLayer surface — the style/provider parsers, the tile matrices
//  (verbatim ports of `freeTiles` / `azureTiles` / `googleTiles`), the provider-selection adapter
//  (web `provider === … && api_key`), the attribution HTML → plain-text projection, the XYZ
//  template fill (`{s}` / `{z}` / `{x}` / `{y}` / `{r}`), and the load-status / resolve projection.
//  Everything here is Foundation-only and reads the pure types directly (no store, no rendered
//  view), so each web branch is asserted in isolation. Runs in the TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Style + provider parsing

final class MapTileLayerEnumTests: XCTestCase {
    func testStyleParseKnownAndUnknown() {
        XCTAssertEqual(MapTileLayerStyle.parse("satellite"), .satellite)
        XCTAssertEqual(MapTileLayerStyle.parse("terrain"), .terrain)
        XCTAssertEqual(MapTileLayerStyle.parse("unknown"), .dark) // web `tiles[style] || tiles.dark`
        XCTAssertEqual(MapTileLayerStyle.parse(nil), .dark)
    }

    func testProviderParseKnownAndUnknown() {
        XCTAssertEqual(MapTileLayerProvider.parse("azure"), .azure)
        XCTAssertEqual(MapTileLayerProvider.parse("google"), .google)
        XCTAssertEqual(MapTileLayerProvider.parse("free"), .free)
        XCTAssertEqual(MapTileLayerProvider.parse("nope"), .free) // web `?? freeTiles`
        XCTAssertEqual(MapTileLayerProvider.parse(nil), .free)
    }

    func testCornerParseDefaultsToTopRight() {
        XCTAssertEqual(MapTileLayerCorner.parse("bottomleft"), .bottomleft)
        XCTAssertEqual(MapTileLayerCorner.parse("nope"), .topright) // web `position = 'topright'`
        XCTAssertEqual(MapTileLayerCorner.parse(nil), .topright)
    }
}

// MARK: - Config decoding (web `MapConfig` snake_case)

final class MapTileLayerConfigDecodeTests: XCTestCase {
    func testDecodesSnakeCaseApiKey() throws {
        let json = Data(#"{"provider":"google","api_key":"abc123"}"#.utf8)
        let row = try JSONDecoder().decode(MapTileLayerConfigRow.self, from: json)
        XCTAssertEqual(row.provider, "google")
        XCTAssertEqual(row.apiKey, "abc123")
    }
}

// MARK: - Tile matrices (web `freeTiles` / `azureTiles` / `googleTiles`)

final class MapTileLayerTilesTests: XCTestCase {
    func testFreeMatrixTemplatesMatchWeb() {
        XCTAssertEqual(
            MapTileLayerTiles.free(.dark).url,
            "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        )
        XCTAssertEqual(
            MapTileLayerTiles.free(.streets).url,
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        )
        XCTAssertEqual(
            MapTileLayerTiles.free(.satellite).url,
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        )
        XCTAssertEqual(
            MapTileLayerTiles.free(.terrain).url,
            "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
        )
    }

    func testAzureMatrixCarriesKeyAndTileset() {
        let dark = MapTileLayerTiles.azure(key: "K", style: .dark)
        XCTAssertTrue(dark.url.contains("subscription-key=K"))
        XCTAssertTrue(dark.url.contains("tilesetId=microsoft.base.darkgrey"))
        XCTAssertTrue(MapTileLayerTiles.azure(key: "K", style: .satellite).url.contains("microsoft.imagery"))
        XCTAssertTrue(MapTileLayerTiles.azure(key: "K", style: .terrain).url.contains("microsoft.base.road"))
        XCTAssertEqual(dark.attribution, "&copy; Azure Maps")
    }

    func testGoogleMatrixUsesLayerCodesAndKey() {
        XCTAssertTrue(MapTileLayerTiles.google(key: "K", style: .dark).url.contains("lyrs=r"))
        XCTAssertTrue(MapTileLayerTiles.google(key: "K", style: .streets).url.contains("lyrs=m"))
        XCTAssertTrue(MapTileLayerTiles.google(key: "K", style: .satellite).url.contains("lyrs=s"))
        XCTAssertTrue(MapTileLayerTiles.google(key: "K", style: .terrain).url.contains("lyrs=p"))
        XCTAssertTrue(MapTileLayerTiles.google(key: "K", style: .dark).url.contains("key=K"))
    }
}

// MARK: - Adapter (web provider selection)

final class MapTileLayerAdapterTests: XCTestCase {
    func testEffectiveProviderHonoursKeyPresence() {
        XCTAssertEqual(MapTileLayerAdapter.effectiveProvider(nil), .free)
        XCTAssertEqual(
            MapTileLayerAdapter.effectiveProvider(MapTileLayerConfigRow(provider: "azure", apiKey: "K")),
            .azure
        )
        XCTAssertEqual(
            MapTileLayerAdapter.effectiveProvider(MapTileLayerConfigRow(provider: "google", apiKey: "K")),
            .google
        )
        // Keyed provider with an empty key falls back to free (web `&& mapConfig.api_key`).
        XCTAssertEqual(
            MapTileLayerAdapter.effectiveProvider(MapTileLayerConfigRow(provider: "azure", apiKey: "")),
            .free
        )
        XCTAssertEqual(
            MapTileLayerAdapter.effectiveProvider(MapTileLayerConfigRow(provider: "google", apiKey: "   ")),
            .free
        )
        // free provider is always free, key or not.
        XCTAssertEqual(
            MapTileLayerAdapter.effectiveProvider(MapTileLayerConfigRow(provider: "free", apiKey: "K")),
            .free
        )
    }

    func testResolveSelectsMatrixAndStyle() {
        let free = MapTileLayerAdapter.resolve(config: nil, style: .dark)
        XCTAssertEqual(free.url, MapTileLayerTiles.free(.dark).url)

        let azure = MapTileLayerAdapter.resolve(
            config: MapTileLayerConfigRow(provider: "azure", apiKey: "K"),
            style: .satellite
        )
        XCTAssertTrue(azure.url.contains("microsoft.imagery"))

        let google = MapTileLayerAdapter.resolve(
            config: MapTileLayerConfigRow(provider: "google", apiKey: "K"),
            style: .streets
        )
        XCTAssertTrue(google.url.contains("lyrs=m"))

        // Keyless azure → free fallback for the requested style.
        let fallback = MapTileLayerAdapter.resolve(
            config: MapTileLayerConfigRow(provider: "azure", apiKey: ""),
            style: .terrain
        )
        XCTAssertEqual(fallback.url, MapTileLayerTiles.free(.terrain).url)
    }
}

// MARK: - Logic (attribution / template / subdomain)

final class MapTileLayerLogicTests: XCTestCase {
    func testPlainAttributionStripsMarkupAndEntities() {
        XCTAssertEqual(
            MapTileLayerLogic.plainAttribution("&copy; <a href=\"https://carto.com/\">CARTO</a>"),
            "© CARTO"
        )
        XCTAssertEqual(MapTileLayerLogic.plainAttribution("&copy; Esri"), "© Esri")
        XCTAssertEqual(
            MapTileLayerLogic.plainAttribution(
                "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>"
            ),
            "© OpenStreetMap"
        )
        XCTAssertEqual(MapTileLayerLogic.plainAttribution("Tiles &amp; data"), "Tiles & data")
    }

    func testHasTileTemplate() {
        XCTAssertTrue(MapTileLayerLogic.hasTileTemplate("https://x/{z}/{x}/{y}.png"))
        XCTAssertFalse(MapTileLayerLogic.hasTileTemplate("https://x/static.png"))
        XCTAssertFalse(MapTileLayerLogic.hasTileTemplate(""))
    }

    func testSubdomainRotationAndEmpty() {
        XCTAssertEqual(MapTileLayerLogic.subdomain(x: 0, y: 0, subdomains: ["a", "b", "c"]), "a")
        XCTAssertEqual(MapTileLayerLogic.subdomain(x: 1, y: 0, subdomains: ["a", "b", "c"]), "b")
        XCTAssertEqual(MapTileLayerLogic.subdomain(x: 2, y: 0, subdomains: ["a", "b", "c"]), "c")
        XCTAssertEqual(MapTileLayerLogic.subdomain(x: 3, y: 0, subdomains: ["a", "b", "c"]), "a")
        XCTAssertEqual(MapTileLayerLogic.subdomain(x: 0, y: 0, subdomains: []), "")
    }

    func testFillTemplateSubstitutesEveryToken() {
        let carto = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        XCTAssertEqual(
            MapTileLayerLogic.fillTemplate(carto, x: 1, y: 2, zoom: 3, subdomains: ["a", "b", "c"], retina: true),
            "https://a.basemaps.cartocdn.com/dark_all/3/1/2@2x.png"
        )
        XCTAssertEqual(
            MapTileLayerLogic.fillTemplate(carto, x: 1, y: 2, zoom: 3, subdomains: ["a", "b", "c"], retina: false),
            "https://a.basemaps.cartocdn.com/dark_all/3/1/2.png"
        )
    }

    func testFillTemplatePreservesEsriAxisOrder() {
        let esri = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        XCTAssertEqual(
            MapTileLayerLogic.fillTemplate(esri, x: 4, y: 5, zoom: 6),
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/6/5/4"
        )
    }
}

// MARK: - Projection (load status + resolve)

final class MapTileLayerProjectionTests: XCTestCase {
    private let validTile = MapTileLayerTileDef(url: "https://x/{z}/{x}/{y}.png", attribution: "&copy; X")
    private let emptyTile = MapTileLayerTileDef(url: "https://x/static.png", attribution: "")

    func testLoadStatusPrecedence() {
        XCTAssertEqual(
            MapTileLayerProjection.loadStatus(phase: .failed, hasConfig: true, tileDef: validTile),
            .error
        )
        XCTAssertEqual(
            MapTileLayerProjection.loadStatus(phase: .loading, hasConfig: false, tileDef: validTile),
            .loading
        )
        // Loading but a cached config is present → render the cached tiles (web keeps `freeTiles`).
        XCTAssertEqual(
            MapTileLayerProjection.loadStatus(phase: .loading, hasConfig: true, tileDef: validTile),
            .ready
        )
        XCTAssertEqual(
            MapTileLayerProjection.loadStatus(phase: .loaded, hasConfig: true, tileDef: emptyTile),
            .empty
        )
        XCTAssertEqual(
            MapTileLayerProjection.loadStatus(phase: .loaded, hasConfig: true, tileDef: validTile),
            .ready
        )
    }

    func testResolveWiresStyleProviderAttribution() {
        let resolved = MapTileLayerProjection.resolve(
            style: .satellite,
            config: MapTileLayerConfigRow(provider: "google", apiKey: "K"),
            phase: .loaded,
            connection: .stale
        )
        XCTAssertEqual(resolved.style, .satellite)
        XCTAssertEqual(resolved.provider, .google)
        XCTAssertEqual(resolved.connection, .stale)
        XCTAssertFalse(resolved.isLive)
        XCTAssertTrue(resolved.canTile)
        XCTAssertEqual(resolved.attribution, "© Google Maps") // HTML entity decoded for display
        XCTAssertTrue(resolved.tileDef.url.contains("lyrs=s"))
    }

    func testResolveFreeFallbackIsLiveAndReady() {
        let resolved = MapTileLayerProjection.resolve(
            style: .dark,
            config: nil,
            phase: .loaded,
            connection: .live
        )
        XCTAssertEqual(resolved.provider, .free)
        XCTAssertEqual(resolved.status, .ready)
        XCTAssertTrue(resolved.isLive)
        XCTAssertEqual(resolved.attribution, "© CARTO")
    }
}
