//
//  MarkerCluster.Adapter.swift
//  TeslaSync — P4 shared surface · 0186 · MarkerCluster (Apple)
//
//  The testable, dependency-light core for the marker-clustering surface — the SwiftUI/MapKit
//  parity of `components/maps/MarkerCluster.tsx`. Everything here is Foundation-only: the cluster
//  point (the verbatim port of the web `ClusterPoint`), the density palette (the verbatim port of
//  the web `defaultIconCreate` count thresholds + neon colours), the CSS-colour parser (the native
//  reader of the web `point.color` / `defaultColor` strings → RGBA components), and the surface
//  metadata. No store, no SwiftUI, no rendered view, so each piece is unit tested in isolation.
//
//  Every type is prefixed `MarkerCluster…` so the surface stays self-contained and does not collide
//  with another shared surface's internal types in the single app module.
//

import Foundation

// MARK: - Cluster point (web `ClusterPoint`)

/// One map point fed to the cluster group — the native port of the web `ClusterPoint`
/// (`{ id, lat, lng, popupHtml?, color?, ariaLabel? }`). Decoded from the backend with snake_case
/// keys (`popup_html` / `aria_label`) so it round-trips a list endpoint, and `Identifiable` for the
/// SwiftUI/MapKit annotation diff (the web uses `id` only for React reconciliation).
public struct MarkerClusterPoint: Sendable, Equatable, Identifiable, Codable {
    public let id: String
    public let latitude: Double
    public let longitude: Double
    /// Optional rich-text body shown in the marker callout (web `popupHtml`, bound to the popup).
    public let popupHTML: String?
    /// Optional CSS colour override for the marker dot (web `color`, e.g. `#22d3ee`).
    public let colorHex: String?
    /// Optional plain-text accessibility label (web `ariaLabel`, used for the marker's a11y name).
    public let accessibilityLabel: String?

    public init(
        id: String,
        latitude: Double,
        longitude: Double,
        popupHTML: String? = nil,
        colorHex: String? = nil,
        accessibilityLabel: String? = nil
    ) {
        self.id = id
        self.latitude = latitude
        self.longitude = longitude
        self.popupHTML = popupHTML
        self.colorHex = colorHex
        self.accessibilityLabel = accessibilityLabel
    }

    enum CodingKeys: String, CodingKey {
        case id
        case latitude = "lat"
        case longitude = "lng"
        case popupHTML = "popup_html"
        case colorHex = "color"
        case accessibilityLabel = "aria_label"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // `id` is `string | number` on the web — accept either so a numeric id round-trips.
        if let stringID = try? container.decode(String.self, forKey: .id) {
            id = stringID
        } else if let intID = try? container.decode(Int.self, forKey: .id) {
            id = String(intID)
        } else {
            id = try String(container.decode(Double.self, forKey: .id))
        }
        latitude = try container.decode(Double.self, forKey: .latitude)
        longitude = try container.decode(Double.self, forKey: .longitude)
        popupHTML = try container.decodeIfPresent(String.self, forKey: .popupHTML)
        colorHex = try container.decodeIfPresent(String.self, forKey: .colorHex)
        accessibilityLabel = try container.decodeIfPresent(String.self, forKey: .accessibilityLabel)
    }

    /// Whether the coordinate is renderable — the native mirror of the web guard
    /// `typeof lat !== 'number' || Number.isNaN(lat)`: a non-finite latitude/longitude (NaN or
    /// infinity) is dropped before the point reaches the map.
    public var hasValidCoordinate: Bool {
        latitude.isFinite && longitude.isFinite
    }
}

// MARK: - Density palette (web `defaultIconCreate` thresholds)

/// The cluster-density bucket that drives the default bubble colour — the verbatim port of the web
/// `defaultIconCreate` count ladder (`>= 100` rose, `>= 25` amber, `>= 10` purple, else cyan). The
/// raw value is the i18n key suffix; the colour is the web `glow` hex (the solid form the native
/// bubble fills, with the web `0.85` fill opacity applied at the display boundary).
public enum MarkerClusterDensity: String, Sendable, Equatable, CaseIterable, Identifiable {
    case low
    case medium
    case high
    case extreme

    public var id: String {
        rawValue
    }

    /// The inclusive lower bound of the bucket — the web ladder's thresholds (`>= n`).
    public var lowerBound: Int {
        switch self {
        case .low: 0
        case .medium: 10
        case .high: 25
        case .extreme: 100
        }
    }

