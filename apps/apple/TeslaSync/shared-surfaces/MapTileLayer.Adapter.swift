//
//  MapTileLayer.Adapter.swift
//  TeslaSync — P4 shared surface · 0185 · MapTileLayer (Apple)
//
//  The testable, dependency-light tile-source core for the map base-layer surface — the SwiftUI
//  parity of `components/maps/MapTileLayer.tsx`. Everything here is Foundation-only: the map style
//  union (the verbatim port of the web `MapStyle`), the provider union (web `MapConfig.provider`),
//  the backend wire row (the native port of `MapConfig`), the tile definition (web `TileDef`), the
//  three provider matrices (the verbatim ports of `freeTiles` / `azureTiles` / `googleTiles`), and
//  the `resolve` adapter (the verbatim port of the web provider-selection + `tiles[style] ||
//  tiles.dark` fallback). No store, no SwiftUI, no rendered view, so each piece is unit tested in
//  isolation.
//
//  Every type is prefixed `MapTileLayer…` so the surface stays self-contained and does not collide
//  with another shared surface's internal types in the single app module.
//

import Foundation

// MARK: - Map style (web `MapStyle`)

/// The selectable base-map style — the verbatim port of the web `MapStyle` union
/// (`'dark' | 'satellite' | 'streets' | 'terrain'`). The raw value matches the web string so a
/// host can pass the same identifier the web `style` prop uses.
public enum MapTileLayerStyle: String, Sendable, Equatable, CaseIterable, Identifiable {
    case dark
    case satellite
    case streets
    case terrain

    public var id: String {
        rawValue
    }

    /// The i18n key for the human-facing style label (native chrome — the web tile layer is
    /// anonymous, so these labels are introduced by the native style picker).
    public var labelKey: String {
        "mapTileLayer.style.\(rawValue)"
    }

    /// The English fallback for ``labelKey``.
    public var labelFallback: String {
        switch self {
        case .dark: "Dark"
        case .satellite: "Satellite"
        case .streets: "Streets"
        case .terrain: "Terrain"
        }
    }

    /// SF Symbol that represents this style in the picker.
    public var systemImage: String {
        switch self {
        case .dark: "moon.stars"
        case .satellite: "globe.americas"
        case .streets: "map"
        case .terrain: "mountain.2"
        }
    }

    /// Parses a host-supplied style string, falling back to `.dark` for an unknown value — the
    /// native mirror of the web `tiles[style] || tiles.dark` default.
    public static func parse(_ raw: String?) -> MapTileLayerStyle {
        guard let raw, let style = MapTileLayerStyle(rawValue: raw) else { return .dark }
        return style
    }
}

// MARK: - Tile provider (web `MapConfig.provider`)

/// The tile provider — the verbatim port of the web `MapConfig.provider` union
/// (`'free' | 'azure' | 'google'`). `free` is the default + fallback (CARTO / OSM / Esri /
/// OpenTopoMap), exactly as the web component treats an absent or keyless config.
public enum MapTileLayerProvider: String, Sendable, Equatable, CaseIterable {
    case free
    case azure
    case google

    /// Parses a backend provider string, defaulting to `.free` for an unknown value so a new
    /// server-side provider never blanks the map (web falls back to `freeTiles`).
    public static func parse(_ raw: String?) -> MapTileLayerProvider {
        guard let raw, let provider = MapTileLayerProvider(rawValue: raw) else { return .free }
        return provider
    }

    /// The attribution / brand label key for this provider (native chrome).
    public var labelKey: String {
        "mapTileLayer.provider.\(rawValue)"
    }

    /// The English fallback for ``labelKey``.
    public var labelFallback: String {
        switch self {
        case .free: "Open data"
        case .azure: "Azure Maps"
        case .google: "Google Maps"
        }
    }
}

// MARK: - Map config wire row (web `MapConfig`)

/// The backend wire shape from `GET /system/map-config` — the native port of the web `MapConfig`
/// (`{ provider, api_key }`, snake_case JSON). Decoded by the source seam and projected to the
/// resolved tile definition by ``MapTileLayerAdapter`` (no SwiftUI in the path).
public struct MapTileLayerConfigRow: Sendable, Equatable, Codable {
    public let provider: String
    public let apiKey: String

    enum CodingKeys: String, CodingKey {
        case provider
        case apiKey = "api_key"
    }

    public init(provider: String, apiKey: String) {
        self.provider = provider
        self.apiKey = apiKey
    }
}

// MARK: - Tile definition (web `TileDef`)

/// One resolved tile source — the native port of the web `TileDef` (`{ url, attribution }`). `url`
/// is the XYZ URL template (with `{s}` / `{z}` / `{x}` / `{y}` / `{r}` tokens, exactly as the
/// web passes to leaflet's `<TileLayer url>`); `attribution` is the provider's required credit
/// string (carried verbatim from the web — brand names are not localised).
public struct MapTileLayerTileDef: Sendable, Equatable {
    public let url: String
    public let attribution: String

