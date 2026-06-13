//
//  AnimatedMarker.Projection.swift
//  TeslaSync — P4 shared surface · 0184 · AnimatedMarker (Apple)
//
//  The pure projection from the surface inputs to the resolved view-state — the native port of the
//  web `AnimatedMarker` render decision (a marker is shown when there is a usable coordinate) widened
//  with the P4 leaf connectivity axis and the explicit load states the prompt requires every surface
//  to render. The view is a pure function of `AnimatedMarkerResolved`; every branch is unit tested
//  without rendering. Foundation-only.
//

import Foundation

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound marker fix — the orthogonal connectivity axis the surface renders as a
/// chip + banner. `live` shows the marker alone; `stale` adds a refresh affordance and triggers a
/// one-shot auto-refresh; `offline` keeps the last-known marker with an offline marker.
public enum AnimatedMarkerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline

    /// Whether the bound fix is live (no freshness chrome needed).
    public var isLive: Bool {
        self == .live
    }
}

// MARK: - Fix load phase (web query status feeding the marker)

/// The position-query phase — the native mirror of the web consumers' `useQuery` status feeding the
/// marker (`isLoading` / settled / `isError`). The surface renders a loading overlay before the first
/// fix, an error card on failure, and the marker once a usable fix resolves.
public enum AnimatedMarkerLoadPhase: String, Sendable, Equatable, CaseIterable {
    case loading
    case loaded
    case failed
}

// MARK: - Resolved body status (loading / empty / error / ready)

/// The resolved body status the surface chrome renders — folds the fix-query phase with the presence
/// of a usable fix. Precedence: a failed query is `.error`; an in-flight query with no cached fix is
/// `.loading`; a settled query with no usable coordinate is `.empty` (web `hasCoords === false`);
/// otherwise `.ready`.
public enum AnimatedMarkerLoadStatus: String, Sendable, Equatable, CaseIterable {
    case loading
    case empty
    case error
    case ready
}

// MARK: - Surface content (web props + native chrome config)

/// The per-instance configuration the surface is parameterised by — the native shape of the web
/// `AnimatedMarkerProps` defaults (`color`) plus the host map framing the web marker inherits from
/// its parent `MapContainer` (`span`). `showsHeadingIndicator` exposes the web heading branch
/// (`heading != null`) as a host toggle; it defaults on.
public struct AnimatedMarkerContent: Sendable, Equatable {
    public var defaultColorHex: String
    public var showsHeadingIndicator: Bool
    public var span: AnimatedMarkerSpan

    public init(
        defaultColorHex: String = AnimatedMarkerPalette.defaultHex,
        showsHeadingIndicator: Bool = true,
        span: AnimatedMarkerSpan = .defaultZoom
    ) {
        self.defaultColorHex = defaultColorHex
        self.showsHeadingIndicator = showsHeadingIndicator
        self.span = span
    }
}

// MARK: - Resolved view-state

/// The resolved, view-ready state — the body status, the connectivity axis, the optional marker fix
/// (the last-known fix, retained across an offline snapshot), and the framing span. Computed once by
/// ``AnimatedMarkerProjection`` so the view holds no decision logic.
public struct AnimatedMarkerResolved: Equatable, Sendable {
    public let status: AnimatedMarkerLoadStatus
    public let connection: AnimatedMarkerConnection
    public let fix: AnimatedMarkerFix?
    public let span: AnimatedMarkerSpan

    public init(
        status: AnimatedMarkerLoadStatus,
        connection: AnimatedMarkerConnection,
        fix: AnimatedMarkerFix?,
        span: AnimatedMarkerSpan
    ) {
        self.status = status
        self.connection = connection
        self.fix = fix
        self.span = span
    }

    /// Whether the bound fix is live (no freshness chrome needed).
    public var isLive: Bool {
        connection.isLive
    }

    /// Whether the marker glyph renders — true whenever a usable fix exists, so the cached marker
    /// stays visible beneath the error card (web keeps the last marker on a failed refetch).
    public var hasMarker: Bool {
        fix != nil
    }
}

// MARK: - Projection (inputs → resolved)

/// Pure projection from the surface inputs to the resolved view-state. Mirrors the web
/// `AnimatedMarker` decision (render the marker for a usable coordinate) and folds in the load phase
/// + connectivity for the chrome the native surface adds.
public enum AnimatedMarkerProjection {
    /// Resolves the full view-state. `fix` is the latest adapted marker fix (nil before the first
    /// usable coordinate); `phase` is the query status; `connection` is the P4 freshness axis.
    public static func resolve(
        content: AnimatedMarkerContent,
        fix: AnimatedMarkerFix?,
        phase: AnimatedMarkerLoadPhase,
        connection: AnimatedMarkerConnection
    ) -> AnimatedMarkerResolved {
        AnimatedMarkerResolved(
            status: loadStatus(phase: phase, hasFix: fix != nil),
            connection: connection,
            fix: fix,
            span: content.span
        )
    }

    /// Folds the query phase + usable-fix presence into the body status (the precedence documented on
    /// ``AnimatedMarkerLoadStatus``).
    static func loadStatus(phase: AnimatedMarkerLoadPhase, hasFix: Bool) -> AnimatedMarkerLoadStatus {
        if phase == .failed { return .error }
        if phase == .loading, !hasFix { return .loading }
        if !hasFix { return .empty }
        return .ready
    }
}
