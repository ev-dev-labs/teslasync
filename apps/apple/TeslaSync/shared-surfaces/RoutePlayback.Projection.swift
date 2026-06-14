//
//  RoutePlayback.Projection.swift
//  TeslaSync — P4 shared surface · 0187 · RoutePlayback (Apple)
//
//  The pure projection from the surface inputs to the resolved view-state — the native port of the web
//  `RoutePlayback` render decision (the map + trail render when there is a plottable trail, else the
//  empty state) widened with the P4 leaf connectivity axis and the explicit load states the prompt
//  requires every surface to render. The view is a pure function of `RoutePlaybackResolved` +
//  `RoutePlaybackFrame`; every branch is unit tested without rendering. Foundation-only.
//

import Foundation

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound route feed — the orthogonal connectivity axis the surface renders as a
/// chip + banner. `live` shows the trail alone; `stale` adds a refresh affordance and triggers a
/// one-shot auto-refresh; `offline` keeps the last-known trail with an offline marker.
public enum RoutePlaybackConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline

    /// Whether the bound route is live (no freshness chrome needed).
    public var isLive: Bool {
        self == .live
    }
}

// MARK: - Load phase (web query status feeding the points prop)

/// The route-query phase — the native mirror of the host query status feeding the `points` prop
/// (`isLoading` / settled / `isError`). The surface renders a loading state before the first route, an
/// error state on failure, and the map once a plottable trail resolves.
public enum RoutePlaybackLoadPhase: String, Sendable, Equatable, CaseIterable {
    case loading
    case loaded
    case failed
}

// MARK: - Resolved body status (loading / empty / error / ready)

/// The resolved body status the surface chrome renders — folds the route-query phase with the presence
/// of a plottable trail. Precedence: a failed query is `.error`; an in-flight query with no cached
/// trail is `.loading`; a settled query with no plottable trail is `.empty` (web `trail.length === 0`);
/// otherwise `.ready`.
public enum RoutePlaybackLoadStatus: String, Sendable, Equatable, CaseIterable {
    case loading
    case empty
    case error
    case ready
}

// MARK: - Map style (web `MapStyle` tile-layer selection)

/// The tile-layer selection the layer switcher offers — the native mirror of the web `MapStyle` /
/// `MapTileLayer` styles, mapped onto MapKit's native styles at the view boundary (web "dark" tiles are
/// the system-driven `.standard` natively). Kept Foundation-only so the content config stays pure.
public enum RoutePlaybackMapStyle: String, Sendable, Equatable, CaseIterable {
    case standard
    case hybrid
    case imagery
}

// MARK: - Surface content (web props + native chrome config)

/// The per-instance configuration the surface is parameterised by — the native shape of the web
/// `RoutePlaybackProps` defaults: auto-play, the layer-switcher / controls toggles, the map height, the
/// initial tile style, the data-driven trail / marker colours (web `trailColor` / `markerColor`, `nil`
/// → a semantic theme token), and the optional aria-label / empty-message overrides.
public struct RoutePlaybackContent: Sendable, Equatable {
    public var autoPlay: Bool
    public var showsLayerSwitcher: Bool
    public var showsControls: Bool
    public var height: Double
    public var initialMapStyle: RoutePlaybackMapStyle
    public var trailColorHex: String?
    public var markerColorHex: String?
    public var ariaLabelOverride: String?
    public var emptyMessageOverride: String?

    public init(
        autoPlay: Bool = false,
        showsLayerSwitcher: Bool = true,
        showsControls: Bool = true,
        height: Double = 400,
        initialMapStyle: RoutePlaybackMapStyle = .standard,
        trailColorHex: String? = nil,
        markerColorHex: String? = nil,
        ariaLabelOverride: String? = nil,
        emptyMessageOverride: String? = nil
    ) {
        self.autoPlay = autoPlay
        self.showsLayerSwitcher = showsLayerSwitcher
        self.showsControls = showsControls
        self.height = height
        self.initialMapStyle = initialMapStyle
        self.trailColorHex = trailColorHex
        self.markerColorHex = markerColorHex
        self.ariaLabelOverride = ariaLabelOverride
        self.emptyMessageOverride = emptyMessageOverride
    }
}

// MARK: - Resolved view-state (load axis + connectivity + route)

/// The resolved, view-ready state — the body status, the connectivity axis, the resolved route (the
/// last-known route, retained across an offline snapshot), and the static content. Computed by
/// ``RoutePlaybackProjection`` so the view holds no decision logic.
public struct RoutePlaybackResolved: Equatable, Sendable {
    public let status: RoutePlaybackLoadStatus
    public let connection: RoutePlaybackConnection
    public let route: RoutePlaybackRoute
    public let content: RoutePlaybackContent

    public init(
        status: RoutePlaybackLoadStatus,
        connection: RoutePlaybackConnection,
        route: RoutePlaybackRoute,
        content: RoutePlaybackContent
    ) {
        self.status = status
        self.connection = connection
        self.route = route
        self.content = content
    }

