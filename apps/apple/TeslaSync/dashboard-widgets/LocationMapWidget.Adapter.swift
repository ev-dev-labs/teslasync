//
//  LocationMapWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0060 · LocationMapWidget (Apple)
//
//  The pure cached-DTO → projection seam. Mirrors the web source's coordinate
//  derivations in features/dashboard/widgets/LocationMapWidget.tsx:
//
//    hasCoords = state != null && state.latitude !== 0 && state.longitude !== 0
//    heading   = state?.heading ?? undefined
//    lat/lng   = state?.latitude ?? 0   (rendered with .toFixed(4) in the overlay)
//
//  Everything here is value-typed + side-effect free so the adapter can be unit
//  tested without rendering the view (Acceptance Criteria: "adapter unit test").
//

import CoreLocation
import Foundation

// MARK: - Cached inputs

/// The raw position inputs the source projects from the shared `VehicleState`
/// DTO (`latitude`, `longitude`, `heading`). These arrive in SI/degrees exactly
/// as the API returns them — the map renders raw WGS-84 degrees, so no unit
/// conversion happens here (the Phase-48 SI contract only governs *displayed*
/// physical quantities, not geographic coordinates).
public struct LocationInput: Sendable, Equatable {
    public var latitude: Double
    public var longitude: Double
    public var heading: Double?

    public init(latitude: Double, longitude: Double, heading: Double? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.heading = heading
    }
}

// MARK: - Display projection

/// The validated, display-ready projection the view renders: a coordinate, a
/// `hasCoordinate` flag (the native parity of the web `hasCoords`), the
/// normalized heading, and the pre-formatted overlay strings.
public struct VehicleLocation: Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double
    /// Native parity of web `hasCoords`: both components non-zero *and* the
    /// coordinate is geographically valid.
    public var hasCoordinate: Bool
    /// Heading wrapped into `[0, 360)`, or `nil` when absent / non-finite.
    public var heading: Double?
    /// Heading rounded to a whole degree for the overlay + VoiceOver, or `nil`.
    public var headingDegrees: Int?

    public init(
        latitude: Double,
        longitude: Double,
        hasCoordinate: Bool,
        heading: Double?,
        headingDegrees: Int?
    ) {
        self.latitude = latitude
        self.longitude = longitude
        self.hasCoordinate = hasCoordinate
        self.heading = heading
        self.headingDegrees = headingDegrees
    }

    /// The empty projection (no usable coordinate) — the parity of the web's
    /// `!hasCoords` branch that drives the map's empty state.
    public static let none = VehicleLocation(
        latitude: 0,
        longitude: 0,
        hasCoordinate: false,
        heading: nil,
        headingDegrees: nil
    )

    /// The MapKit coordinate for the projected position.
    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    /// Latitude formatted to 4 decimals (web `lat.toFixed(4)`).
    public var latitudeText: String {
        LocationProjectionBuilder.coordinateText(latitude)
    }

    /// Longitude formatted to 4 decimals (web `lng.toFixed(4)`).
    public var longitudeText: String {
        LocationProjectionBuilder.coordinateText(longitude)
    }

    /// The "lat, lng" overlay string (web `{lat.toFixed(4)}, {lng.toFixed(4)}`).
    public var coordinatesText: String {
        "\(latitudeText), \(longitudeText)"
    }
}

// MARK: - Builder

/// Pure projector: cached `LocationInput` → `VehicleLocation`. The single place
/// the web coordinate/heading derivations are reproduced, kept free of SwiftUI
/// so it is fully unit-testable.
public enum LocationProjectionBuilder {
    /// Projects the cached position into the display model. Returns
    /// `VehicleLocation.none` when the input is absent or the coordinate is not
    /// usable (matching the web `hasCoords` guard).
    public static func build(_ input: LocationInput?) -> VehicleLocation {
        guard let input else { return .none }
        let coordinate = CLLocationCoordinate2D(latitude: input.latitude, longitude: input.longitude)
        // Web parity: `latitude !== 0 && longitude !== 0`, plus a validity guard
        // so out-of-range junk never reaches the camera.
        let usable = input.latitude != 0 && input.longitude != 0 && TSGeo.isValid(coordinate)
        let normalized = usable ? normalizeHeading(input.heading) : nil
        return VehicleLocation(
            latitude: input.latitude,
            longitude: input.longitude,
            hasCoordinate: usable,
            heading: normalized,
            headingDegrees: normalized.map { Int($0.rounded()) % 360 }
        )
    }

    /// Wraps any heading into `[0, 360)`; drops non-finite values (the web
    /// treats a missing/NaN heading as absent via `?? undefined`).
    public static func normalizeHeading(_ heading: Double?) -> Double? {
        guard let heading, heading.isFinite else { return nil }
        let wrapped = heading.truncatingRemainder(dividingBy: 360)
        return wrapped < 0 ? wrapped + 360 : wrapped
    }

    /// Formats a coordinate component to 4 decimals (web `Number.toFixed(4)`),
    /// using a fixed locale so the map overlay reads identically everywhere.
    public static func coordinateText(_ value: Double) -> String {
        String(format: "%.4f", locale: Locale(identifier: "en_US_POSIX"), value)
    }
}
