//
//  GeofenceDrawer.Adapter.swift
//  TeslaSync — P4 modal/dialog · 0011 · GeofenceDrawer (Apple)
//
//  The testable projection core for the geofence drawer — the faithful port of
//  components/maps/GeofenceDrawer.tsx. The web source is a passive `leaflet-draw` controller that
//  mounts circle / polygon / rectangle draw tools onto the parent map, renders the persisted
//  `fences`, and emits structured `NewGeofence` geometry through `onCreate` / `onEdit` / `onDelete`.
//  Everything here is pure and dependency-free (Foundation only) so the geometry decisions —
//  `fenceToLayer` (the render decision), `layerToGeometry` (the circle / rectangle / polygon
//  constructors), the `toFixed` number formatting, and the interactive draw reducer — can be
//  unit-tested without a map, a store, or a rendered view.
//
//  Web parity notes:
//    • `GeofenceMode` union          → `GeofenceDrawerMode` (+ `.order`, default `[.circle]`).
//    • `DrawableGeofence`            → `GeofenceItem` (id / name / lat / lng / radius / polygon).
//    • `NewGeofence`                 → `NewGeofence` (shape + the same optional fields).
//    • `fenceToLayer(f, color)`      → `GeofenceGeometry.renderKind(for:)` — circle wins when both.
//    • `layerToGeometry(layer, …)`   → `GeofenceGeometry.circle / .rectangle / .polygon`.
//    • the rectangle bounds → ring   → `GeofenceGeometry.rectangleRing(sw:ne:)`, pinned verbatim.
//    • `describeFence` numerics      → `GeofenceFormat.fixed(_:places:)` (locale-independent).
//    • the leaflet-draw create flow  → `GeofenceDraft` (tap → point, slider → radius, commit).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core
/// so the projection's unit tests can reach it.
public enum GeofenceDrawerSurface {
    public static let slug = "GeofenceDrawer"
}

// MARK: - Load status / freshness

/// The bound source's load status for the persisted geofences. The web reads its `fences`
/// synchronously from props; the native surface models the load lifecycle here so every state
/// renders. `nil` fences in an update mean "not resolved yet".
public enum GeofenceDrawerLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so the
/// drawer labels when a saved fence may not have synced yet.
public enum GeofenceDrawerConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Draw modes (web `GeofenceMode`)

/// The shapes the drawer can author — the native parity of the web `GeofenceMode` union. Order
/// matches the web toolbar so the mode picker renders identically.
public enum GeofenceDrawerMode: String, Sendable, Equatable, CaseIterable, Identifiable {
    case circle
    case polygon
    case rectangle

    public var id: String {
        rawValue
    }

    /// The display order (web circle / polygon / rectangle).
    public static let order: [GeofenceDrawerMode] = [.circle, .polygon, .rectangle]

    /// The web default when `modes` is omitted: `['circle']`.
    public static let defaultModes: [GeofenceDrawerMode] = [.circle]

    /// The SF Symbol standing in for the leaflet-draw tool glyph.
    public var systemImage: String {
        switch self {
        case .circle: "circle"
        case .polygon: "hexagon"
        case .rectangle: "rectangle"
        }
    }

    /// The i18n key + web English fallback for the mode's toolbar label.
    public var labelKey: String {
        "geofence.mode.\(rawValue)"
    }

    public var labelFallback: String {
        switch self {
        case .circle: "Circle"
        case .polygon: "Polygon"
        case .rectangle: "Rectangle"
        }
    }
}

// MARK: - Geometry primitives (web `[lat, lng]` tuples)

/// A single `[lat, lng]` coordinate — the native parity of the web tuple. Stored as plain doubles
/// so the core stays Foundation-only (no CoreLocation) and fully unit-testable.
public struct GeofencePoint: Sendable, Equatable, Hashable {
    public let lat: Double
    public let lng: Double

    public init(lat: Double, lng: Double) {
        self.lat = lat
        self.lng = lng
    }

    /// Whether the coordinate is within valid lat/lng ranges (drops obviously-bad taps).
    public var isValid: Bool {
        lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    }
}

