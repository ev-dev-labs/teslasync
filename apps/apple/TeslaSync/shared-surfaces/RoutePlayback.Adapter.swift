//
//  RoutePlayback.Adapter.swift
//  TeslaSync — P4 shared surface · 0187 · RoutePlayback (Apple)
//
//  The testable, dependency-light route core for the route-playback surface — the SwiftUI parity of
//  `components/maps/RoutePlayback.tsx`. Everything here is Foundation-only: the backend wire row (the
//  web `PlaybackPoint` the host feeds the widget from a trip-replay query), the resolved sample (its
//  native shape with a parsed timestamp + the relative millisecond offset), the resolved route (the web
//  derived `offsets` / `totalMs` / `trail` / start + end), the route adapter (the verbatim port of the
//  web `buildOffsets` + the finite-coordinate `trail` filter), and the surface diagnostics slug. No
//  store, no SwiftUI, no rendered view, so each piece is unit tested in isolation.
//
//  Every type is prefixed `RoutePlayback…` so the surface stays self-contained and does not collide
//  with another shared surface's internal types in the single app module.
//

import Foundation

// MARK: - Sample wire row (web `PlaybackPoint`)

/// The backend wire shape of one replay sample — the native port of the web `PlaybackPoint` the host
/// feeds the widget (`lat` / `lng` / `timestamp` + the optional `speed` / `soc` / `power` surfaced via
/// `onPositionChange`). Decoded by the source seam and adapted to ``RoutePlaybackRoute`` by
/// ``RoutePlaybackAdapter`` (no SwiftUI in the path). `timestamp` is an ISO-8601 string, exactly as the
/// web prop is.
public struct RoutePlaybackPointRow: Sendable, Equatable, Codable {
    public let lat: Double
    public let lng: Double
    public let timestamp: String
    public let speed: Double?
    public let soc: Double?
    public let power: Double?

    enum CodingKeys: String, CodingKey {
        case lat
        case lng
        case timestamp
        case speed
        case soc
        case power
    }

    public init(
        lat: Double,
        lng: Double,
        timestamp: String,
        speed: Double? = nil,
        soc: Double? = nil,
        power: Double? = nil
    ) {
        self.lat = lat
        self.lng = lng
        self.timestamp = timestamp
        self.speed = speed
        self.soc = soc
        self.power = power
    }
}

// MARK: - Resolved sample (web `PlaybackPoint` after parsing)

/// One resolved replay sample — the native port of a web `PlaybackPoint` after the component parses its
/// timestamp and derives its offset. `offsetMs` is the relative millisecond offset from the first
/// sample (web `offsets[i]`); `coordinate` carries the raw `lat` / `lng` (plottability is decided by
/// ``RoutePlaybackGeo/isPlottable(_:)`` when the trail is built).
public struct RoutePlaybackPoint: Sendable, Equatable {
    public let coordinate: RoutePlaybackCoordinate
    public let timestamp: Date?
    public let offsetMs: Double
    public let speed: Double?
    public let soc: Double?
    public let power: Double?

    public init(
        coordinate: RoutePlaybackCoordinate,
        timestamp: Date?,
        offsetMs: Double,
        speed: Double? = nil,
        soc: Double? = nil,
        power: Double? = nil
    ) {
        self.coordinate = coordinate
        self.timestamp = timestamp
        self.offsetMs = offsetMs
        self.speed = speed
        self.soc = soc
        self.power = power
    }
}

// MARK: - Resolved route (web derived `offsets` / `totalMs` / `trail` / start + end)

/// The resolved, view-ready route — the native shape of the web component's derived data: the ordered
/// samples (cursor space, web `points`), the plottable trail (web `trail` after the finite filter), the
/// per-sample offsets + total span (web `offsets` / `totalMs`), and the start / end anchors (web
/// `startPos` / `endPos`). `isEmpty` mirrors the web `trail.length === 0` empty gate.
public struct RoutePlaybackRoute: Sendable, Equatable {
    public let points: [RoutePlaybackPoint]
    public let trail: [RoutePlaybackCoordinate]
    public let offsets: [Double]
    public let totalMs: Double
    public let start: RoutePlaybackCoordinate?
    public let end: RoutePlaybackCoordinate?

