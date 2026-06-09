//
//  LiveTelemetry.Adapter.swift
//  TeslaSync — P4 feature view · 0127 · LiveTelemetry (Apple)
//
//  The testable projection core for the live-telemetry section — the SwiftUI parity
//  of features/dashboard/components/LiveTelemetry.tsx plus the web helpers it is fed
//  by: `fmtNumber` / `fmtInt` (lib/numberFormat.ts), `cleanNil` (lib/cleanNil.ts),
//  and the `toTemperatureDisplay` / `toDistanceDisplay` / `toPressureDisplay`
//  converters its parent injects (ports of convertTempFromSI / convertDistanceFromSI
//  / convertPressureFromSI, lib/unitConversion.ts). Everything here is pure +
//  dependency-free (no store, no bundle, no rendered view) so the six panel
//  projections, the unit conversions, the locale number formatting, the pressure /
//  gear / playback tones, and the door / window open counts are all unit tested in
//  isolation.
//
//  Parity note: the web component is a presentational leaf fed already-base-unit
//  values (°C, km, bar) by the dashboard parent. This core reproduces that contract —
//  it carries the base values verbatim and applies the same conversion + format math
//  the parent's injected callbacks perform, so the rendered strings match exactly.
//

import Foundation

// MARK: - Display units (ports of the parent's injected converters)

/// Temperature display unit — the native mirror of the web `tempUnit` string and
/// `toTemperatureDisplay` callback (`convertTempFromSI`).
public enum LiveTemperatureUnit: String, Sendable, Equatable, CaseIterable {
    case celsius
    case fahrenheit

    /// The unit symbol appended to the value (web `tempUnit`).
    public var label: String {
        switch self {
        case .celsius: "°C"
        case .fahrenheit: "°F"
        }
    }

    /// Converts a Celsius (SI base) value to the display unit (web `convertTempFromSI`).
    public func convert(_ celsius: Double) -> Double {
        switch self {
        case .celsius: celsius
        case .fahrenheit: celsius * 9 / 5 + 32
        }
    }
}

/// Distance display unit — the native mirror of the web `distanceUnit` string and
/// `toDistanceDisplay` callback (`convertDistanceFromSI`).
public enum LiveDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers
    case miles

    private static let metersPerMile = 1609.344
    private static let metersPerKilometer = 1000.0

    /// The unit symbol appended to the value (web `distanceUnit`).
    public var label: String {
        switch self {
        case .kilometers: "km"
        case .miles: "mi"
        }
    }

    /// Converts a kilometre (the parent's base) value to the display unit. Mirrors
    /// the parent's `convertDistanceFromSI(km * 1000, unit)`.
    public func convert(_ kilometers: Double) -> Double {
        let meters = kilometers * Self.metersPerKilometer
        switch self {
        case .kilometers: return meters / Self.metersPerKilometer
        case .miles: return meters / Self.metersPerMile
        }
    }
}

/// Pressure display unit — the native mirror of the web `pressureUnit` string and
/// `toPressureDisplay` callback (`convertPressureFromSI`).
public enum LivePressureUnit: String, Sendable, Equatable, CaseIterable {
    case bar
    case psi
    case kilopascals

    private static let kpaPerPsi = 6.894757
    private static let kpaPerBar = 100.0

    /// The unit symbol appended to the value (web `pressureUnit`).
    public var label: String {
        switch self {
        case .bar: "bar"
        case .psi: "psi"
        case .kilopascals: "kPa"
        }
    }

    /// Converts a bar (the parent's base) value to the display unit. Mirrors the
    /// parent's `convertPressureFromSI(bar * 100, unit)`.
    public func convert(_ bar: Double) -> Double {
        let kpa = bar * Self.kpaPerBar
        switch self {
        case .bar: return kpa / Self.kpaPerBar
        case .psi: return kpa / Self.kpaPerPsi
        case .kilopascals: return kpa
        }
    }
}

/// The three display-unit selections the web panel is fed as props. Sourced from the
/// settings/units state holder by the production app; carried here so the projection
/// is a pure function of its input.
public struct LiveTelemetryUnits: Equatable, Sendable {
    public var temperature: LiveTemperatureUnit
    public var distance: LiveDistanceUnit
    public var pressure: LivePressureUnit

