//
//  TripReplayMap.Adapter.swift
//  TeslaSync — P4 feature view · 0274 · TripReplayMap (Apple)
//
//  The Foundation-only domain core for the trip-replay map: the coordinate validity +
//  great-circle geometry ported VERBATIM from the web `lib/geo.ts` and the
//  `TripReplayMap.tsx` component helpers (haversine, the (0,0)/bounds validity guard,
//  the 10 m meaningful-route anchor scan, first-valid-index, the O(n) nearest-sample
//  resolver, and the great-circle heading), the speed band that reproduces the web
//  `speedColor` thresholds, the decoded position / coordinate value types, and the
//  surface diagnostics slug. Pure + `Equatable`, so the suite covers every branch
//  without a store or a rendered map. The arithmetic is reproduced — never "fixed".
//

import CoreLocation
import Foundation

// MARK: - Geometry (port of web `lib/geo.ts` + the component helpers)

/// Native port of the web geo helpers. Every constant + expression matches the web
/// source so the native route geometry is byte-for-byte the same as Leaflet draws.
public enum TripReplayGeo {
    /// Earth radius in meters (web `R = 6_371_000`).
    public static let earthRadiusMeters = 6_371_000.0
    /// Minimum separation (meters) for a route to be "meaningfully spatial"
    /// (web `MIN_MEANINGFUL_ROUTE_METERS = 10`).
    public static let minMeaningfulRouteMeters = 10.0
    /// Web no-fix center fallback (`[47.6, -122.3]`, Seattle) — used when there is no
    /// start fix and no valid anchor.
    public static let fallbackCenterLatitude = 47.6
    public static let fallbackCenterLongitude = -122.3

    /// Web `isValidLatLng`: finite, not the `(0,0)` "GPS not yet fixed" sentinel, and
    /// within global bounds.
    public static func isValidLatLng(_ latitude: Double, _ longitude: Double) -> Bool {
        guard latitude.isFinite, longitude.isFinite else { return false }
        if latitude == 0, longitude == 0 { return false }
        if latitude < -90 || latitude > 90 { return false }
        if longitude < -180 || longitude > 180 { return false }
        return true
    }

    /// Web `haversineDistance` — great-circle distance in meters.
    public static func haversineMeters(
        _ lat1: Double,
        _ lon1: Double,
        _ lat2: Double,
        _ lon2: Double
    ) -> Double {
        let dLat = radians(lat2 - lat1)
        let dLon = radians(lon2 - lon1)
        let aTerm = pow(sin(dLat / 2), 2)
            + cos(radians(lat1)) * cos(radians(lat2)) * pow(sin(dLon / 2), 2)
        return earthRadiusMeters * 2 * atan2(sqrt(aTerm), sqrt(1 - aTerm))
    }

    /// Web `firstValidIndex` — index of the first valid coordinate, or `-1` if none.
    public static func firstValidIndex(_ positions: [TripReplayPosition]) -> Int {
        for (index, position) in positions.enumerated() where position.isValid {
            return index
        }
        return -1
    }

    /// Web `hasMeaningfulRoute` — at least two valid coordinates ≥ 10 m apart. Anchors
    /// on the first valid fix and short-circuits on the first sample beyond the
    /// threshold.
    public static func hasMeaningfulRoute(_ positions: [TripReplayPosition]) -> Bool {
        let anchorIndex = firstValidIndex(positions)
        guard anchorIndex >= 0 else { return false }
        let anchor = positions[anchorIndex]
        var index = anchorIndex + 1
        while index < positions.count {
            let candidate = positions[index]
            index += 1
            guard isValidLatLng(candidate.latitude, candidate.longitude) else { continue }
            let distance = haversineMeters(
                anchor.latitude,
                anchor.longitude,
                candidate.latitude,
                candidate.longitude
            )
            if distance >= minMeaningfulRouteMeters { return true }
        }
        return false
    }

