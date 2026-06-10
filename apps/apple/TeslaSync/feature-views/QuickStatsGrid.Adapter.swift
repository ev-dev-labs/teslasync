//
//  QuickStatsGrid.Adapter.swift
//  TeslaSync — P4 feature view · 0295 · QuickStatsGrid (Apple)
//
//  The testable projection core for the vehicle-detail quick-stats grid — the SwiftUI
//  parity of features/vehicles/components/vehicle-detail/QuickStatsGrid.tsx plus the web
//  helpers it is fed by: `formatDistance` / `formatSpeed` / `formatTemperature`
//  (lib/unitConversion.ts, via `useUnits`) and `fmtNumber` (lib/numberFormat.ts).
//  Everything here is pure + dependency-free (no store, no bundle, no rendered view, no
//  KMP `Shared` runtime) so the SI conversions, the locale number formatting, and the
//  battery percent / JS-number wording are all unit tested in isolation — and the
//  parity-pin tests assert the canonical SI factors so any drift from the shared
//  converters is caught mechanically (the same discipline as DrivingTab). The tile
//  projection that consumes these helpers lives in QuickStatsGrid.Projection.swift.
//
//  Parity note: the web grid reads SI values straight off the vehicle state
//  (`rated_range` / `odometer` in metres, `speed` in m/s, `inside_temp` / `outside_temp`
//  in °C) and converts them at the display boundary through `useUnits`. `power` is the
//  one field the web does NOT route through the unit facade — it renders
//  `${fmtNumber(power)} kW` verbatim — so this core reproduces that exactly rather than
//  treating power as SI watts.
//

import Foundation

// MARK: - Vehicle state (web `VehicleState` — only the fields the grid reads)

/// The slice of the web `VehicleState` the quick-stats grid consumes, carried as the raw
/// SI numbers the parent surface (the vehicle-detail page) feeds the leaf. `power` is the
/// vehicle's reported kW figure (web parity — not converted), everything else is SI.
public struct QuickStatsVehicleState: Equatable, Sendable {
    public var batteryLevel: Double
    public var ratedRange: Double
    public var odometer: Double
    public var speed: Double
    public var insideTemp: Double
    public var outsideTemp: Double
    public var power: Double

    public init(
        batteryLevel: Double = 0,
        ratedRange: Double = 0,
        odometer: Double = 0,
        speed: Double = 0,
        insideTemp: Double = 0,
        outsideTemp: Double = 0,
        power: Double = 0
    ) {
        self.batteryLevel = batteryLevel
        self.ratedRange = ratedRange
        self.odometer = odometer
        self.speed = speed
        self.insideTemp = insideTemp
        self.outsideTemp = outsideTemp
        self.power = power
    }
}

// MARK: - SI conversion + number formatting (ports of unitConversion.ts + numberFormat.ts)

/// Pure SI → display-unit conversion and locale number formatting ported from the web
/// helpers so the rounding, the grouping separators, the unit labels, and the empty-value
/// sentinel match the source exactly. Kept local (not routed through the KMP `Units`
/// facade) so the projection is deterministic and unit-testable without the Kotlin
/// runtime; the parity-pin tests assert the exact canonical factors.
public enum QuickStatsFormat {
    public static let metersPerKm = 1000.0
    public static let metersPerMile = 1609.344
    public static let secondsPerHour = 3600.0

    /// The em-dash sentinel the web formatters return for nullish / non-finite input
    /// (`DEFAULT_EMPTY_DISPLAY`).
    public static let dash = "—"

    /// Web `useSettings` global decimal precision default, read by `fmtNumber` when no
    /// per-call override is supplied (numberFormat.ts `_globalPrecision`).
    public static let globalPrecision = 2

    /// Web `DEFAULT_PRECISION` per quantity (unitConversion.ts) for the three quantities
    /// the grid renders.
    public static let distancePrecision = 1
    public static let speedPrecision = 0
    public static let temperaturePrecision = 1

    /// Web `safeNumber`: a finite number, else `0`.
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `isFiniteNumber` guard — the first check in every formatter.
    public static func isFinite(_ value: Double?) -> Bool {
        guard let value else { return false }
        return value.isFinite
    }

    /// Web `convertDistanceFromSI(meters, to)` — metres → km / mi.
    public static func convertDistanceFromSI(_ meters: Double, to unit: String) -> Double {
        unit == "mi" ? meters / metersPerMile : meters / metersPerKm
    }

