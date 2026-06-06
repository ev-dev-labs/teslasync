import CoreLocation
import MapKit
import SwiftUI

/// Pure geospatial helpers (validation, bounds fitting, interpolation) — unit tested.
public enum TSGeo {
    /// A coordinate is usable if it's valid and not the null-island (0,0).
    public static func isValid(_ coordinate: CLLocationCoordinate2D) -> Bool {
        guard CLLocationCoordinate2DIsValid(coordinate) else { return false }
        if abs(coordinate.latitude) > 90 || abs(coordinate.longitude) > 180 { return false }
        return !(coordinate.latitude == 0 && coordinate.longitude == 0)
    }

    /// The padded region that fits every valid coordinate, or `nil` if none.
    public static func boundingRegion(
        for coordinates: [CLLocationCoordinate2D],
        padding: Double = 1.3
    ) -> MKCoordinateRegion? {
        let valid = coordinates.filter(isValid)
        guard let first = valid.first else { return nil }
        var minLat = first.latitude
        var maxLat = first.latitude
        var minLon = first.longitude
        var maxLon = first.longitude
        for coordinate in valid {
            minLat = min(minLat, coordinate.latitude)
            maxLat = max(maxLat, coordinate.latitude)
            minLon = min(minLon, coordinate.longitude)
            maxLon = max(maxLon, coordinate.longitude)
        }
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
        let span = MKCoordinateSpan(
            latitudeDelta: max((maxLat - minLat) * padding, 0.005),
            longitudeDelta: max((maxLon - minLon) * padding, 0.005)
        )
        return MKCoordinateRegion(center: center, span: span)
    }

    /// Linear interpolation between two coordinates at `t` in 0...1.
    public static func interpolate(
        _ start: CLLocationCoordinate2D,
        _ end: CLLocationCoordinate2D,
        t: Double
    ) -> CLLocationCoordinate2D {
        let clamped = min(max(t, 0), 1)
        return CLLocationCoordinate2D(
            latitude: start.latitude + (end.latitude - start.latitude) * clamped,
            longitude: start.longitude + (end.longitude - start.longitude) * clamped
        )
    }

    /// Position along a polyline at `progress` in 0...1 (for route playback).
    public static func routePosition(
        _ route: [CLLocationCoordinate2D],
        progress: Double
    ) -> CLLocationCoordinate2D? {
        guard route.count >= 2 else { return route.first }
        let clamped = min(max(progress, 0), 1)
        let scaled = clamped * Double(route.count - 1)
        let index = Int(scaled)
        if index >= route.count - 1 { return route.last }
        return interpolate(route[index], route[index + 1], t: scaled - Double(index))
    }
}

/// A typed map marker.
public struct TSMapAnnotation: Identifiable {
    public let id: String
    public let coordinate: CLLocationCoordinate2D
    public let title: LocalizedStringKey
    public let tone: TSTone
    public let systemImage: String

    public init(
        id: String,
        coordinate: CLLocationCoordinate2D,
        title: LocalizedStringKey,
        tone: TSTone = .accent,
        systemImage: String = "mappin.circle.fill"
    ) {
        self.id = id
        self.coordinate = coordinate
        self.title = title
        self.tone = tone
        self.systemImage = systemImage
    }
}

/// A circular geofence overlay.
public struct TSGeofence: Identifiable {
    public let id: String
    public let center: CLLocationCoordinate2D
    public let radiusMeters: Double
    public let label: LocalizedStringKey
    public let colorIndex: Int

    public init(
        id: String,
        center: CLLocationCoordinate2D,
        radiusMeters: Double,
        label: LocalizedStringKey,
        colorIndex: Int = 2
    ) {
        self.id = id
        self.center = center
        self.radiusMeters = radiusMeters
        self.label = label
        self.colorIndex = colorIndex
    }
}
