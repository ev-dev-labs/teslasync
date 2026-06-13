//
//  AnimatedMarker.Logic.swift
//  TeslaSync — P4 shared surface · 0184 · AnimatedMarker (Apple)
//
//  The pure decision + transform core for the live-position marker surface — the parts of
//  `components/maps/AnimatedMarker.tsx` that are neither rendering nor map plumbing: the localisation
//  seam (web `t(key, default)`), the geometry value types (a Foundation-only coordinate + span so the
//  pure core needs no MapKit), the usable-coordinate guard (web consumers' `latitude !== 0 &&
//  longitude !== 0` plus a valid-range check), the heading normalisation (the web `heading` prop fed
//  to `transform:rotate(${heading}deg)`), the region-contains test (the verbatim port of the web
//  `map.getBounds().contains(target)` pan trigger), and the marker colour parse (the web `color` prop
//  default `#00b4d8` and the arbitrary hex a replay caller passes). Foundation-only so every branch is
//  asserted without rendering.
//

import Foundation

// MARK: - Localisation seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. A plain closure so the pure core needs no bundle: production passes the
/// P1/S10 facade, tests pass the identity resolver.
public typealias AnimatedMarkerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Geometry value types (Foundation-only; MapKit at the view boundary only)

/// A geographic coordinate — the native value type for the web `position: [lat, lng]` tuple. Kept
/// MapKit-free so the projection + pan logic are pure and unit tested; the map view converts to
/// `CLLocationCoordinate2D` at its boundary.
public struct AnimatedMarkerCoordinate: Sendable, Equatable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

/// A map viewport span — the native value type for a MapKit `MKCoordinateSpan` / the visible bounds
/// the web reads via `map.getBounds()`. Kept MapKit-free so the contains test is pure.
public struct AnimatedMarkerSpan: Sendable, Equatable {
    public var latitudeDelta: Double
    public var longitudeDelta: Double

    public init(latitudeDelta: Double, longitudeDelta: Double) {
        self.latitudeDelta = latitudeDelta
        self.longitudeDelta = longitudeDelta
    }

    /// The default marker zoom span — mirrors the web consumers' street-level zoom (≈ zoom 14).
    public static let defaultZoom = AnimatedMarkerSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
}

/// Resolved sRGB colour components (0…1) for the marker — the parsed form of the web `color` hex
/// prop. Carried MapKit/SwiftUI-free so the parse is pure; the glyph converts to a SwiftUI `Color`.
public struct AnimatedMarkerColorComponents: Sendable, Equatable {
    public var red: Double
    public var green: Double
    public var blue: Double
    public var alpha: Double

    public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }
}

// MARK: - Pure transforms

/// The pure helpers backing the marker geometry + pan trigger. All total + side-effect-free.
public enum AnimatedMarkerGeo {
    /// Whether a coordinate is usable — finite, in valid lat/lng range, and not the null-island
    /// `(0, 0)`. The verbatim port of the web consumers' `hasCoords` guard (`latitude !== 0 &&
    /// longitude !== 0`) widened with the range check `TSGeo.isValid` applies natively.
    public static func isUsable(_ coordinate: AnimatedMarkerCoordinate) -> Bool {
        guard coordinate.latitude.isFinite, coordinate.longitude.isFinite else { return false }
        guard abs(coordinate.latitude) <= 90, abs(coordinate.longitude) <= 180 else { return false }
        return !(coordinate.latitude == 0 && coordinate.longitude == 0)
    }

    /// Normalises a heading to `[0, 360)` degrees, or `nil` when absent / non-finite — the native
    /// mirror of the web `heading != null ? rotate(${heading}deg) : ''` branch (an absent heading
    /// means no rotation / no arrow).
    public static func normalizedHeading(_ degrees: Double?) -> Double? {
        guard let degrees, degrees.isFinite else { return nil }
        let wrapped = degrees.truncatingRemainder(dividingBy: 360)
        return wrapped < 0 ? wrapped + 360 : wrapped
    }

    /// Whether a region (a `center` + `span`) contains a `target` — the verbatim port of the web
    /// `map.getBounds().contains(target)` test that gates the pan. A half-span box test (the web
    /// bounds are likewise axis-aligned); antimeridian wrap is not handled, matching the web.
    public static func region(
        center: AnimatedMarkerCoordinate,
        span: AnimatedMarkerSpan,
        contains target: AnimatedMarkerCoordinate
    ) -> Bool {
        let latHalf = abs(span.latitudeDelta) / 2
        let lonHalf = abs(span.longitudeDelta) / 2
        let dLat = abs(target.latitude - center.latitude)
        let dLon = abs(target.longitude - center.longitude)
        return dLat <= latHalf && dLon <= lonHalf
    }
}

// MARK: - Marker colour (web `color` prop, default `#00b4d8`)

/// Parses the marker colour from the web `color` hex prop (`#RGB` / `#RRGGBB` / `#RRGGBBAA`),
/// falling back to the web default `#00b4d8` for an absent or malformed value so the marker is never
/// invisible. Pure + total.
public enum AnimatedMarkerPalette {
    /// The web `AnimatedMarker` `color = '#00b4d8'` default.
    public static let defaultHex = "#00b4d8"

    /// The parsed components of ``defaultHex`` — the fallback for an absent / malformed hex.
    public static let fallback = AnimatedMarkerColorComponents(
        red: 0,
        green: 180.0 / 255.0,
        blue: 216.0 / 255.0,
        alpha: 1
    )

    /// Parses a hex string to sRGB components, returning ``fallback`` for nil / empty / malformed
    /// input. Accepts an optional leading `#`, 3-digit shorthand, 6-digit, and 8-digit (with alpha).
    public static func parse(_ hex: String?) -> AnimatedMarkerColorComponents {
        guard var raw = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return fallback
        }
        if raw.hasPrefix("#") { raw.removeFirst() }

        let expanded: String
        switch raw.count {
        case 3: expanded = raw.map { "\($0)\($0)" }.joined()
        case 6, 8: expanded = raw
        default: return fallback
        }

        guard let value = UInt64(expanded, radix: 16) else { return fallback }

        if expanded.count == 8 {
            return AnimatedMarkerColorComponents(
                red: Double((value >> 24) & 0xFF) / 255.0,
                green: Double((value >> 16) & 0xFF) / 255.0,
                blue: Double((value >> 8) & 0xFF) / 255.0,
                alpha: Double(value & 0xFF) / 255.0
            )
        }
        return AnimatedMarkerColorComponents(
            red: Double((value >> 16) & 0xFF) / 255.0,
            green: Double((value >> 8) & 0xFF) / 255.0,
            blue: Double(value & 0xFF) / 255.0,
            alpha: 1
        )
    }
}