    /// Web `nearestSampleIndex` — the O(n) min-haversine index for a tapped lat/lng.
    /// An empty input yields `0` (web early return).
    public static func nearestSampleIndex(
        _ positions: [TripReplayPosition],
        latitude: Double,
        longitude: Double
    ) -> Int {
        guard !positions.isEmpty else { return 0 }
        var bestIndex = 0
        var bestDistance = Double.infinity
        for (index, position) in positions.enumerated() {
            let distance = haversineMeters(position.latitude, position.longitude, latitude, longitude)
            if distance < bestDistance {
                bestDistance = distance
                bestIndex = index
            }
        }
        return bestIndex
    }

    /// Web `computeHeading` — the initial great-circle bearing from `p1` to `p2`,
    /// normalised to `[0, 360)`.
    public static func heading(from start: TripReplayPosition, to end: TripReplayPosition) -> Double {
        let dLon = radians(end.longitude - start.longitude)
        let y = sin(dLon) * cos(radians(end.latitude))
        let x = cos(radians(start.latitude)) * sin(radians(end.latitude))
            - sin(radians(start.latitude)) * cos(radians(end.latitude)) * cos(dLon)
        let bearing = degrees(atan2(y, x)) + 360
        return bearing.truncatingRemainder(dividingBy: 360)
    }

    private static func radians(_ degrees: Double) -> Double {
        degrees * .pi / 180
    }

    private static func degrees(_ radians: Double) -> Double {
        radians * 180 / .pi
    }
}

// MARK: - Domain primitives (ports of the consumed web props)

/// One recorded GPS fix for the drive — the native parity of the web `DrivePosition`
/// fields the replay map reads (`latitude`, `longitude`, `speed`). Coordinates are
/// stored as `Double`s so the value type stays `Sendable`/`Equatable`; the
/// `CLLocationCoordinate2D` is computed for MapKit.
public struct TripReplayPosition: Sendable, Equatable {
    public var latitude: Double
    public var longitude: Double
    /// The raw web `DrivePosition.speed` value (nullable). Consumed only to band the
    /// trail color via the web `speedColor(curr.speed ?? 0)` expression — never unit
    /// converted (parity, not a "fix").
    public var speed: Double?

    public init(latitude: Double, longitude: Double, speed: Double? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.speed = speed
    }

    /// Whether this fix is plottable (web `isValidLatLng`).
    public var isValid: Bool {
        TripReplayGeo.isValidLatLng(latitude, longitude)
    }

    /// The MapKit coordinate for this fix.
    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

/// A lightweight `(lat, lng)` pair (web `LatLngExpression` / `[lat, lng]`) — kept as a
/// value type so the projection stays `Sendable`/`Equatable` and unit-tests without
/// MapKit.
public struct TripReplayCoordinate: Sendable, Equatable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }

    /// The MapKit coordinate for this vertex.
    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

// MARK: - Speed bands (web `speedColor` thresholds)

/// The four speed bands the trail is colored by — a verbatim port of the web
/// `speedColor(kmh)` ladder (`<30 → #10b981 · <60 → #22d3ee · <100 → #f59e0b · else
/// #ef4444`). The argument is the raw web `DrivePosition.speed ?? 0` value, compared
/// without conversion; the view maps each band to a semantic theme token (not raw hex).
public enum TripReplaySpeedBand: String, Sendable, Equatable, CaseIterable {
    /// Below 30 — web `#10b981` (emerald).
    case slow
    /// `30 ..< 60` — web `#22d3ee` (cyan).
    case moderate
    /// `60 ..< 100` — web `#f59e0b` (amber).
    case fast
    /// At or above 100 — web `#ef4444` (red).
    case veryFast

    /// Bands a raw web speed value exactly as the web `speedColor` does.
    public static func forSpeed(_ speed: Double) -> TripReplaySpeedBand {
        if speed < 30 { return .slow }
        if speed < 60 { return .moderate }
        if speed < 100 { return .fast }
        return .veryFast
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable, non-identifying diagnostics slug emitted with the `view.opened` event
/// (P1/S11). Shared by the view + its tests so the two never drift; kept Foundation-
/// side so the model + tests build without a rendering host.
public enum TripReplayMapSurface {
    public static let slug = "TripReplayMap"
}
