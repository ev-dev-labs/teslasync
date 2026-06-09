//
//  GeofenceWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0053 · GeofenceWidget (Apple)
//
//  The pure cached-DTO → projection seam. Mirrors the web source's derivations in
//  features/dashboard/widgets/GeofenceWidget.tsx:
//
//    hasCoords    = state.latitude !== 0 || state.longitude !== 0
//    dist         = hasCoords ? haversineMeters(v, fence) : Infinity
//    inside       = dist <= (radius ?? 0)
//    name         = g.name ?? '—'   radius = g.radius ?? 0   enabled = g.enabled ?? true
//    currentZone  = fences.find(f => f.inside && f.enabled)
//    fmtRadius(m) = `${fmtNumber(convertDistanceFromSI(m, unit), 1)} ${unit}`
//
//  Everything here is value-typed + side-effect free (Foundation + CoreLocation
//  only, no SwiftUI, no KMP `Shared`) so the adapter is fully unit testable
//  (Acceptance Criteria: "adapter unit test").
//

import CoreLocation
import Foundation

// MARK: - Display unit (web `unitPrefs.distance`)

/// The user's distance display unit, the native parity of the web
/// `useUnits().unitPrefs.distance` label. `from(label:)` mirrors the web
/// `deriveDistance` fallback (anything but `mi`/`ft` ⇒ kilometers).
public enum GeofenceWidgetDistanceUnit: String, Sendable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// The unit suffix the web appends after the radius value (`unitPrefs.distance`).
    public var label: String {
        rawValue
    }

    /// SI meters in one unit — the divisor `convertDistanceFromSI` uses.
    public var metersPerUnit: Double {
        switch self {
        case .kilometers: 1000
        case .miles: 1609.344
        case .feet: 0.3048
        }
    }

    /// Converts SI meters into this unit (web `convertDistanceFromSI`).
    public func convert(_ meters: Double) -> Double {
        meters / metersPerUnit
    }

    /// Maps a preference label to the unit, defaulting to kilometers (web
    /// `deriveDistance` only ever yields `km`/`mi`, but `ft` is supported too).
    public static func from(label: String?) -> GeofenceWidgetDistanceUnit {
        GeofenceWidgetDistanceUnit(rawValue: label ?? "") ?? .kilometers
    }
}

// MARK: - Cached inputs

/// One raw geofence row as the shared `Geofence` DTO returns it. The optionals
/// carry the web's defensive `?? '—' / ?? 0 / ?? true` defaults into the builder.
public struct GeofenceWidgetFenceInput: Sendable, Equatable, Identifiable {
    public var id: String
    public var name: String?
    public var radiusMeters: Double?
    public var latitude: Double
    public var longitude: Double
    public var enabled: Bool?

    public init(
        id: String,
        name: String?,
        radiusMeters: Double?,
        latitude: Double,
        longitude: Double,
        enabled: Bool?
    ) {
        self.id = id
        self.name = name
        self.radiusMeters = radiusMeters
        self.latitude = latitude
        self.longitude = longitude
        self.enabled = enabled
    }
}

/// The current vehicle position the source projects from the shared
/// `VehicleState` DTO (`latitude`, `longitude`). Raw WGS-84 degrees — no unit
/// conversion (the SI contract governs displayed physical quantities, not
/// geographic coordinates).
public struct GeofenceWidgetVehicleFix: Sendable, Equatable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

// MARK: - Per-fence projection

/// A single fence's resolved status, the native parity of the web `FenceStatus`
/// (`inside`/`enabled`/`distanceM`) plus the pre-formatted `radiusText`.
public struct GeofenceWidgetFenceStatus: Identifiable, Equatable, Sendable {
    /// Which badge a fence shows (web: `!enabled` → Disabled, `inside` → Inside,
    /// else Outside).
    public enum Membership: Sendable {
        case disabled
        case inside
        case outside
    }

    public let id: String
    public let name: String
    public let radiusMeters: Double
    public let latitude: Double
    public let longitude: Double
    public let enabled: Bool
    public let inside: Bool
    /// Haversine meters to the vehicle, or `.infinity` when the vehicle position
    /// is unknown (web `Infinity`).
    public let distanceMeters: Double
    /// Radius rendered in the user's unit (web `fmtRadius`).
    public let radiusText: String

    public init(
        id: String,
        name: String,
        radiusMeters: Double,
        latitude: Double,
        longitude: Double,
        enabled: Bool,
        inside: Bool,
        distanceMeters: Double,
        radiusText: String
    ) {
        self.id = id
        self.name = name
        self.radiusMeters = radiusMeters
        self.latitude = latitude
        self.longitude = longitude
        self.enabled = enabled
        self.inside = inside
        self.distanceMeters = distanceMeters
        self.radiusText = radiusText
    }

    /// The fence center as a MapKit coordinate.
    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    /// The badge membership (web's three-way badge branch).
    public var membership: Membership {
        if !enabled { return .disabled }
        return inside ? .inside : .outside
    }

