//
//  RouteDisplay.Model.swift
//  TeslaSync — P4 shared surface · 0101 · RouteDisplay (Apple)
//
//  The Foundation-only core of the route line — the native parity of
//  `components/data-display/RouteDisplay.tsx`. The web component is a generic, purely props-driven
//  "From → To" / "↻ round trip" / single-location / "No location data" line used by every
//  history-style row (Drives, Charging, Trips). Its only data source is the `start` / `end`
//  endpoints it is handed, and its only hook is `useTranslation` (the P1/S10 localisation facade) —
//  there is no network and no data-fetch state holder to bind. This layer mirrors that exactly: the
//  `RouteDisplayEndpoint` domain type, the pure label / haversine / round-trip projection (the
//  verbatim port of the web `endpointLabel`, `haversineMeters`, and the round-trip decision), the
//  i18n facade, the diagnostics slug + telemetry seam (P1/S11), and the `@MainActor` model that owns
//  the once-only `view.opened` emission. View-free so every branch is unit tested without a view.
//
//  Branches reproduced from the web source (every one is exercised — the source is a stateless,
//  props-driven display, so it has no loading / empty / error / stale / offline data states):
//    • no location — neither endpoint resolves a label → the dimmed "No location data" line
//                     (web `!startLabel && !endLabel`).
//    • single      — only `start` is supplied (a charger, etc.) → just that line, no round-trip
//                     phrasing (web `isExplicitSingle`).
//    • round trip  — both endpoints resolve to the same place (matching address text, or
//                     coordinates within `roundTripThresholdM` metres) → "{start} ↻ round trip".
//    • from → to   — distinct endpoints → "{start} → {end}", each side falling back to
//                     "No location data" when only that side is missing.
//

import Foundation
import Observation
import OSLog

// MARK: - Route endpoint (web `RouteEndpoint`)

/// A single end of a route — the native port of the web `RouteEndpoint`. A resolved street address
/// is preferred; latitude / longitude are the coordinate fallback. All fields are optional so a
/// row can hand through whatever it has, exactly like the web prop shape.
public struct RouteDisplayEndpoint: Sendable, Equatable {
    /// Resolved street address or place name (preferred).
    public var address: String?
    /// Latitude in decimal degrees, used as fallback.
    public var lat: Double?
    /// Longitude in decimal degrees, used as fallback.
    public var lon: Double?

    public init(address: String? = nil, lat: Double? = nil, lon: Double? = nil) {
        self.address = address
        self.lat = lat
        self.lon = lon
    }
}

// MARK: - Rendered content (the web render branches)

/// The fully-resolved line the view renders — the projection of the web component's four
/// conditional render branches into a single value so the view stays a pure function of it and
/// every branch is unit tested in isolation.
public enum RouteDisplayContent: Sendable, Equatable {
    /// Neither endpoint resolved a label — the dimmed fallback line (web `noLocation`).
    case noLocation(text: String)
    /// Only `start` was supplied — a single location, no round-trip phrasing.
    case single(start: String)
    /// Both endpoints resolve to the same place — "{start} ↻ {phrase}".
    case roundTrip(start: String, phrase: String)
    /// Distinct endpoints — "{start} → {end}".
    case fromTo(start: String, end: String)
}

// MARK: - Pure projection logic (verbatim port of the web helpers)

/// The view-free decision logic ported from the web component: the per-endpoint label, the
/// haversine distance, and the round-trip projection. Each function is a direct translation of a
/// web export so the view is a pure function of these and every branch is testable on its own.
public enum RouteDisplayLogic {
    /// Threshold (in metres) below which `start ≈ end` is treated as a round trip when only
    /// coordinates are available — the web `roundTripThresholdM` default of 100 m.
    public static let defaultRoundTripThresholdM: Double = 100

    /// Mean Earth radius in metres — the web haversine `R`.
    static let earthRadiusM: Double = 6_371_000

    /// Pretty-prints a single endpoint — the verbatim port of the web `endpointLabel`. Prefers a
    /// trimmed, non-empty address; falls back to a `📍 lat, lon` coordinate string (two decimals,
    /// matching `Number.toFixed(2)`); returns `nil` when neither is available so the caller can
    /// render a single fallback line.
    public static func endpointLabel(_ endpoint: RouteDisplayEndpoint) -> String? {
        let trimmedAddress = endpoint.address?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmedAddress, !trimmedAddress.isEmpty {
            return trimmedAddress
        }
        if let lat = endpoint.lat, let lon = endpoint.lon {
            return "📍 \(formatCoordinate(lat)), \(formatCoordinate(lon))"
        }
        return nil
    }

    /// Formats one coordinate component to two decimals — the parity of the web `Number.toFixed(2)`.
    /// Uses the POSIX decimal point regardless of user locale, matching the web string.
    static func formatCoordinate(_ value: Double) -> String {
        String(format: "%.2f", value)
    }

