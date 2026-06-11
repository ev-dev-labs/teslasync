//
//  TripReplayMap.Projection.swift
//  TeslaSync — P4 feature view · 0274 · TripReplayMap (Apple)
//
//  The pure projection of `positions` + `currentIndex` into everything the map
//  renders — a faithful reproduction of every web `TripReplayMap.tsx` `useMemo`: the
//  meaningful-route gate, the trail, the speed-colored segments, the start / end pins,
//  the stationary-GPS anchor, the heading-aware playhead that tracks `currentIndex`
//  exclusively, the `centerPos` fallback chain, and the fit-bounds camera inputs. Also
//  the render-phase / load-status enums the bound source projects, and the pure
//  VoiceOver label builders (taking the P1/S10 facade so the view holds no literals).
//  Pure + `Equatable`, so the suite covers every branch without a rendered map.
//

import CoreLocation
import Foundation

// MARK: - Render phase (the load envelope around the web body)

/// What the surface should render. The web source distinguishes only positions-vs-no-
/// positions (`positions.length > 0 ? <map> : <EmptyState>`); the loading / error
/// envelope around it (prompt P4 states) is supplied by the bound source, mirroring
/// how the drive-detail page owns the fetch lifecycle.
public enum TripReplayMapPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case data
}

/// The bound source's load status for the drive query (web loading / resolved /
/// failure), projected into a phase by `TripReplayMapModel.resolvePhase`.
public enum TripReplayMapLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

// MARK: - Route geometry value types

/// One speed-colored leg of the trail (web `speedSegments` entry): the two endpoints +
/// the band that colors it.
public struct TripReplaySegment: Identifiable, Sendable, Equatable {
    public let id: Int
    public let start: TripReplayCoordinate
    public let end: TripReplayCoordinate
    public let band: TripReplaySpeedBand

    public init(id: Int, start: TripReplayCoordinate, end: TripReplayCoordinate, band: TripReplaySpeedBand) {
        self.id = id
        self.start = start
        self.end = end
        self.band = band
    }
}

/// The playhead marker (web `AnimatedMarker` / reduced-motion `CircleMarker`): the
/// current sample's coordinate plus the heading the arrow points along.
public struct TripReplayPlayhead: Sendable, Equatable {
    public let latitude: Double
    public let longitude: Double
    /// The great-circle heading in degrees `[0, 360)` (web `heading` memo).
    public let heading: Double

    public init(latitude: Double, longitude: Double, heading: Double) {
        self.latitude = latitude
        self.longitude = longitude
        self.heading = heading
    }

    /// The MapKit coordinate for the playhead.
    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

// MARK: - Projection

/// The fully-projected replay map: every value the view needs to draw the route,
/// markers, playhead, and camera without re-deriving anything. Built once from the
/// bound `positions` + `currentIndex`; the view reads it and never recomputes.
public struct TripReplayRoute: Sendable, Equatable {
    /// Web `positions.length > 0` — the map-vs-empty gate.
    public let hasPositions: Bool
    /// Web `hasMeaningfulRoute(positions)` — two valid coords ≥ 10 m apart.
    public let hasRoute: Bool
    /// Web `trail` — every position mapped to a coordinate (only when `hasRoute`),
    /// index-aligned with `positions` so a polyline tap resolves to the same sample.
    public let trail: [TripReplayCoordinate]
    /// Web `speedSegments` — the per-pair colored legs (only when `hasRoute`).
    public let segments: [TripReplaySegment]
    /// Web start `CircleMarker` (#10b981) — `trail[0]` when `hasRoute`.
    public let startPin: TripReplayCoordinate?
    /// Web end `CircleMarker` (#ef4444) — the last vertex when `hasRoute && trail > 1`.
    public let endPin: TripReplayCoordinate?
    /// Web stationary-GPS anchor `CircleMarker` (#22d3ee) — the first valid fix when
    /// `!hasRoute`.
    public let anchor: TripReplayCoordinate?
    /// Web playhead — the current sample (+ heading) when `hasRoute` and the index is
    /// in range (`positions[currentIndex] ?? null`).
    public let playhead: TripReplayPlayhead?
    /// Web `centerPos` — `startPos ?? anchorPoint ?? [47.6, -122.3]`.
    public let center: TripReplayCoordinate
    /// Web `FitBounds(trail = hasRoute ? trail : [], fallbackCenter = anchorPoint)` —
    /// the coordinates the camera frames on first appear + route change.
    public let cameraCoordinates: [TripReplayCoordinate]

