//
//  MarkerCluster.Projection.swift
//  TeslaSync — P4 shared surface · 0186 · MarkerCluster (Apple)
//
//  The pure projection from the surface inputs to the resolved view-state — the native port of the
//  web `MarkerCluster` render decisions (the point list → cluster markers, the default-colour and
//  cluster-radius / disable-zoom config) widened with the P4 leaf connectivity axis and the explicit
//  load states the prompt requires every surface to render. The view is a pure function of
//  `MarkerClusterResolved`; every branch is unit tested without a map. Foundation-only.
//

import Foundation

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound point feed — the orthogonal connectivity axis the surface renders as a
/// chip + banner. `live` shows the map alone; `stale` adds a refresh affordance and triggers a
/// one-shot auto-refresh; `offline` keeps the last-known markers with an offline marker.
public enum MarkerClusterConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Feed load phase (web parent query status)

/// The point-feed phase — the native mirror of the web parent's `useQuery` status that supplies the
/// `points` prop. The web component renders whatever points it is handed; the native surface folds
/// this phase into the loading / error states it must always render.
public enum MarkerClusterLoadPhase: String, Sendable, Equatable, CaseIterable {
    case loading
    case loaded
    case failed
}

// MARK: - Resolved body status (loading / empty / error / ready)

/// The resolved body status the surface chrome renders — folds the feed phase with the rendered
/// point count. Precedence: a failed feed is `.error`; an in-flight feed with no cached markers is
/// `.loading`; a resolved feed with no renderable markers is `.empty`; otherwise `.ready`.
public enum MarkerClusterLoadStatus: String, Sendable, Equatable, CaseIterable {
    case loading
    case empty
    case error
    case ready
}

// MARK: - Cluster colour mode (web default palette vs `getClusterColor`)

/// How a cluster bubble picks its colour — the native expression of the web component's two cluster
/// colouring paths. `countDensity` is the web `defaultIconCreate` count ladder; `dominantChild` is
/// the native default for the web `getClusterColor(children)` override (the dominant child colour).
public enum MarkerClusterColorMode: String, Sendable, Equatable, CaseIterable, Identifiable {
    case countDensity
    case dominantChild

    public var id: String {
        rawValue
    }

    /// The i18n key for the human-facing mode label (native chrome).
    public var labelKey: String {
        "markerCluster.colorMode.\(rawValue)"
    }

    /// The English fallback for ``labelKey``.
    public var labelFallback: String {
        switch self {
        case .countDensity: "Colour by density"
        case .dominantChild: "Colour by category"
        }
    }

    /// SF Symbol that represents this mode in the switcher.
    public var systemImage: String {
        switch self {
        case .countDensity: "circle.grid.3x3.fill"
        case .dominantChild: "paintpalette"
        }
    }
}

// MARK: - Surface content (web props)

/// The per-instance configuration the surface is parameterised by — the native shape of the web
/// `MarkerClusterProps` minus the closure props (which become the native colour mode + selection
/// callback): the cluster pixel radius (`maxClusterRadius`), the disable-clustering zoom
/// (`disableClusteringAtZoom`), the default marker colour (`defaultColor`), the cluster colour mode
/// (web `getClusterColor` vs default palette), and the native fullscreen affordance.
public struct MarkerClusterContent: Sendable, Equatable {
    public var maxClusterRadius: Double
    public var disableClusteringAtZoom: Int
    public var defaultColorHex: String
    public var colorMode: MarkerClusterColorMode
    public var fullscreenEnabled: Bool

    public init(
        maxClusterRadius: Double = MarkerClusterMeta.defaultClusterRadius,
        disableClusteringAtZoom: Int = MarkerClusterMeta.defaultDisableClusteringAtZoom,
        defaultColorHex: String = MarkerClusterMeta.defaultMarkerColorHex,
        colorMode: MarkerClusterColorMode = .countDensity,
        fullscreenEnabled: Bool = true
    ) {
        self.maxClusterRadius = maxClusterRadius
        self.disableClusteringAtZoom = disableClusteringAtZoom
        self.defaultColorHex = defaultColorHex
        self.colorMode = colorMode
        self.fullscreenEnabled = fullscreenEnabled
    }
}