    /// Haversine distance between two lat/lon pairs, in metres — the verbatim port of the web
    /// `haversineMeters` (including the `min(1, …)` clamp on the arcsine argument).
    public static func haversineMeters(
        _ aLat: Double,
        _ aLon: Double,
        _ bLat: Double,
        _ bLon: Double
    ) -> Double {
        let toRad = { (degrees: Double) in degrees * Double.pi / 180 }
        let dLat = toRad(bLat - aLat)
        let dLon = toRad(bLon - aLon)
        let lat1 = toRad(aLat)
        let lat2 = toRad(bLat)
        let sinDLat = sin(dLat / 2)
        let sinDLon = sin(dLon / 2)
        let inner = sinDLat * sinDLat + cos(lat1) * cos(lat2) * sinDLon * sinDLon
        return 2 * earthRadiusM * asin(min(1, inner.squareRoot()))
    }

    /// Whether an endpoint carries usable coordinates — the web `hasCoords` type guard.
    static func hasCoordinates(_ endpoint: RouteDisplayEndpoint?) -> Bool {
        guard let endpoint else { return false }
        return endpoint.lat != nil && endpoint.lon != nil
    }

    /// Resolves the line to render — the verbatim port of the web component body. The decision order
    /// is: (1) both labels missing → no location; (2) round trip — only `start` supplied, OR the
    /// two labels match, OR the coordinates are within `roundTripThresholdM` metres; (3) otherwise
    /// "from → to" with a per-side "No location data" fallback.
    public static func project(
        start: RouteDisplayEndpoint,
        end: RouteDisplayEndpoint?,
        roundTripThresholdM: Double = defaultRoundTripThresholdM,
        noLocation: String,
        roundTripPhrase: String
    ) -> RouteDisplayContent {
        let startLabel = endpointLabel(start)
        let endLabel = end.flatMap { endpointLabel($0) }

        if startLabel == nil, endLabel == nil {
            return .noLocation(text: noLocation)
        }

        let addressesMatch = startLabel != nil && endLabel != nil && startLabel == endLabel
        let coordsClose = coordinatesWithinThreshold(start: start, end: end, thresholdM: roundTripThresholdM)
        let isExplicitSingle = end == nil
        let isRoundTrip = startLabel != nil && (isExplicitSingle || addressesMatch || coordsClose)

        if isRoundTrip, let startLabel {
            return isExplicitSingle
                ? .single(start: startLabel)
                : .roundTrip(start: startLabel, phrase: roundTripPhrase)
        }
        return .fromTo(start: startLabel ?? noLocation, end: endLabel ?? noLocation)
    }

    /// Whether both endpoints have coordinates within `thresholdM` metres — the web `coordsClose`.
    static func coordinatesWithinThreshold(
        start: RouteDisplayEndpoint,
        end: RouteDisplayEndpoint?,
        thresholdM: Double
    ) -> Bool {
        guard hasCoordinates(start), let end, hasCoordinates(end),
              let aLat = start.lat, let aLon = start.lon,
              let bLat = end.lat, let bLon = end.lon
        else {
            return false
        }
        return haversineMeters(aLat, aLon, bLat, bLon) < thresholdM
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`). A static,
/// non-identifying constant matching the web component name.
public enum RouteDisplayMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "RouteDisplay"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol RouteDisplayTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogRouteDisplayTelemetry: RouteDisplayTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

/// The testable emission seam: emits `view.opened` exactly once, the first time the surface appears.
/// Returns the new "already emitted" flag so the caller can thread it across appearances without
/// double counting.
public enum RouteDisplayDiagnostics {
    public static func openIfNeeded(
        alreadyEmitted: Bool,
        telemetry: any RouteDisplayTelemetry
    ) -> Bool {
        guard !alreadyEmitted else { return true }
        telemetry.viewOpened(surface: RouteDisplayMeta.surfaceSlug)
        return true
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "RouteDisplay" table (the exact set from the web source
/// `components/data-display/RouteDisplay.tsx`), folded into the app `Localizable.xcstrings` catalog
/// at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum RouteDisplayStrings {
    public static let table = "RouteDisplay"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The dimmed fallback line — the web `t('route.noLocationData', 'No location data')`.
    public static var noLocationData: String {
        string("route.noLocationData", "No location data")
    }

    /// The round-trip suffix — the web `t('route.roundTrip', 'round trip')`.
    public static var roundTrip: String {
        string("route.roundTrip", "round trip")
    }
}

// MARK: - Model (@MainActor owner of the once-only view.opened emission)

/// The `@MainActor` model the view binds through. The web component is purely props-driven with no
/// callbacks, so this model's sole responsibility is the once-only `view.opened` emission (P1/S11) —
/// keeping the diagnostics side effect off the view and unit-testable.
@MainActor
@Observable
public final class RouteDisplayModel {
    @ObservationIgnored private let telemetry: any RouteDisplayTelemetry
    @ObservationIgnored private var didEmitOpen = false

    public init(telemetry: any RouteDisplayTelemetry = OSLogRouteDisplayTelemetry()) {
        self.telemetry = telemetry
    }

    /// Emits `view.opened` exactly once, the first time the surface appears (idempotent).
    public func markAppeared() {
        didEmitOpen = RouteDisplayDiagnostics.openIfNeeded(
            alreadyEmitted: didEmitOpen,
            telemetry: telemetry
        )
    }
}