    public init(
        temperature: LiveTemperatureUnit = .celsius,
        distance: LiveDistanceUnit = .kilometers,
        pressure: LivePressureUnit = .bar
    ) {
        self.temperature = temperature
        self.distance = distance
        self.pressure = pressure
    }

    /// Metric defaults (°C / km / bar) used by previews + tests.
    public static let metric = LiveTelemetryUnits()
    /// Imperial defaults (°F / mi / psi).
    public static let imperial = LiveTelemetryUnits(temperature: .fahrenheit, distance: .miles, pressure: .psi)
}

// MARK: - Semantic tone (web text-color / Badge variant → status token)

/// The semantic tone a value / badge carries — the native mirror of the web colour
/// branches (`text-emerald-300`, `Badge variant="warning"`, …). Mapped to the design
/// status tokens by the view, kept token-free here so the logic is unit tested.
public enum LiveTelemetryTone: String, Sendable, Equatable {
    case neutral
    case success
    case warning
    case danger
    case info
    case muted
}

// MARK: - Number / conversion formatting (ports of numberFormat.ts + cleanNil.ts)

/// Pure number formatting + nil cleaning ported from the web helpers so the rounding,
/// the grouping separators, and the Go-nil filtering match the source exactly. The
/// web `safeNumber` coerces non-finite input to 0; reproduced here.
public enum LiveTelemetryFormat {
    /// The em-dash sentinel the web renders for a missing / non-applicable value.
    public static let dash = "—"

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `cleanNil` (cleanNil.ts): filters Go's `<nil>` / `nil` / `null`
    /// string sentinels (and empty / nil) to `nil`.
    public static func cleanNil(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        if value == "<nil>" || value == "nil" || value == "null" { return nil }
        return value
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction
    /// digits, half-away rounding (web `toLocaleString` default), `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int = 2, locale: Locale = .current) -> String {
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
    public static func int(_ value: Double, locale: Locale = .current) -> String {
        number(value, decimals: 0, locale: locale)
    }

    /// Native port of a JS template-literal `${value}` for a raw number: integers
    /// render with no fraction or grouping, fractions keep their minimal form. Used
    /// for the web's un-formatted torque / volume interpolations.
    public static func plain(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        if value == value.rounded() { return String(Int64(value)) }
        return String(value)
    }
}

// MARK: - Tyre-pressure tone + "normal" band (web `getPressureColor` / `allNormal`)

/// The pressure thresholds the web `TirePressurePanel` hardcodes (bar). The tone band
/// and the "normal" band are unit tested against these so the colour parity is exact.
public enum LiveTirePressure {
    public static let dangerLow = 2.068
    public static let dangerHigh = 3.103
    public static let warnLow = 2.275
    public static let warnHigh = 2.896

    /// Web `getPressureColor(bar)`: nil ⇒ muted, outside the danger band ⇒ danger,
    /// outside the warn band ⇒ warning, otherwise success.
    public static func tone(_ bar: Double?) -> LiveTelemetryTone {
        guard let bar else { return .muted }
        if bar < dangerLow || bar > dangerHigh { return .danger }
        if bar < warnLow || bar > warnHigh { return .warning }
        return .success
    }

    /// Web `allNormal`: a missing corner counts as normal; a present corner is normal
    /// only inside the warn band.
    public static func isNormal(_ bar: Double?) -> Bool {
        guard let bar else { return true }
        return bar >= warnLow && bar <= warnHigh
    }
}

// MARK: - Unit symbols (locale-invariant, mirroring the web's hardcoded literals)

/// The SI / domain unit symbols the web hardcodes inline (`Nm`, `kW`, `g`, `min`).
/// Locale-invariant glyphs, kept as constants the way the shared `AcDcFormat` keeps
/// `kWh` / `MWh` — they are not localized copy.
public enum LiveUnitSymbol {
    public static let torque = "Nm"
    public static let power = "kW"
    public static let gForce = "g"
    public static let minutes = "min"
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the panels from already-localized parts, so the
/// spoken content is asserted without rendering the view.
public enum LiveTelemetryAccessibility {
    /// A "{label}, {value}" telemetry row label.
    public static func row(label: String, value: String) -> String {
        "\(label), \(value)"
    }

    /// A tyre corner spoken label: "{corner}, {value} {unit}".
    public static func tire(corner: String, value: String, unit: String) -> String {
        "\(corner), \(value) \(unit)"
    }
}