    public init(
        hasPositions: Bool,
        hasRoute: Bool,
        trail: [TripReplayCoordinate],
        segments: [TripReplaySegment],
        startPin: TripReplayCoordinate?,
        endPin: TripReplayCoordinate?,
        anchor: TripReplayCoordinate?,
        playhead: TripReplayPlayhead?,
        center: TripReplayCoordinate,
        cameraCoordinates: [TripReplayCoordinate]
    ) {
        self.hasPositions = hasPositions
        self.hasRoute = hasRoute
        self.trail = trail
        self.segments = segments
        self.startPin = startPin
        self.endPin = endPin
        self.anchor = anchor
        self.playhead = playhead
        self.center = center
        self.cameraCoordinates = cameraCoordinates
    }

    /// The empty projection (no positions) — the loading / empty render seed.
    public static let empty = TripReplayRoute(
        hasPositions: false,
        hasRoute: false,
        trail: [],
        segments: [],
        startPin: nil,
        endPin: nil,
        anchor: nil,
        playhead: nil,
        center: TripReplayCoordinate(
            latitude: TripReplayGeo.fallbackCenterLatitude,
            longitude: TripReplayGeo.fallbackCenterLongitude
        ),
        cameraCoordinates: []
    )

    // MARK: Derivations

    /// Whether the stationary-GPS banner shows (web `positions.length > 0 && !hasRoute`).
    public var showStationaryBanner: Bool {
        hasPositions && !hasRoute
    }

    /// The min-haversine sample index for a tapped coordinate, scanning the trail
    /// (index-aligned with `positions` when `hasRoute`). Empty trail yields `0`,
    /// matching the web `nearestSampleIndex` early return.
    public func nearestTrailIndex(latitude: Double, longitude: Double) -> Int {
        guard !trail.isEmpty else { return 0 }
        var bestIndex = 0
        var bestDistance = Double.infinity
        for (index, vertex) in trail.enumerated() {
            let distance = TripReplayGeo.haversineMeters(vertex.latitude, vertex.longitude, latitude, longitude)
            if distance < bestDistance {
                bestDistance = distance
                bestIndex = index
            }
        }
        return bestIndex
    }

    // MARK: Builder (web component body — every useMemo, verbatim)

    /// Builds the projection from the bound `positions` + `currentIndex`, reproducing
    /// the web `TripReplayMap` body: `hasRoute`, `anchorPoint`, `trail`, `startPos` /
    /// `endPos`, `centerPos`, `speedSegments`, `heading`, and `currentPosition`.
    public static func make(positions: [TripReplayPosition], currentIndex: Int) -> TripReplayRoute {
        let hasRoute = TripReplayGeo.hasMeaningfulRoute(positions)
        let anchorPoint = anchor(in: positions)
        let trail = hasRoute ? positions
            .map { TripReplayCoordinate(latitude: $0.latitude, longitude: $0.longitude) } : []
        let startPos = trail.first
        let endPos = trail.count > 1 ? trail.last : nil
        let center = startPos ?? anchorPoint ?? TripReplayCoordinate(
            latitude: TripReplayGeo.fallbackCenterLatitude,
            longitude: TripReplayGeo.fallbackCenterLongitude
        )

        return TripReplayRoute(
            hasPositions: !positions.isEmpty,
            hasRoute: hasRoute,
            trail: trail,
            segments: hasRoute ? speedSegments(positions) : [],
            startPin: hasRoute ? startPos : nil,
            endPin: hasRoute ? endPos : nil,
            anchor: hasRoute ? nil : anchorPoint,
            playhead: playhead(positions: positions, currentIndex: currentIndex, hasRoute: hasRoute),
            center: center,
            cameraCoordinates: cameraCoordinates(hasRoute: hasRoute, trail: trail, anchor: anchorPoint, center: center)
        )
    }

    /// Web `anchorPoint` — the first valid fix, used as the stationary-GPS marker + the
    /// camera fallback center.
    private static func anchor(in positions: [TripReplayPosition]) -> TripReplayCoordinate? {
        let index = TripReplayGeo.firstValidIndex(positions)
        guard index >= 0 else { return nil }
        let point = positions[index]
        return TripReplayCoordinate(latitude: point.latitude, longitude: point.longitude)
    }

