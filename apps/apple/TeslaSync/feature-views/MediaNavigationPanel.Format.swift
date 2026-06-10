//
//  MediaNavigationPanel.Format.swift
//  TeslaSync — P4 feature view · 0282 · MediaNavigationPanel (Apple)
//
//  The pure units + number-formatting layer the Media & Navigation panel's projection
//  is built on — the native ports of the web helpers the source is fed by: `cleanNil`
//  (lib/cleanNil.ts), `fmtNumber` / `fmtInt` (lib/numberFormat.ts), and
//  `useUnits().unitPrefs.distance` → `convertDistanceFromSI` (lib/unitConversion.ts).
//  Everything here is pure + dependency-free (no store, no bundle, no rendered view,
//  no KMP `Shared`) so the nil-string scrubbing, the locale number formatting, and the
//  SI meters → display-unit distance conversion are all unit tested in isolation.
//

import Foundation

// MARK: - Nil-string scrubbing (web `cleanNil`)

/// Pure port of the web `cleanNil` helper (lib/cleanNil.ts): filters Go's nil
/// string representations (`"<nil>"`, `"nil"`, `"null"`) and empties to `nil`, so a
/// scrubbed value is either meaningful text or absent — never a sentinel literal.
public enum MediaNavText {
    private static let nilLiterals: Set<String> = ["<nil>", "nil", "null"]

    /// Returns the value, or `nil` when the input is empty or one of Go's nil-string
    /// representations (matching the web `cleanNil` truthiness + literal checks). A
    /// meaningful value is preserved verbatim.
    public static func cleanNil(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return nilLiterals.contains(value) ? nil : value
    }
}

// MARK: - Distance unit (web `DistanceUnitPref` + `convertDistanceFromSI`)

/// The display distance unit for the navigation distance-to-arrival value — the
/// native mirror of the web `DistanceUnitPref` (`'km' | 'mi' | 'ft'`). Resolves the
/// unit label and the SI meters → unit conversion exactly as `convertDistanceFromSI`
/// (lib/unitConversion.ts) does.
public enum MediaNavDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers
    case miles
    case feet

    /// The unit label appended after the number (web `unitPrefs.distance`).
    public var label: String {
        switch self {
        case .kilometers: "km"
        case .miles: "mi"
        case .feet: "ft"
        }
    }

    /// Port of `convertDistanceFromSI(meters, to)`:
    /// `km = m / 1000`, `mi = m / 1609.344`, `ft = m / 0.3048`.
    public func fromMeters(_ meters: Double) -> Double {
        switch self {
        case .kilometers: meters / MediaNavFormat.metersPerKilometer
        case .miles: meters / MediaNavFormat.metersPerMile
        case .feet: meters / MediaNavFormat.metersPerFoot
        }
    }

    /// Resolves a web `DistanceUnitPref` label ("km" / "mi" / "ft") to a unit,
    /// defaulting to `kilometers` (the web SI/metric default) for anything else.
    public init(label: String) {
        switch label {
        case "mi": self = .miles
        case "ft": self = .feet
        default: self = .kilometers
        }
    }
}

// MARK: - Units (the `useUnits` projection this surface needs)

/// The slice of the user's `useUnits` preferences the panel needs — the display
/// distance unit plus the optional precision / locale that drive the number
/// formatter. Mirrors the web `UnitPref` members the component's distance formatting
/// reads. Defaults reproduce the web SI/metric defaults.
public struct MediaNavUnits: Equatable, Sendable {
    public var distance: MediaNavDistanceUnit
    public var precision: Int?
    public var locale: String?

    public init(
        distance: MediaNavDistanceUnit = .kilometers,
        precision: Int? = nil,
        locale: String? = nil
    ) {
        self.distance = distance
        self.precision = precision
        self.locale = locale
    }

    /// Metric display defaults (km).
    public static let metric = MediaNavUnits(distance: .kilometers)
    /// Imperial display defaults (mi).
    public static let imperial = MediaNavUnits(distance: .miles)

    /// The resolved formatting locale — the configured tag, else `en_US` (the web
    /// `setGlobalLocale` fallback for empty/invalid tags).
    var resolvedLocale: Locale {
        guard let locale, !locale.trimmingCharacters(in: .whitespaces).isEmpty else {
            return Locale(identifier: "en_US")
        }
        return Locale(identifier: locale)
    }
}

// MARK: - Number / distance formatting (ports of numberFormat.ts + unitConversion.ts)

/// Pure number + distance formatting ported from the web helpers so the rounding, the
/// grouping separators, and the SI conversion match the source exactly. The web
/// global number precision is 2 and `fmtInt` is 0 decimals; `safeNumber` coerces
/// non-finite input to 0. All three are reproduced here.
public enum MediaNavFormat {
    static let metersPerKilometer = 1000.0
    static let metersPerMile = 1609.344
    static let metersPerFoot = 0.3048

    /// Web global precision for `fmtNumber` (used by the distance value).
    public static let defaultNumberPrecision = 2

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction
    /// digits, half-away-from-zero rounding (the `toLocaleString` default), and the
    /// `safeNumber` guard for non-finite input.
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

    /// Native port of `fmtInt(v)` — `fmtNumber(v, 0)`.
    public static func int(_ value: Double, locale: Locale) -> String {
        number(value, decimals: 0, locale: locale)
    }

    /// Native port of the web distance render
    /// `fmtNumber(convertDistanceFromSI(meters, unit)) + ' ' + unit`: convert the SI
    /// meters to the display unit, format at the global precision, and append the
    /// unit label. A non-finite input falls through `safeNumber` to 0.
    public static func distance(meters: Double, units: MediaNavUnits) -> String {
        let digits = units.precision ?? defaultNumberPrecision
        let value = units.distance.fromMeters(meters)
        return number(value, decimals: digits, locale: units.resolvedLocale) + " " + units.distance.label
    }
}