/// A persisted or draft geofence — the native parity of the web `DrawableGeofence`. Circles carry
/// `lat` / `lng` / `radius` (meters); polygons + rectangles carry a `polygon` ring.
public struct GeofenceItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String?
    public let lat: Double?
    public let lng: Double?
    public let radius: Double?
    public let polygon: [GeofencePoint]?

    public init(
        id: String,
        name: String? = nil,
        lat: Double? = nil,
        lng: Double? = nil,
        radius: Double? = nil,
        polygon: [GeofencePoint]? = nil
    ) {
        self.id = id
        self.name = name
        self.lat = lat
        self.lng = lng
        self.radius = radius
        self.polygon = polygon
    }
}

/// New geometry produced by the drawer (no id yet) — the native parity of the web `NewGeofence`
/// handed to `onCreate` / `onEdit`.
public struct NewGeofence: Sendable, Equatable {
    public let shape: GeofenceDrawerMode
    public let lat: Double?
    public let lng: Double?
    public let radius: Double?
    public let polygon: [GeofencePoint]?

    public init(
        shape: GeofenceDrawerMode,
        lat: Double? = nil,
        lng: Double? = nil,
        radius: Double? = nil,
        polygon: [GeofencePoint]? = nil
    ) {
        self.shape = shape
        self.lat = lat
        self.lng = lng
        self.radius = radius
        self.polygon = polygon
    }
}

/// How a persisted fence should be drawn on the map — the resolved output of the web `fenceToLayer`
/// decision. `.none` means the fence has no renderable geometry (web returns `null`, no layer added).
public enum GeofenceRenderKind: Sendable, Equatable {
    case circle(center: GeofencePoint, radius: Double)
    case polygon(ring: [GeofencePoint])
    case none
}

// MARK: - Geometry decisions (web `fenceToLayer` / `layerToGeometry`)

/// The pure geometry rules shared by the map, the projection, and the draw reducer.
public enum GeofenceGeometry {
    /// Port of `fenceToLayer`: a circle when `lat` / `lng` / `radius` are present AND `radius > 0`
    /// (this precedence wins even if a polygon is also present), else a polygon when the ring has
    /// at least three vertices, else nothing.
    public static func renderKind(for item: GeofenceItem) -> GeofenceRenderKind {
        if let lat = item.lat, let lng = item.lng, let radius = item.radius, radius > 0 {
            return .circle(center: GeofencePoint(lat: lat, lng: lng), radius: radius)
        }
        if let polygon = item.polygon, polygon.count >= 3 {
            return .polygon(ring: polygon)
        }
        return .none
    }

    /// Port of `layerToGeometry` circle branch.
    public static func circle(center: GeofencePoint, radius: Double) -> NewGeofence {
        NewGeofence(shape: .circle, lat: center.lat, lng: center.lng, radius: radius)
    }

    /// Port of `layerToGeometry` rectangle branch — the bounds → 4-corner ring, pinned verbatim:
    /// `[sw, (ne.lat, sw.lng), ne, (sw.lat, ne.lng)]`.
    public static func rectangleRing(sw: GeofencePoint, ne: GeofencePoint) -> [GeofencePoint] {
        [
            sw,
            GeofencePoint(lat: ne.lat, lng: sw.lng),
            ne,
            GeofencePoint(lat: sw.lat, lng: ne.lng)
        ]
    }

    /// Assembles a rectangle `NewGeofence` from two opposite corners.
    public static func rectangle(sw: GeofencePoint, ne: GeofencePoint) -> NewGeofence {
        NewGeofence(shape: .rectangle, polygon: rectangleRing(sw: sw, ne: ne))
    }

    /// Port of `layerToGeometry` polygon branch — the ring verbatim.
    public static func polygon(ring: [GeofencePoint]) -> NewGeofence {
        NewGeofence(shape: .polygon, polygon: ring)
    }

    /// Normalises two arbitrary corner taps into the south-west / north-east pair a rectangle
    /// bounds uses (web `getSouthWest` / `getNorthEast`).
    public static func corners(_ first: GeofencePoint, _ second: GeofencePoint) -> GeofenceCorners {
        let sw = GeofencePoint(lat: min(first.lat, second.lat), lng: min(first.lng, second.lng))
        let ne = GeofencePoint(lat: max(first.lat, second.lat), lng: max(first.lng, second.lng))
        return (sw, ne)
    }
}