    /// Web `speedSegments` — a colored leg between each consecutive pair, banded by the
    /// later point's raw speed (`speedColor(curr.speed ?? 0)`).
    private static func speedSegments(_ positions: [TripReplayPosition]) -> [TripReplaySegment] {
        guard positions.count > 1 else { return [] }
        return (1 ..< positions.count).map { index in
            let previous = positions[index - 1]
            let current = positions[index]
            return TripReplaySegment(
                id: index - 1,
                start: TripReplayCoordinate(latitude: previous.latitude, longitude: previous.longitude),
                end: TripReplayCoordinate(latitude: current.latitude, longitude: current.longitude),
                band: TripReplaySpeedBand.forSpeed(current.speed ?? 0)
            )
        }
    }

    /// Web playhead — `currentPosition = hasRoute ? positions[currentIndex] ?? null`
    /// with the `heading` memo (`next = i<n-1 ? i+1 : i`, `prev = next>0 ? next-1 : 0`).
    private static func playhead(
        positions: [TripReplayPosition],
        currentIndex: Int,
        hasRoute: Bool
    ) -> TripReplayPlayhead? {
        guard hasRoute, currentIndex >= 0, currentIndex < positions.count else { return nil }
        let current = positions[currentIndex]
        return TripReplayPlayhead(
            latitude: current.latitude,
            longitude: current.longitude,
            heading: heading(positions: positions, currentIndex: currentIndex)
        )
    }

    /// Web `heading` memo — the great-circle bearing of the segment around the current
    /// sample; `0` when there is no route or fewer than two samples.
    private static func heading(positions: [TripReplayPosition], currentIndex: Int) -> Double {
        guard positions.count >= 2 else { return 0 }
        let next = currentIndex < positions.count - 1 ? currentIndex + 1 : currentIndex
        let previous = next > 0 ? next - 1 : 0
        return TripReplayGeo.heading(from: positions[previous], to: positions[next])
    }

    /// Web `FitBounds(trail = hasRoute ? trail : [], fallbackCenter = anchorPoint)` —
    /// fit the real route, else the single anchor (or center) so a stationary drive
    /// still lands on recognizable streets.
    private static func cameraCoordinates(
        hasRoute: Bool,
        trail: [TripReplayCoordinate],
        anchor: TripReplayCoordinate?,
        center: TripReplayCoordinate
    ) -> [TripReplayCoordinate] {
        if hasRoute, !trail.isEmpty { return trail }
        if let anchor { return [anchor] }
        return [center]
    }
}

// MARK: - Accessibility labels (pure, facade-driven — no literals in the view)

/// Builds the map's spoken/visible strings from the P1/S10 `localize` facade. Each
/// builder takes the facade closure so the view holds no literals and the spoken
/// content is unit-tested with an echo closure (no rendered map).
public enum TripReplayMapLabels {
    /// The map canvas summary read as one VoiceOver phrase: a route / stationary /
    /// empty lede.
    public static func canvasSummary(for route: TripReplayRoute, localize: (String, String) -> String) -> String {
        if !route.hasPositions {
            return localize("replay.map.noPositions", "No position data available for this drive")
        }
        if route.hasRoute {
            return localize("replay.map.mapLabel", "Trip replay route map")
        }
        return localize("replay.map.stationaryRouteTitle", "Route can't be plotted")
    }

    /// The start-pin label (web green start `CircleMarker`).
    public static func startLabel(localize: (String, String) -> String) -> String {
        localize("replay.map.start", "Start")
    }

    /// The end-pin label (web red end `CircleMarker`).
    public static func endLabel(localize: (String, String) -> String) -> String {
        localize("replay.map.end", "End")
    }

    /// The stationary-GPS anchor label (web cyan anchor `CircleMarker`).
    public static func anchorLabel(localize: (String, String) -> String) -> String {
        localize("replay.map.lastKnown", "Last known location")
    }

    /// The playhead label (web `AnimatedMarker`) — the current-position read-out.
    public static func playheadLabel(localize: (String, String) -> String) -> String {
        localize("replay.map.currentPosition", "Current position")
    }
}