    public init(url: String, attribution: String) {
        self.url = url
        self.attribution = attribution
    }
}

// MARK: - Provider matrices (web `freeTiles` / `azureTiles` / `googleTiles`)

/// The three provider tile matrices — the verbatim ports of the web `freeTiles` constant and the
/// `azureTiles(key)` / `googleTiles(key)` factories. Kept as pure builders so the URL templates
/// stay in lock-step with `components/maps/MapTileLayer.tsx`.
public enum MapTileLayerTiles {
    /// Web `freeTiles` — CARTO dark, OpenStreetMap streets, Esri World Imagery satellite,
    /// OpenTopoMap terrain. Brand attributions are carried verbatim (provider-terms requirement).
    public static func free(_ style: MapTileLayerStyle) -> MapTileLayerTileDef {
        switch style {
        case .dark:
            MapTileLayerTileDef(
                url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
                attribution: "&copy; <a href=\"https://carto.com/\">CARTO</a>"
            )
        case .streets:
            MapTileLayerTileDef(
                url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>"
            )
        case .satellite:
            MapTileLayerTileDef(
                url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                attribution: "&copy; Esri"
            )
        case .terrain:
            MapTileLayerTileDef(
                url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
                attribution: "&copy; <a href=\"https://opentopomap.org\">OpenTopoMap</a>"
            )
        }
    }

    /// Web `azureTiles(key)` — `microsoft.base.darkgrey` / `microsoft.base.road` /
    /// `microsoft.imagery`, parameterised by the subscription key.
    public static func azure(key: String, style: MapTileLayerStyle) -> MapTileLayerTileDef {
        let base = "https://atlas.microsoft.com/map/tile?api-version=2024-04-01&subscription-key=" + key
        let tileset = switch style {
        case .dark: "microsoft.base.darkgrey"
        case .streets: "microsoft.base.road"
        case .satellite: "microsoft.imagery"
        case .terrain: "microsoft.base.road"
        }
        return MapTileLayerTileDef(
            url: "\(base)&tilesetId=\(tileset)&zoom={z}&x={x}&y={y}",
            attribution: "&copy; Azure Maps"
        )
    }

    /// Web `googleTiles(key)` — `lyrs=r` (dark) / `lyrs=m` (streets) / `lyrs=s` (satellite) /
    /// `lyrs=p` (terrain), parameterised by the API key.
    public static func google(key: String, style: MapTileLayerStyle) -> MapTileLayerTileDef {
        let layer = switch style {
        case .dark: "r"
        case .streets: "m"
        case .satellite: "s"
        case .terrain: "p"
        }
        return MapTileLayerTileDef(
            url: "https://mt1.google.com/vt/lyrs=\(layer)&x={x}&y={y}&z={z}&key=\(key)",
            attribution: "&copy; Google Maps"
        )
    }
}

// MARK: - Adapter (web provider selection + `tiles[style] || tiles.dark`)

/// Resolves the active tile definition + effective provider from the map config + the requested
/// style — the verbatim port of the web component's selection block:
///
/// ```ts
/// let tiles = freeTiles
/// if (mapConfig?.provider === 'azure' && mapConfig.api_key) tiles = azureTiles(mapConfig.api_key)
/// else if (mapConfig?.provider === 'google' && mapConfig.api_key) tiles = googleTiles(mapConfig.api_key)
/// const t = tiles[style] || tiles.dark
/// ```
///
/// Pure + total: a nil config, an unknown provider, or a keyed provider with an empty key all
/// degrade to the free matrix (web `?? freeTiles`); the style always resolves (the enum is total).
public enum MapTileLayerAdapter {
    /// The provider that is actually used after the web key-presence guard — azure/google only when
    /// the config names them *and* supplies a non-empty key, else free.
    public static func effectiveProvider(_ config: MapTileLayerConfigRow?) -> MapTileLayerProvider {
        guard let config else { return .free }
        let provider = MapTileLayerProvider.parse(config.provider)
        let hasKey = !config.apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        switch provider {
        case .azure where hasKey: return .azure
        case .google where hasKey: return .google
        default: return .free
        }
    }

    /// Resolves the tile definition for a config + style (web `t = tiles[style] || tiles.dark`).
    public static func resolve(config: MapTileLayerConfigRow?, style: MapTileLayerStyle) -> MapTileLayerTileDef {
        switch effectiveProvider(config) {
        case .azure:
            MapTileLayerTiles.azure(key: config?.apiKey ?? "", style: style)
        case .google:
            MapTileLayerTiles.google(key: config?.apiKey ?? "", style: style)
        case .free:
            MapTileLayerTiles.free(style)
        }
    }
}

// MARK: - Surface metadata (P1/S11 diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum MapTileLayerMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MapTileLayer"
}