/// A south-west / north-east corner pair (a rectangle bounds).
public typealias GeofenceCorners = (sw: GeofencePoint, ne: GeofencePoint)

// MARK: - Number formatting (web `Number.prototype.toFixed`)

/// Locale-independent fixed-decimal formatting — the parity of the web `toFixed`, used by
/// `describeFence`. Always renders a `.` decimal separator (en_US_POSIX) so the accessible string
/// matches the web regardless of the device locale.
public enum GeofenceFormat {
    private static let posix = Locale(identifier: "en_US_POSIX")

    /// `value.toFixed(places)` — clamps a negative `places` to zero.
    public static func fixed(_ value: Double, places: Int) -> String {
        String(format: "%.\(max(0, places))f", locale: posix, value)
    }
}

// MARK: - Interactive draw reducer (web `leaflet-draw` create flow)

/// The in-progress geometry the user is authoring by tapping the map — the native analog of the
/// leaflet-draw interactive create handlers. A pure value type: every edit returns a new draft so
/// the model just swaps it in and SwiftUI re-renders. Commit resolves to a `NewGeofence` (web
/// `Draw.Event.CREATED` → `layerToGeometry`).
public struct GeofenceDraft: Sendable, Equatable {
    public var mode: GeofenceDrawerMode
    public var points: [GeofencePoint]
    public var radiusMeters: Double

    /// The default circle radius (meters) the slider starts at.
    public static let defaultRadius: Double = 250

    public init(mode: GeofenceDrawerMode, points: [GeofencePoint] = [], radiusMeters: Double = defaultRadius) {
        self.mode = mode
        self.points = points
        self.radiusMeters = radiusMeters
    }

    /// A fresh empty draft for a mode.
    public static func start(mode: GeofenceDrawerMode) -> GeofenceDraft {
        GeofenceDraft(mode: mode)
    }

    /// The number of points placed so far (drives the toolbar hint).
    public var pointCount: Int {
        points.count
    }

    /// Whether the draft has enough geometry to commit: a circle needs one center + a positive
    /// radius, a rectangle needs two corners, a polygon needs three vertices.
    public var canCommit: Bool {
        switch mode {
        case .circle: points.count == 1 && radiusMeters > 0
        case .rectangle: points.count == 2
        case .polygon: points.count >= 3
        }
    }

    /// Adds a tapped point. A circle keeps only the latest tap as its center; a rectangle keeps two
    /// corners (a further tap restarts it); a polygon appends a vertex.
    public func adding(_ point: GeofencePoint) -> GeofenceDraft {
        var copy = self
        switch mode {
        case .circle:
            copy.points = [point]
        case .rectangle:
            copy.points = points.count >= 2 ? [point] : points + [point]
        case .polygon:
            copy.points = points + [point]
        }
        return copy
    }

    /// Sets the circle radius (meters).
    public func settingRadius(_ radius: Double) -> GeofenceDraft {
        var copy = self
        copy.radiusMeters = max(0, radius)
        return copy
    }

    /// Removes the most recent point (the toolbar Undo).
    public func removingLast() -> GeofenceDraft {
        guard !points.isEmpty else { return self }
        var copy = self
        copy.points.removeLast()
        return copy
    }

    /// Switches mode and clears the placed points (a different shape starts fresh).
    public func settingMode(_ newMode: GeofenceDrawerMode) -> GeofenceDraft {
        GeofenceDraft(mode: newMode, points: [], radiusMeters: radiusMeters)
    }

    /// Clears the placed points but keeps the mode + radius (the toolbar Cancel).
    public func cleared() -> GeofenceDraft {
        GeofenceDraft(mode: mode, points: [], radiusMeters: radiusMeters)
    }

    /// Resolves the committed geometry, or `nil` when the draft can't yet commit (web
    /// `layerToGeometry`).
    public func geometry() -> NewGeofence? {
        guard canCommit else { return nil }
        switch mode {
        case .circle:
            return GeofenceGeometry.circle(center: points[0], radius: radiusMeters)
        case .rectangle:
            let pair = GeofenceGeometry.corners(points[0], points[1])
            return GeofenceGeometry.rectangle(sw: pair.sw, ne: pair.ne)
        case .polygon:
            return GeofenceGeometry.polygon(ring: points)
        }
    }
}