    /// Whether the row gets the active highlight (web `f.inside && f.enabled`).
    public var isActive: Bool {
        inside && enabled
    }
}

// MARK: - Whole-widget projection

/// The validated projection the view renders: the resolved fences, whether a
/// usable vehicle coordinate exists (web `hasCoords`), and the vehicle position.
public struct GeofenceWidgetProjection: Equatable, Sendable {
    public let fences: [GeofenceWidgetFenceStatus]
    public let hasVehicleCoordinate: Bool
    public let vehicleLatitude: Double
    public let vehicleLongitude: Double

    public init(
        fences: [GeofenceWidgetFenceStatus],
        hasVehicleCoordinate: Bool,
        vehicleLatitude: Double,
        vehicleLongitude: Double
    ) {
        self.fences = fences
        self.hasVehicleCoordinate = hasVehicleCoordinate
        self.vehicleLatitude = vehicleLatitude
        self.vehicleLongitude = vehicleLongitude
    }

    /// The empty projection (no fences, no vehicle fix).
    public static let empty = GeofenceWidgetProjection(
        fences: [],
        hasVehicleCoordinate: false,
        vehicleLatitude: 0,
        vehicleLongitude: 0
    )

    /// Web `isEmpty = fences.length === 0`.
    public var isEmpty: Bool {
        fences.isEmpty
    }

    /// Web `currentZone = fences.find(f => f.inside && f.enabled)`.
    public var currentZone: GeofenceWidgetFenceStatus? {
        fences.first { $0.isActive }
    }

    /// The vehicle coordinate, or `nil` when no usable fix exists.
    public var vehicleCoordinate: CLLocationCoordinate2D? {
        guard hasVehicleCoordinate else { return nil }
        return CLLocationCoordinate2D(latitude: vehicleLatitude, longitude: vehicleLongitude)
    }

    /// Every coordinate the map should frame: the vehicle plus each fence center.
    public var mapCoordinates: [CLLocationCoordinate2D] {
        var coordinates = fences.map(\.coordinate)
        if let vehicle = vehicleCoordinate { coordinates.append(vehicle) }
        return coordinates
    }
}

// MARK: - Builder

/// Pure projector: cached fences + vehicle fix → `GeofenceWidgetProjection`. The single
/// place the web haversine / membership / radius derivations are reproduced, kept
/// free of SwiftUI so it is fully unit testable.
public enum GeofenceWidgetProjectionBuilder {
    /// Earth radius in meters (web `R = 6_371_000`).
    public static let earthRadiusMeters = 6_371_000.0

    /// Builds the widget projection. `vehicle` absent ⇒ `(0,0)` ⇒ `hasCoords`
    /// false, exactly as the web `state?.latitude ?? 0` fallback.
    public static func build(
        fences: [GeofenceWidgetFenceInput],
        vehicle: GeofenceWidgetVehicleFix?,
        unit: GeofenceWidgetDistanceUnit
    ) -> GeofenceWidgetProjection {
        let vLat = vehicle?.latitude ?? 0
        let vLon = vehicle?.longitude ?? 0
        // Web parity: `hasCoords = vLat !== 0 || vLon !== 0`.
        let hasCoords = vLat != 0 || vLon != 0

        let resolved = fences.map { fence -> GeofenceWidgetFenceStatus in
            let radius = fence.radiusMeters ?? 0
            let distance = hasCoords
                ? haversineMeters(vLat, vLon, fence.latitude, fence.longitude)
                : .infinity
            return GeofenceWidgetFenceStatus(
                id: fence.id,
                name: fence.name ?? "—",
                radiusMeters: radius,
                latitude: fence.latitude,
                longitude: fence.longitude,
                enabled: fence.enabled ?? true,
                inside: distance <= radius,
                distanceMeters: distance,
                radiusText: radiusText(meters: radius, unit: unit)
            )
        }

        return GeofenceWidgetProjection(
            fences: resolved,
            hasVehicleCoordinate: hasCoords,
            vehicleLatitude: vLat,
            vehicleLongitude: vLon
        )
    }

    /// Haversine great-circle distance in meters (web `haversineMeters`).
    public static func haversineMeters(
        _ lat1: Double,
        _ lon1: Double,
        _ lat2: Double,
        _ lon2: Double
    ) -> Double {
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let haversineA = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180)
            * sin(dLon / 2) * sin(dLon / 2)
        return earthRadiusMeters * 2 * atan2(sqrt(haversineA), sqrt(1 - haversineA))
    }

    /// Formats a radius (meters) into the user's unit (web
    /// `fmtNumber(convertDistanceFromSI(m, unit), 1) + ' ' + unit`). Uses a fixed
    /// POSIX locale so the value reads identically everywhere the tests run.
    public static func radiusText(meters: Double, unit: GeofenceWidgetDistanceUnit) -> String {
        let value = unit.convert(meters)
        let number = String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), value)
        return "\(number) \(unit.label)"
    }
}
