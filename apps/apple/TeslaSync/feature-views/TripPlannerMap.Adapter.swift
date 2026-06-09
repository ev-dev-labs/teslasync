//
//  TripPlannerMap.Adapter.swift
//  TeslaSync — P4 feature view · 0178 · TripPlannerMap (Apple)
//
//  The Foundation-only domain core for the trip-planner route map: the coordinate
//  guard, the decoded trip primitives (parity with the web `TripLocation` /
//  `TripLeg` / `TripChargeStop` props consumed by
//  features/driving/components/TripPlannerMap.tsx), the render phase / load status /
//  freshness enums the bound source projects, the surface diagnostics slug, and the
//  bundle-free number formatting the charge-stop callout reproduces. Pure +
//  `Equatable`, so the suite covers every branch without a store or a rendered map.
//

import CoreLocation
import Foundation

// MARK: - Coordinate guard

/// Native port of the implicit web coordinate guard: a marker/vertex is plottable
/// only when both components are actual, finite numbers (Leaflet silently drops a
/// `NaN`/`Infinity` lat-lng, so the native projection mirrors that).
public enum TripPlannerMapNumeric {
    /// Whether a coordinate component is a usable, finite number (not `NaN`/`Infinity`).
    public static func isFinite(_ value: Double) -> Bool {
        !value.isNaN && value.isFinite
    }
}

// MARK: - Domain primitives (ports of the consumed web props)

/// One trip endpoint / waypoint — the native parity of the web `TripLocation`
/// (`lat`, `lng`, `name`). Coordinates are stored as `Double`s so the value type
/// stays `Sendable`/`Equatable`; the `CLLocationCoordinate2D` is computed for MapKit.
public struct TripPlannerLocation: Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double
    public var name: String

    public init(latitude: Double, longitude: Double, name: String = "") {
        self.latitude = latitude
        self.longitude = longitude
        self.name = name
    }

    /// Whether both components are finite (the Leaflet plottable guard).
    public var isPlottable: Bool {
        TripPlannerMapNumeric.isFinite(latitude) && TripPlannerMapNumeric.isFinite(longitude)
    }

    /// The MapKit coordinate for this location.
    public var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

/// One planned-route leg — the native parity of the two fields the web
/// `TripPlannerMap` reads from each `TripLeg` to build the route polyline: the
/// `from` and `to` endpoints. The remaining `TripLeg` analytics fields are consumed
/// by sibling surfaces, not this map.
public struct TripPlannerLeg: Equatable, Sendable {
    public var from: TripPlannerLocation
    public var to: TripPlannerLocation

    public init(from: TripPlannerLocation, to: TripPlannerLocation) {
        self.from = from
        self.to = to
    }
}

/// One planned charge stop — the native parity of the fields the web
/// `TripPlannerMap` popup reads from each `TripChargeStop`: the `name`, the `location`,
/// the entry/exit SOC (`charge_from_soc` / `charge_to_soc`), and the charge duration
/// in seconds (`charge_duration_s`, SI — the display boundary converts to minutes).
public struct TripPlannerChargeStop: Equatable, Sendable {
    public var name: String
    public var location: TripPlannerLocation
    public var chargeFromSoc: Double
    public var chargeToSoc: Double
    /// Charge duration in seconds (SI — web `charge_duration_s`).
    public var chargeDurationS: Double

    public init(
        name: String,
        location: TripPlannerLocation,
        chargeFromSoc: Double,
        chargeToSoc: Double,
        chargeDurationS: Double
    ) {
        self.name = name
        self.location = location
        self.chargeFromSoc = chargeFromSoc
        self.chargeToSoc = chargeToSoc
        self.chargeDurationS = chargeDurationS
    }
}

// MARK: - Render phase (web hasData split, plus the load envelope)

/// What the surface should render. The web source only distinguishes
/// content-vs-empty (`hasData ? <map> : <EmptyState>`, where
/// `hasData = origin != null || destination != null`); the loading / error envelope
/// around it (prompt P4 states) is supplied by the bound source, mirroring how the
/// trip-planner page owns the plan request lifecycle.
public enum TripPlannerMapPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the trip-plan query (web loading / resolved /
/// failure), projected into a phase by `TripPlannerMapProjection.resolvePhase`.
public enum TripPlannerMapLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): `live`, `stale` (older than the freshness
/// window), `offline` (no connectivity — cached route shown). Drives the freshness
/// chip + the guarded stale auto-refresh.
public enum TripPlannerMapConnection: Sendable, Equatable {
    case live
    case stale
    case offline

    /// Whether the route is a fresh live read.
    public var isLive: Bool {
        self == .live
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable, non-identifying diagnostics slug emitted with the `view.opened`
/// event (P1/S11). Shared by the view + its tests so the two never drift; kept
/// Foundation-side so the model + tests build without a rendering host.
public enum TripPlannerMapSurface {
    public static let slug = "TripPlannerMap"
}

// MARK: - Number formatting (pure, bundle-free)

/// Locale-aware formatting for the charge-stop callout — the SOC percents and the
/// charge minutes the web popup renders (`Math.round(soc)` and
/// `Math.round(charge_duration_s / 60)`). Bundle-free + unit-testable.
public enum TripPlannerMapFormat {
    /// Rounds a SOC magnitude to a whole-number string (web `Math.round(soc)`).
    /// Non-finite input renders an em dash (never "nan").
    public static func soc(_ value: Double, locale: Locale = .current) -> String {
        wholeNumber(value, locale: locale)
    }

    /// The charge duration in whole minutes from SI seconds — web
    /// `Math.round(charge_duration_s / 60)`. Non-finite input renders an em dash.
    public static func minutes(fromSeconds seconds: Double, locale: Locale = .current) -> String {
        guard seconds.isFinite else { return "—" }
        return wholeNumber(seconds / 60, locale: locale)
    }

    private static func wholeNumber(_ value: Double, locale: Locale) -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        let rounded = value.rounded()
        return formatter.string(from: NSNumber(value: rounded)) ?? "\(Int(rounded))"
    }
}
