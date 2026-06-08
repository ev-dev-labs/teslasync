//
//  OdometerCounterWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0070 · OdometerCounterWidget (Apple)
//
//  The pure, host-testable adapter: cached DTO inputs → a render-ready projection.
//  All distance conversion (an SI port of lib/unitConversion.convertDistanceFromSI)
//  and number formatting (web fmtNumber / AnimatedNumber decimals=0) live here so
//  the SwiftUI layer is a pure function of `OdometerProjection`. No SwiftUI, no
//  networking, no `Shared` import — it compiles + runs without the KMP runtime.
//

import Foundation

// MARK: - Grid + seam value types (Foundation-only so the adapter is host-runnable)


/// The cached DTO inputs the seam pushes each snapshot. The production source reads
/// `state.odometer` (vehicle state) and `DrivingStats.totalDistanceKm` — both SI
/// meters after the Phase-42 cutover, despite the legacy `Km` field name — plus the
/// user's distance-unit label from settings. The view never sees raw transport.
public struct OdometerInput: Sendable, Equatable {
    /// Odometer reading in SI meters (web `state.odometer`).
    public var odometerMeters: Double?
    /// Lifetime distance driven in SI meters (web `stats.totalDistanceKm`, SI).
    public var totalDistanceMeters: Double?
    /// The user's distance display unit label (`"km"` / `"mi"` / `"ft"`).
    public var distanceUnit: String

    public init(
        odometerMeters: Double? = nil,
        totalDistanceMeters: Double? = nil,
        distanceUnit: String = "km"
    ) {
        self.odometerMeters = odometerMeters
        self.totalDistanceMeters = totalDistanceMeters
        self.distanceUnit = distanceUnit
    }
}

// MARK: - Responsive layout (web `isCompact` / `isWide`)

/// The responsive layout the surface renders for a grid footprint, mirroring the
/// web `isCompact` (1×1) / `isWide` (cols ≥ 2) branches in
/// `OdometerCounterWidget.tsx`. Pure + `Equatable` so each branch is unit-tested.
public enum OdometerLayout: Equatable, Sendable {
    /// 1×1 — odometer value over its unit label, centered.
    case compact
    /// Default — "Total Odometer" headline; `wide` adds the breakdown tiles.
    case expanded(wide: Bool)

    /// Resolves the layout from a grid size, matching the web computation
    /// (`isCompact = cols == 1 && rows == 1`, `isWide = cols >= 2`).
    public static func resolve(for size: DashboardWidgetSize) -> OdometerLayout {
        if size.cols == 1, size.rows == 1 {
            return .compact
        }
        return .expanded(wide: size.cols >= 2)
    }
}

// MARK: - Distance conversion (SI port of convertDistanceFromSI)

/// Pure SI-meters → display-unit conversion, a 1:1 port of the web
/// `convertDistanceFromSI` (lib/unitConversion.ts). The shared `Units` facade runs
/// the same math in the KMP core, but it imports the `Shared` xcframework; this
/// surface keeps a local copy so the projection stays host-compilable and
/// unit-testable without the Kotlin/Native runtime.
public enum OdometerDistance {
    /// 1 mile = 1609.344 m exactly (international yard, NIST).
    static let metersPerMile = 1609.344
    /// 1 km = 1000 m exactly.
    static let metersPerKilometer = 1000.0
    /// 1 ft = 0.3048 m exactly (international foot, NIST).
    static let metersPerFoot = 0.3048

    /// Converts SI meters to the display unit label (`"km"` / `"mi"` / `"ft"`).
    /// Unknown labels fall back to kilometers (the metric SI default), so a
    /// malformed preference never crashes the render.
    public static func fromSI(_ meters: Double, to unit: String) -> Double {
        switch unit {
        case "mi": meters / metersPerMile
        case "ft": meters / metersPerFoot
        default: meters / metersPerKilometer
        }
    }
}

// MARK: - Projection (cached DTO → render-ready strings)

/// The render-ready projection the view switches over. Holds the converted numeric
/// values plus the helpers that format them with locale grouping at 0 decimals
/// (web `AnimatedNumber decimals={0}` / `fmtNumber(value, 0)`).
public struct OdometerProjection: Equatable, Sendable {
    /// The fallback shown for a missing breakdown value (web `'—'`).
    public static let emptyDisplay = "—"

    /// An empty projection (no odometer, metric default) — the initial state.
    public static let empty = OdometerProjection(
        odometer: nil,
        totalDriven: nil,
        unit: "km",
        localeIdentifier: Locale.current.identifier
    )

    /// Converted odometer reading in the display unit, or `nil` when unavailable
    /// (drives the web `EmptyState` branch).
    public let odometer: Double?
    /// Converted "total driven" distance, or `nil` → renders the em-dash fallback.
    public let totalDriven: Double?
    /// The display unit label (`"km"` / `"mi"` / `"ft"`).
    public let unit: String
    /// Locale identifier used for number grouping/decimal separators.
    public let localeIdentifier: String

    public init(odometer: Double?, totalDriven: Double?, unit: String, localeIdentifier: String) {
        self.odometer = odometer
        self.totalDriven = totalDriven
        self.unit = unit
        self.localeIdentifier = localeIdentifier
    }

    /// Whether an odometer reading is present (web `convertedOdometer != null`).
    public var hasOdometer: Bool {
        odometer != nil
    }

    /// The odometer reading formatted with grouping separators at 0 decimals
    /// (web `AnimatedNumber value={odometer} decimals={0}`). `nil` renders `0`.
    public var odometerText: String {
        Self.formatInteger(odometer ?? 0, localeIdentifier: localeIdentifier)
    }

    /// The odometer reading with its unit suffix (web expanded `suffix={` ${unit}`}`).
    public var odometerWithUnit: String {
        "\(odometerText) \(unit)"
    }

    /// The "total driven" value with its unit, or the em-dash fallback
    /// (web `totalDriven != null ? `${fmtNumber(totalDriven, 0)} ${unit}` : '—'`).
    public var totalDrivenText: String {
        guard let totalDriven else {
            return Self.emptyDisplay
        }
        return "\(Self.formatInteger(totalDriven, localeIdentifier: localeIdentifier)) \(unit)"
    }

    /// Locale-aware integer formatting with grouping separators (web `fmtNumber`).
    static func formatInteger(_ value: Double, localeIdentifier: String) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.locale = Locale(identifier: localeIdentifier)
        return formatter.string(from: NSNumber(value: value)) ?? String(Int(value.rounded()))
    }
}

// MARK: - Builder (the cached → projection adapter)

/// Builds an `OdometerProjection` from the cached seam inputs, applying the SI
/// distance conversion at the boundary (web `toDistanceDisplay`). This is THE
/// adapter the unit + executed-harness tests exercise.
public enum OdometerProjectionBuilder {
    public static func build(
        from input: OdometerInput,
        localeIdentifier: String = Locale.current.identifier
    ) -> OdometerProjection {
        let odometer = input.odometerMeters.map { OdometerDistance.fromSI($0, to: input.distanceUnit) }
        let totalDriven = input.totalDistanceMeters.map { OdometerDistance.fromSI($0, to: input.distanceUnit) }
        return OdometerProjection(
            odometer: odometer,
            totalDriven: totalDriven,
            unit: input.distanceUnit,
            localeIdentifier: localeIdentifier
        )
    }
}