    /// Whether the bound route is live (no freshness chrome needed).
    public var isLive: Bool {
        connection.isLive
    }

    /// Whether the map + trail render — true whenever a plottable trail exists, so the cached trail
    /// stays visible beneath the error overlay (web keeps the last trail on a failed refetch).
    public var hasRoute: Bool {
        !route.isEmpty
    }
}

// MARK: - Playback frame (the live playhead view-state)

/// The live playhead view-state — the dynamic slice the model recomputes as the clock advances (the web
/// `currentIndex` / `isPlaying` / `speed` / `progress` / `cp` / `heading`). Pure value type, so the
/// view holds no playback math and the frame is asserted directly.
public struct RoutePlaybackFrame: Equatable, Sendable {
    public let currentIndex: Int
    public let count: Int
    public let isPlaying: Bool
    public let speedMultiplier: Int
    public let progress: Double
    public let elapsedLabel: String
    public let totalLabel: String
    public let currentPoint: RoutePlaybackPoint?
    public let heading: Double

    public init(
        currentIndex: Int,
        count: Int,
        isPlaying: Bool,
        speedMultiplier: Int,
        progress: Double,
        elapsedLabel: String,
        totalLabel: String,
        currentPoint: RoutePlaybackPoint?,
        heading: Double
    ) {
        self.currentIndex = currentIndex
        self.count = count
        self.isPlaying = isPlaying
        self.speedMultiplier = speedMultiplier
        self.progress = progress
        self.elapsedLabel = elapsedLabel
        self.totalLabel = totalLabel
        self.currentPoint = currentPoint
        self.heading = heading
    }

    /// Whether the playhead glyph renders — the cursor sample exists and sits on a plottable coordinate
    /// (web renders `<AnimatedMarker>` only when `cp` exists).
    public var hasPlayhead: Bool {
        guard let currentPoint else { return false }
        return RoutePlaybackGeo.isPlottable(currentPoint.coordinate)
    }

    /// The 1-based cursor position shown in the metric chip (web `currentIndex + 1`). Clamped to `count`.
    public var displayIndex: Int {
        min(count, currentIndex + 1)
    }
}

// MARK: - Projection (inputs → resolved / frame)

/// Pure projection from the surface inputs to the resolved view-state + the live frame. Mirrors the web
/// `RoutePlayback` decisions (render the trail when there is a plottable route; place the playhead at
/// `cp`; derive the heading from the surrounding samples) and folds in the load phase + connectivity for
/// the chrome the native surface adds.
public enum RoutePlaybackProjection {
    /// Resolves the body status + connectivity + route into the view-ready state.
    public static func resolve(
        content: RoutePlaybackContent,
        route: RoutePlaybackRoute,
        phase: RoutePlaybackLoadPhase,
        connection: RoutePlaybackConnection
    ) -> RoutePlaybackResolved {
        RoutePlaybackResolved(
            status: loadStatus(phase: phase, hasRoute: !route.isEmpty),
            connection: connection,
            route: route,
            content: content
        )
    }

    /// Folds the query phase + plottable-trail presence into the body status (the precedence documented
    /// on ``RoutePlaybackLoadStatus``).
    static func loadStatus(phase: RoutePlaybackLoadPhase, hasRoute: Bool) -> RoutePlaybackLoadStatus {
        if phase == .failed { return .error }
        if phase == .loading, !hasRoute { return .loading }
        if !hasRoute { return .empty }
        return .ready
    }

    /// Builds the live playhead frame from the playback clock + the route — the verbatim port of the web
    /// `progress` / `cp` / `heading` derivations.
    public static func frame(
        route: RoutePlaybackRoute,
        currentIndex: Int,
        isPlaying: Bool,
        speedMultiplier: Int,
        elapsedMs: Double
    ) -> RoutePlaybackFrame {
        let total = route.totalMs
        let progress = total > 0 ? min(max(elapsedMs / total, 0), 1) : 0
        return RoutePlaybackFrame(
            currentIndex: currentIndex,
            count: route.count,
            isPlaying: isPlaying,
            speedMultiplier: speedMultiplier,
            progress: progress,
            elapsedLabel: RoutePlaybackTiming.formatDuration(elapsedMs),
            totalLabel: RoutePlaybackTiming.formatDuration(total),
            currentPoint: route.point(at: currentIndex),
            heading: heading(in: route, at: currentIndex)
        )
    }

    /// The playhead heading at a cursor index — the verbatim port of the web heading memo (`< 2`
    /// samples → 0; otherwise the bearing from the previous to the next sample around the cursor).
    static func heading(in route: RoutePlaybackRoute, at index: Int) -> Double {
        let points = route.points
        guard points.count >= 2 else { return 0 }
        let next = index < points.count - 1 ? index + 1 : index
        let previous = next > 0 ? next - 1 : 0
        return RoutePlaybackGeo.heading(from: points[previous].coordinate, to: points[next].coordinate)
    }
}
