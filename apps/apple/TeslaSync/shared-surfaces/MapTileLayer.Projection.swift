//
//  MapTileLayer.Projection.swift
//  TeslaSync — P4 shared surface · 0185 · MapTileLayer (Apple)
//
//  The pure projection from the surface inputs to the resolved view-state — the native port of the
//  web `MapTileLayer` render decisions (the provider/style → `TileDef` selection) widened with the
//  P4 leaf connectivity axis and the explicit load states the prompt requires every surface to
//  render. The view is a pure function of `MapTileLayerResolved`; every branch is unit tested
//  without rendering. Foundation-only.
//

import Foundation

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound map config — the orthogonal connectivity axis the surface renders as
/// a chip + banner. `live` shows the map alone; `stale` adds a refresh affordance and triggers a
/// one-shot auto-refresh; `offline` keeps the last-known tiles with an offline marker.
public enum MapTileLayerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Config load phase (web `useQuery` status)

/// The map-config query phase — the native mirror of the web `useQuery(['map-config'])` status. The
/// web component renders `freeTiles` while this is `loading` or `failed` (the query result is
/// `undefined`), then swaps to the keyed provider once `loaded`.
public enum MapTileLayerLoadPhase: String, Sendable, Equatable, CaseIterable {
    case loading
    case loaded
    case failed
}

// MARK: - Resolved body status (loading / empty / error / ready)

/// The resolved body status the surface chrome renders — folds the config load phase with the tile
/// validity. Precedence: a failed query is `.error`; an in-flight query with no cached config is
/// `.loading`; a resolved config whose tile template cannot tile is `.empty` (defensive — the free
/// fallback always tiles); otherwise `.ready`.
public enum MapTileLayerLoadStatus: String, Sendable, Equatable, CaseIterable {
    case loading
    case empty
    case error
    case ready
}

// MARK: - Surface content (web props)

/// The per-instance configuration the surface is parameterised by — the native shape of the web
/// `MapTileLayerProps` (`style`) plus the `MapFullscreenControl` props (`position`,
/// `ariaLabelEnter`, `ariaLabelExit`) that the web mounts as a sibling control. The host passes the
/// style it wants; the fullscreen control mirrors the web defaults.
public struct MapTileLayerContent: Sendable, Equatable {
    public var style: MapTileLayerStyle
    public var corner: MapTileLayerCorner
    public var fullscreenEnabled: Bool
    public var ariaLabelEnterKey: String?
    public var ariaLabelExitKey: String?

    public init(
        style: MapTileLayerStyle = .dark,
        corner: MapTileLayerCorner = .topright,
        fullscreenEnabled: Bool = true,
        ariaLabelEnterKey: String? = nil,
        ariaLabelExitKey: String? = nil
    ) {
        self.style = style
        self.corner = corner
        self.fullscreenEnabled = fullscreenEnabled
        self.ariaLabelEnterKey = ariaLabelEnterKey
        self.ariaLabelExitKey = ariaLabelExitKey
    }
}

// MARK: - Resolved view-state

/// The resolved, view-ready state — the body status, the connectivity axis, the active style +
/// effective provider, the resolved tile definition (always present, free-fallback), and the plain
/// attribution text. Computed once by ``MapTileLayerProjection`` so the view holds no decision
/// logic.
public struct MapTileLayerResolved: Equatable, Sendable {
    public let status: MapTileLayerLoadStatus
    public let connection: MapTileLayerConnection
    public let style: MapTileLayerStyle
    public let provider: MapTileLayerProvider
    public let tileDef: MapTileLayerTileDef
    public let attribution: String

    public init(
        status: MapTileLayerLoadStatus,
        connection: MapTileLayerConnection,
        style: MapTileLayerStyle,
        provider: MapTileLayerProvider,
        tileDef: MapTileLayerTileDef,
        attribution: String
    ) {
        self.status = status
        self.connection = connection
        self.style = style
        self.provider = provider
        self.tileDef = tileDef
        self.attribution = attribution
    }

    /// Whether the bound config is live (no freshness chrome needed).
    public var isLive: Bool {
        connection == .live
    }

    /// Whether the base map is renderable (a valid tile source) — false only in the defensive
    /// `.empty` status.
    public var canTile: Bool {
        status != .empty
    }
}

// MARK: - Projection (inputs → resolved)

/// Pure projection from the surface inputs to the resolved view-state. Mirrors the web
/// `MapTileLayer` selection exactly (provider + key → matrix → `tiles[style] || tiles.dark`) and
/// folds in the load phase + connectivity for the chrome the native surface adds.
public enum MapTileLayerProjection {
    /// Resolves the full view-state. `style` is the active base-map style (the web `style` prop,
    /// which the native surface also lets the user switch); `config` is the latest map-config
    /// snapshot (nil before the first load); `phase` is the query status; `connection` is the P4
    /// freshness axis.
    public static func resolve(
        style: MapTileLayerStyle,
        config: MapTileLayerConfigRow?,
        phase: MapTileLayerLoadPhase,
        connection: MapTileLayerConnection
    ) -> MapTileLayerResolved {
        let provider = MapTileLayerAdapter.effectiveProvider(config)
        let tileDef = MapTileLayerAdapter.resolve(config: config, style: style)
        let status = loadStatus(phase: phase, hasConfig: config != nil, tileDef: tileDef)
        return MapTileLayerResolved(
            status: status,
            connection: connection,
            style: style,
            provider: provider,
            tileDef: tileDef,
            attribution: MapTileLayerLogic.plainAttribution(tileDef.attribution)
        )
    }

    /// Folds the query phase + cached-config presence + tile validity into the body status (the
    /// precedence documented on ``MapTileLayerLoadStatus``).
    static func loadStatus(
        phase: MapTileLayerLoadPhase,
        hasConfig: Bool,
        tileDef: MapTileLayerTileDef
    ) -> MapTileLayerLoadStatus {
        if phase == .failed { return .error }
        if phase == .loading, !hasConfig { return .loading }
        if !MapTileLayerLogic.hasTileTemplate(tileDef.url) { return .empty }
        return .ready
    }
}