    public init(
        points: [RoutePlaybackPoint],
        trail: [RoutePlaybackCoordinate],
        offsets: [Double],
        totalMs: Double,
        start: RoutePlaybackCoordinate?,
        end: RoutePlaybackCoordinate?
    ) {
        self.points = points
        self.trail = trail
        self.offsets = offsets
        self.totalMs = totalMs
        self.start = start
        self.end = end
    }

    /// An empty route — used before the first snapshot resolves.
    public static let empty = RoutePlaybackRoute(
        points: [],
        trail: [],
        offsets: [],
        totalMs: 0,
        start: nil,
        end: nil
    )

    /// The cursor-space sample count (web `points.length`, shown in the metric chip).
    public var count: Int {
        points.count
    }

    /// Whether there is nothing plottable to replay — the web `trail.length === 0` empty gate.
    public var isEmpty: Bool {
        trail.isEmpty
    }

    /// The sample at a cursor index, clamped into range — the web `points[currentIndex]` (`cp`).
    public func point(at index: Int) -> RoutePlaybackPoint? {
        guard !points.isEmpty else { return nil }
        let clamped = max(0, min(points.count - 1, index))
        return points[clamped]
    }
}

// MARK: - Adapter (web `buildOffsets` + finite `trail` filter)

/// Resolves a list of wire rows into a renderable route — the verbatim port of the web component's
/// derived-data block:
///
/// ```ts
/// const offsets = buildOffsets(points)
/// const trail = points.filter(p => isFinite(p.lat) && isFinite(p.lng)).map(p => [p.lat, p.lng])
/// const startPos = trail[0]; const endPos = trail.length > 1 ? trail.at(-1) : undefined
/// ```
///
/// Pure + total: timestamps are parsed once (ISO-8601, with / without fractional seconds), offsets are
/// taken relative to the first sample, and only finite, in-range coordinates enter the trail.
public enum RoutePlaybackAdapter {
    /// Adapts wire rows to a resolved route. An empty input resolves to ``RoutePlaybackRoute/empty``.
    public static func route(from rows: [RoutePlaybackPointRow]) -> RoutePlaybackRoute {
        guard !rows.isEmpty else { return .empty }

        let parser = RoutePlaybackTimestampParser()
        let timestamps = rows.map { parser.parse($0.timestamp) }
        let offsets = RoutePlaybackTiming.offsets(from: timestamps)

        let points: [RoutePlaybackPoint] = rows.enumerated().map { index, row in
            RoutePlaybackPoint(
                coordinate: RoutePlaybackCoordinate(latitude: row.lat, longitude: row.lng),
                timestamp: timestamps[index],
                offsetMs: index < offsets.count ? offsets[index] : 0,
                speed: row.speed,
                soc: row.soc,
                power: row.power
            )
        }

        let trail = points
            .map(\.coordinate)
            .filter(RoutePlaybackGeo.isPlottable)

        return RoutePlaybackRoute(
            points: points,
            trail: trail,
            offsets: offsets,
            totalMs: offsets.last ?? 0,
            start: trail.first,
            end: trail.count > 1 ? trail.last : nil
        )
    }

    /// Parses an ISO-8601 timestamp, tolerating the fractional-seconds variant — the native parity of
    /// the web `new Date(p.timestamp)`. Returns `nil` for an unparseable value (it contributes a `0`
    /// offset, exactly as the web `Number.isNaN` guard does).
    public static func parseTimestamp(_ value: String) -> Date? {
        RoutePlaybackTimestampParser().parse(value)
    }
}

// MARK: - Timestamp parser (web `new Date(p.timestamp)`)

/// A reusable ISO-8601 parser tolerating the fractional-seconds variant — built once per route adapt, a
/// concurrency-safe alternative to a shared static `ISO8601DateFormatter` (which is not `Sendable`).
struct RoutePlaybackTimestampParser {
    private let fractional: ISO8601DateFormatter
    private let plain: ISO8601DateFormatter

    init() {
        fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
    }

    func parse(_ value: String) -> Date? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let withFraction = fractional.date(from: trimmed) { return withFraction }
        return plain.date(from: trimmed)
    }
}

// MARK: - Surface metadata (P1/S11 diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum RoutePlaybackMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "RoutePlayback"
}