// MARK: - Resolved view-state

/// The resolved, view-ready state — the body status, the connectivity axis, the sanitised markers
/// (capped + finite), the raw/rendered counts (so the surface can show "showing N of M" when the
/// 5000 cap or a NaN guard dropped points), the default colour + colour mode, and the cluster radius
/// / disable-zoom config. Computed once by ``MarkerClusterProjection`` so the view holds no decision
/// logic.
public struct MarkerClusterResolved: Equatable, Sendable {
    public let status: MarkerClusterLoadStatus
    public let connection: MarkerClusterConnection
    public let points: [MarkerClusterPoint]
    public let totalCount: Int
    public let defaultColorHex: String
    public let colorMode: MarkerClusterColorMode
    public let maxClusterRadius: Double
    public let disableClusteringAtZoom: Int

    public init(
        status: MarkerClusterLoadStatus,
        connection: MarkerClusterConnection,
        points: [MarkerClusterPoint],
        totalCount: Int,
        defaultColorHex: String,
        colorMode: MarkerClusterColorMode,
        maxClusterRadius: Double,
        disableClusteringAtZoom: Int
    ) {
        self.status = status
        self.connection = connection
        self.points = points
        self.totalCount = totalCount
        self.defaultColorHex = defaultColorHex
        self.colorMode = colorMode
        self.maxClusterRadius = maxClusterRadius
        self.disableClusteringAtZoom = disableClusteringAtZoom
    }

    /// The number of markers actually rendered after the cap + NaN guard.
    public var renderedCount: Int {
        points.count
    }

    /// The number of points dropped by the 5000 cap or the finite-coordinate guard.
    public var omittedCount: Int {
        max(0, totalCount - renderedCount)
    }

    /// Whether any points were dropped (drives the "showing N of M" note).
    public var isTruncated: Bool {
        omittedCount > 0
    }

    /// Whether the bound feed is live (no freshness chrome needed).
    public var isLive: Bool {
        connection == .live
    }

    /// Whether there is at least one renderable marker (false only in the `.empty` status).
    public var canRender: Bool {
        status != .empty
    }
}

// MARK: - Projection (inputs → resolved)

/// Pure projection from the surface inputs to the resolved view-state. Mirrors the web
/// `MarkerCluster` data handling exactly (cap + NaN filter) and folds in the feed phase + the P4
/// connectivity axis for the chrome the native surface adds.
public enum MarkerClusterProjection {
    /// Resolves the full view-state. `points` is the latest feed snapshot; `content` is the surface
    /// config (the web props); `phase` is the feed status; `connection` is the P4 freshness axis.
    public static func resolve(
        points: [MarkerClusterPoint],
        content: MarkerClusterContent,
        phase: MarkerClusterLoadPhase,
        connection: MarkerClusterConnection
    ) -> MarkerClusterResolved {
        let sanitised = MarkerClusterLogic.sanitize(points)
        let status = loadStatus(phase: phase, renderedCount: sanitised.count)
        return MarkerClusterResolved(
            status: status,
            connection: connection,
            points: sanitised,
            totalCount: points.count,
            defaultColorHex: content.defaultColorHex,
            colorMode: content.colorMode,
            maxClusterRadius: content.maxClusterRadius,
            disableClusteringAtZoom: content.disableClusteringAtZoom
        )
    }

    /// Folds the feed phase + rendered-marker count into the body status (the precedence documented
    /// on ``MarkerClusterLoadStatus``).
    static func loadStatus(phase: MarkerClusterLoadPhase, renderedCount: Int) -> MarkerClusterLoadStatus {
        if phase == .failed { return .error }
        if phase == .loading, renderedCount == 0 { return .loading }
        if renderedCount == 0 { return .empty }
        return .ready
    }
}
