//
//  AnimatedMarker.Adapter.swift
//  TeslaSync — P4 shared surface · 0184 · AnimatedMarker (Apple)
//
//  The testable, dependency-light marker-fix core for the live-position marker surface — the SwiftUI
//  parity of `components/maps/AnimatedMarker.tsx`. Everything here is Foundation-only: the backend
//  wire row (the snake_case position payload the web consumers feed the marker from a vehicle-state /
//  replay-point query), the resolved marker fix (the native shape of the marker's `{ position,
//  heading, color }` props), the `fix` adapter (the verbatim port of the consumers' `hasCoords` guard
//  + the web `color` default), and the surface diagnostics slug. No store, no SwiftUI, no rendered
//  view, so each piece is unit tested in isolation.
//
//  Every type is prefixed `AnimatedMarker…` so the surface stays self-contained and does not collide
//  with another shared surface's internal types in the single app module.
//

import Foundation

// MARK: - Marker fix wire row (web consumer position payload)

/// The backend wire shape that feeds the marker — the native port of the position slice the web
/// consumers read (`state.latitude` / `state.longitude` / `state.heading` for the live widget, the
/// replay point's `lat` / `lng` / `heading` / `color` for route playback). snake_case JSON; decoded
/// by the source seam and adapted to ``AnimatedMarkerFix`` by ``AnimatedMarkerAdapter`` (no SwiftUI
/// in the path). `heading` + `color` are optional, exactly as the web props are.
public struct AnimatedMarkerFixRow: Sendable, Equatable, Codable {
    public let latitude: Double
    public let longitude: Double
    public let heading: Double?
    public let color: String?

    enum CodingKeys: String, CodingKey {
        case latitude
        case longitude
        case heading
        case color
    }

    public init(latitude: Double, longitude: Double, heading: Double? = nil, color: String? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.heading = heading
        self.color = color
    }
}

// MARK: - Resolved marker fix (web `{ position, heading, color }` props)

/// One resolved marker fix — the native port of the web `AnimatedMarkerProps` after defaulting: a
/// usable coordinate, an optional normalised heading (the web `heading` prop), and the parsed marker
/// colour (the web `color` prop, defaulted to `#00b4d8`). Produced by ``AnimatedMarkerAdapter`` and
/// rendered by the glyph; never carries an unusable coordinate (the adapter returns `nil` for those).
public struct AnimatedMarkerFix: Sendable, Equatable {
    public let coordinate: AnimatedMarkerCoordinate
    public let heading: Double?
    public let color: AnimatedMarkerColorComponents

    public init(
        coordinate: AnimatedMarkerCoordinate,
        heading: Double?,
        color: AnimatedMarkerColorComponents
    ) {
        self.coordinate = coordinate
        self.heading = heading
        self.color = color
    }

    /// Whether a heading arrow should render (web `heading != null`).
    public var hasHeading: Bool {
        heading != nil
    }
}

// MARK: - Adapter (web `hasCoords` guard + `color` default)

/// Resolves a wire row into a renderable marker fix — the verbatim port of the web consumers' marker
/// gating:
///
/// ```ts
/// const hasCoords = state != null && state.latitude !== 0 && state.longitude !== 0
/// // <AnimatedMarker position={[lat, lng]} heading={heading} color={color ?? '#00b4d8'} />
/// ```
///
/// Pure + total: a nil row, or a row whose coordinate is the null-island / out-of-range, resolves to
/// `nil` (the surface renders its empty state); the heading is normalised to `[0, 360)`; the colour
/// defaults to the web `#00b4d8` when the row carries none or a malformed value.
public enum AnimatedMarkerAdapter {
    /// Adapts a wire row to a marker fix, or `nil` when the row is absent / not renderable.
    /// `defaultColorHex` is the per-instance default (the web `color` prop default).
    public static func fix(
        from row: AnimatedMarkerFixRow?,
        defaultColorHex: String = AnimatedMarkerPalette.defaultHex
    ) -> AnimatedMarkerFix? {
        guard let row else { return nil }
        let coordinate = AnimatedMarkerCoordinate(latitude: row.latitude, longitude: row.longitude)
        guard AnimatedMarkerGeo.isUsable(coordinate) else { return nil }
        return AnimatedMarkerFix(
            coordinate: coordinate,
            heading: AnimatedMarkerGeo.normalizedHeading(row.heading),
            color: AnimatedMarkerPalette.parse(row.color ?? defaultColorHex)
        )
    }
}

// MARK: - Surface metadata (P1/S11 diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum AnimatedMarkerMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AnimatedMarker"
}
