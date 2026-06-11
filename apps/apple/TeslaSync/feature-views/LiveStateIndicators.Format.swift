//
//  LiveStateIndicators.Format.swift
//  TeslaSync — P4 feature view · 0292 · LiveStateIndicators (Apple)
//
//  The speed-unit + number formatting port for the live state indicators — the native
//  parity of `useUnits().formatSpeed` → `formatSpeed` / `convertSpeedFromSI`
//  (web/src/lib/unitConversion.ts) and the `Intl.NumberFormat` grouping/rounding it
//  relies on. Pure + dependency-free (no store, no bundle, no rendered view, no KMP
//  `Shared`), so the SI m/s → km/h·mph conversion, the locale grouping, the
//  half-away-from-zero rounding, and the em-dash sentinel are all unit tested in
//  isolation. Split out of the Adapter to keep every surface file within the swiftlint
//  file-length budget, mirroring the sibling VehicleStatePanel/0287.
//

import Foundation

// MARK: - Speed unit (web `SpeedUnitPref` + `convertSpeedFromSI`)

/// The display speed unit — the native mirror of the web `SpeedUnitPref`. Resolves the
/// unit symbol and the SI m/s → unit conversion exactly as `convertSpeedFromSI`
/// (web/src/lib/unitConversion.ts) does.
public enum LiveStateSpeedUnit: String, Sendable, Equatable, CaseIterable {
    case kilometersPerHour
    case milesPerHour

    /// 1 km = 1000 m exactly (web `METERS_PER_KM`).
    static let metersPerKilometer = 1000.0
    /// 1 mile = 1609.344 m exactly (web `METERS_PER_MILE`, NIST).
    static let metersPerMile = 1609.344
    /// Seconds in an hour (web `SECONDS_PER_HOUR`).
    static let secondsPerHour = 3600.0

    /// The unit symbol appended after a space (web `pref.speed`: "km/h" / "mph").
    public var symbol: String {
        switch self {
        case .kilometersPerHour: "km/h"
        case .milesPerHour: "mph"
        }
    }

    /// Port of `convertSpeedFromSI(mps, to)`.
    public func fromMetersPerSecond(_ metersPerSecond: Double) -> Double {
        switch self {
        case .kilometersPerHour: metersPerSecond * Self.secondsPerHour / Self.metersPerKilometer
        case .milesPerHour: metersPerSecond * Self.secondsPerHour / Self.metersPerMile
        }
    }

    /// Resolves a web `SpeedUnitPref` symbol ("mph"/"km/h") to a unit, defaulting to
    /// `kilometersPerHour` (the web SI/metric default) for anything else.
    public init(symbol: String) {
        self = symbol == "mph" ? .milesPerHour : .kilometersPerHour
    }
}

// MARK: - Units (the `useUnits` slice this surface needs)

/// The slice of the user's `useUnits` preferences the indicators need — the display
/// speed unit plus the optional precision / locale / empty sentinel that drive the SI
/// speed formatter. Mirrors the web `UnitPref` members `formatSpeed` reads. Defaults
/// reproduce the web SI/metric defaults (km/h).
public struct LiveStateUnits: Equatable, Sendable {
    public var speed: LiveStateSpeedUnit
    public var precision: Int?
    public var locale: String?
    public var emptyDisplay: String?

    public init(
        speed: LiveStateSpeedUnit = .kilometersPerHour,
        precision: Int? = nil,
        locale: String? = nil,
        emptyDisplay: String? = nil
    ) {
        self.speed = speed
        self.precision = precision
        self.locale = locale
        self.emptyDisplay = emptyDisplay
    }

    /// Metric display defaults (km/h).
    public static let metric = LiveStateUnits(speed: .kilometersPerHour)
    /// Imperial display defaults (mph).
    public static let imperial = LiveStateUnits(speed: .milesPerHour)

    /// The resolved formatting locale — the configured tag, else `en_US` (the web
    /// `DEFAULT_LOCALE` fallback for empty/invalid tags).
    var resolvedLocale: Locale {
        guard let locale, !locale.trimmingCharacters(in: .whitespaces).isEmpty else {
            return Locale(identifier: "en_US")
        }
        return Locale(identifier: locale)
    }

    /// The empty sentinel for a missing value (web `pref.emptyDisplay ?? '—'`).
    var resolvedEmpty: String {
        emptyDisplay ?? LiveStateFormat.dash
    }
}

// MARK: - Number / speed formatting (ports of numberFormat.ts + unitConversion.ts)

/// Pure number + speed formatting ported from the web helpers so the rounding, the
/// grouping separators, and the SI conversion match the source exactly. The web speed
/// precision default is 0; `safeNumber` coerces non-finite input to 0.
public enum LiveStateFormat {
    /// The em-dash sentinel the web renders for a missing/non-applicable value.
    public static let dash = "—"
    /// Web `DEFAULT_PRECISION.speed` (0 decimals) — the `LiveStateIndicators` source
    /// passes `{ precision: 0 }` explicitly.
    public static let defaultSpeedPrecision = 0

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `Intl.NumberFormat(locale, { min/maxFractionDigits })`: locale
    /// grouping, fixed fraction digits, half-away-from-zero rounding (the JS default),
    /// and the `safeNumber` guard for non-finite input.
    public static func number(_ value: Double, decimals: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `formatSpeed(mps, pref, { precision: 0 })` (unitConversion.ts): a
    /// `nil` / non-finite input yields the empty sentinel; otherwise convert SI m/s to
    /// the display unit, format at the speed precision (`pref.precision ?? 0`), and
    /// append the unit symbol after a single space.
    public static func speed(metersPerSecond: Double?, units: LiveStateUnits) -> String {
        guard let metersPerSecond, metersPerSecond.isFinite else { return units.resolvedEmpty }
        let digits = units.precision ?? defaultSpeedPrecision
        let value = units.speed.fromMetersPerSecond(metersPerSecond)
        return number(value, decimals: digits, locale: units.resolvedLocale) + " " + units.speed.symbol
    }
}