    /// Web `convertSpeedFromSI(mps, to)` — m/s → km/h / mph.
    public static func convertSpeedFromSI(_ mps: Double, to unit: String) -> Double {
        unit == "mph" ? mps * secondsPerHour / metersPerMile : mps * secondsPerHour / metersPerKm
    }

    /// Web `convertTempFromSI(celsius, to)` — °C identity, °F linear.
    public static func convertTempFromSI(_ celsius: Double, to unit: String) -> Double {
        unit == "°F" ? celsius * 9 / 5 + 32 : celsius
    }

    /// Web `resolvePrecision(pref, override, fallback)`: a finite, non-negative override
    /// wins, then a finite, non-negative preference, then the quantity fallback.
    public static func resolvePrecision(override: Int?, preference: Int?, fallback: Int) -> Int {
        if let override, override >= 0 { return override }
        if let preference, preference >= 0 { return preference }
        return fallback
    }

    /// Web `formatNumber(value, locale, digits)` — `Intl.NumberFormat` with min == max
    /// fraction digits, locale grouping, half-away rounding.
    public static func formatNumber(_ value: Double, digits: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Web `fmtNumber(v, decimals)` (numberFormat.ts): `safeNumber` guard, the global
    /// precision default, locale grouping — used by the Power tile's `${fmtNumber(power)}`.
    public static func fmtNumber(_ value: Double?, decimals: Int? = nil, locale: Locale = .current) -> String {
        formatNumber(safe(value ?? 0), digits: decimals ?? globalPrecision, locale: locale)
    }

    /// Web `formatDistance(meters, pref, { precision })` — metres → display unit with the
    /// unit label spaced after the value; non-finite input yields the empty sentinel.
    public static func formatDistance(
        _ meters: Double?,
        unit: String,
        precisionOverride: Int? = nil,
        preferencePrecision: Int? = nil,
        locale: Locale = .current
    ) -> String {
        guard isFinite(meters), let meters else { return dash }
        let digits = resolvePrecision(
            override: precisionOverride,
            preference: preferencePrecision,
            fallback: distancePrecision
        )
        let value = convertDistanceFromSI(meters, to: unit)
        return "\(formatNumber(value, digits: digits, locale: locale)) \(unit)"
    }

    /// Web `formatSpeed(mps, pref, { precision })` — m/s → display unit, spaced label.
    public static func formatSpeed(
        _ mps: Double?,
        unit: String,
        precisionOverride: Int? = nil,
        preferencePrecision: Int? = nil,
        locale: Locale = .current
    ) -> String {
        guard isFinite(mps), let mps else { return dash }
        let digits = resolvePrecision(
            override: precisionOverride,
            preference: preferencePrecision,
            fallback: speedPrecision
        )
        let value = convertSpeedFromSI(mps, to: unit)
        return "\(formatNumber(value, digits: digits, locale: locale)) \(unit)"
    }

    /// Web `formatTemperature(celsius, pref)` — °C → display unit with NO space before the
    /// degree label (typographic convention), default precision 1.
    public static func formatTemperature(
        _ celsius: Double?,
        unit: String,
        precisionOverride: Int? = nil,
        preferencePrecision: Int? = nil,
        locale: Locale = .current
    ) -> String {
        guard isFinite(celsius), let celsius else { return dash }
        let digits = resolvePrecision(
            override: precisionOverride,
            preference: preferencePrecision,
            fallback: temperaturePrecision
        )
        let value = convertTempFromSI(celsius, to: unit)
        return "\(formatNumber(value, digits: digits, locale: locale))\(unit)"
    }

    /// Web `${state.battery_level}%` — JS number-to-string (integral values lose the
    /// fractional part, e.g. `82` → "82", `82.5` → "82.5") with a trailing percent sign.
    public static func batteryPercent(_ level: Double) -> String {
        "\(jsNumber(level))%"
    }

    /// Mirrors JS `String(number)` for the finite values the grid renders: integral
    /// values drop the decimal, otherwise the shortest decimal is kept.
    public static func jsNumber(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        if value == value.rounded() { return String(Int(value)) }
        return String(value)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for a tile from already-localised parts, so the spoken
/// content is asserted without rendering the view.
public enum QuickStatsAccessibility {
    /// "{label}, {value}" or "{label}, {value}, {subtitle}" when a subtitle is present.
    public static func tileLabel(label: String, value: String, subtitle: String?) -> String {
        guard let subtitle, !subtitle.isEmpty else { return "\(label), \(value)" }
        return "\(label), \(value), \(subtitle)"
    }
}