    /// The bucket for a child count — the verbatim port of the web `defaultIconCreate` cascade.
    public static func forCount(_ count: Int) -> MarkerClusterDensity {
        if count >= 100 { return .extreme }
        if count >= 25 { return .high }
        if count >= 10 { return .medium }
        return .low
    }

    /// The bubble colour for this bucket — the web `glow` hex (cyan / purple / amber / rose).
    public var colorHex: String {
        switch self {
        case .low: "#22d3ee"
        case .medium: "#a855f7"
        case .high: "#fbbf24"
        case .extreme: "#f43f5e"
        }
    }

    /// The fill opacity applied to the bubble colour (web `rgba(…, 0.85)` bubble background).
    public static let fillOpacity = 0.85

    /// The i18n key for the legend / accessibility label of this bucket (native chrome — the web
    /// bubble is anonymous, so these labels are introduced by the native legend).
    public var labelKey: String {
        "markerCluster.density.\(rawValue)"
    }

    /// The English fallback for ``labelKey``.
    public var labelFallback: String {
        switch self {
        case .low: "Under 10"
        case .medium: "10–24"
        case .high: "25–99"
        case .extreme: "100+"
        }
    }
}

// MARK: - CSS colour (web `point.color` / `defaultColor`)

/// Resolved RGBA components in the 0…1 range — the Foundation-only result of parsing a web CSS
/// colour string, kept SwiftUI-free so the parser is unit tested without a rendering context.
public struct MarkerClusterRGBA: Sendable, Equatable {
    public let red: Double
    public let green: Double
    public let blue: Double
    public let alpha: Double

    public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }
}

/// Parses the handful of CSS colour forms the web source emits — `#rgb` / `#rrggbb` / `#rrggbbaa`
/// hex and `rgb()` / `rgba()` functional notation — into ``MarkerClusterRGBA``. Total + pure: an
/// unrecognised string returns `nil` so the caller degrades to the configured default colour (the
/// native mirror of the web `point.color ?? defaultColor`).
public enum MarkerClusterColor {
    public static func parse(_ raw: String?) -> MarkerClusterRGBA? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("#") { return parseHex(trimmed) }
        let lower = trimmed.lowercased()
        if lower.hasPrefix("rgb") { return parseFunctional(lower) }
        return nil
    }

    private static func parseHex(_ value: String) -> MarkerClusterRGBA? {
        var hex = value
        hex.removeFirst() // drop '#'
        // Expand the shorthand `#rgb` to `#rrggbb` (CSS rule).
        if hex.count == 3 {
            hex = hex.map { "\($0)\($0)" }.joined()
        }
        guard hex.count == 6 || hex.count == 8 else { return nil }
        guard let value = UInt64(hex, radix: 16) else { return nil }
        let hasAlpha = hex.count == 8
        let red = Double((value >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
        let green = Double((value >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
        let blue = Double((value >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
        let alpha = hasAlpha ? Double(value & 0xFF) / 255 : 1
        return MarkerClusterRGBA(red: red, green: green, blue: blue, alpha: alpha)
    }

    private static func parseFunctional(_ value: String) -> MarkerClusterRGBA? {
        guard let open = value.firstIndex(of: "("), let close = value.firstIndex(of: ")") else {
            return nil
        }
        let inner = value[value.index(after: open) ..< close]
        let parts = inner
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count == 3 || parts.count == 4 else { return nil }
        guard
            let red = Double(parts[0]),
            let green = Double(parts[1]),
            let blue = Double(parts[2])
        else { return nil }
        let alpha = parts.count == 4 ? (Double(parts[3]) ?? 1) : 1
        return MarkerClusterRGBA(
            red: red / 255,
            green: green / 255,
            blue: blue / 255,
            alpha: alpha
        )
    }
}

// MARK: - Surface metadata (P1/S11 diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum MarkerClusterMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MarkerCluster"

    /// The web marker cap (`points.slice(0, 5000)`) — the hard limit on rendered markers before the
    /// leaflet/MapKit performance cliff. Carried here so the projection and its tests share one
    /// source of truth.
    public static let maxRenderedMarkers = 5000

    /// The web default marker colour (`defaultColor = '#22d3ee'`).
    public static let defaultMarkerColorHex = "#22d3ee"

    /// The web default cluster pixel radius (`maxClusterRadius = 50`).
    public static let defaultClusterRadius: Double = 50

    /// The web default zoom at which clustering stops (`disableClusteringAtZoom = 18`).
    public static let defaultDisableClusteringAtZoom = 18
}
