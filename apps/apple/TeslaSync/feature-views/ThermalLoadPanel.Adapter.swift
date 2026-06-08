//
//  ThermalLoadPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0163 · ThermalLoadPanel (Apple)
//
//  The testable projection core for the thermal-load panel — the SwiftUI parity of
//  features/driving/components/drivetrain-health/ThermalLoadPanel.tsx plus the web
//  helpers it leans on: `tempSeverityColor` / `displayTemp` (drivetrain-health
//  helpers.ts), `formatTemperature` (lib/unitConversion.ts via the `useUnits` hook),
//  and `fmtInt` / `fmtNumber` (lib/numberFormat.ts). Everything here is pure and
//  dependency-free (no store, no bundle, no rendered view, no Shared framework) so the
//  sensor model, the severity thresholds, the bar fraction math, the locale number /
//  temperature formatting, and the inline-metric fallbacks are all unit tested in
//  isolation.
//
//  Parity note: the web panel is a presentational leaf fed `sensors` (built from the
//  drivetrain-health reading), a parent-computed `peakPower` / `avgPowerMax` (already
//  in kW), and the `DrivingStats`. This core mirrors that contract verbatim — it does
//  not re-derive the power values from SI watts (the parent's kW derivation is out of
//  scope here, exactly as the breakdown was for the AcDcStatsPanel leaf).
//

import Foundation

// MARK: - Temperature display unit (web `convertTempFromSI` + `unitPrefs.temperature`)

/// The temperature display unit applied at the render boundary. Disk/API values are
/// always SI Celsius; this mirrors the web `useUnits().unitPrefs.temperature` axis.
public enum ThermalTemperatureUnit: String, Sendable, Equatable, CaseIterable {
    case celsius
    case fahrenheit

    /// The unit symbol appended to a formatted value (web typographic `°C` / `°F`).
    public var symbol: String {
        switch self {
        case .celsius: "°C"
        case .fahrenheit: "°F"
        }
    }

    /// Converts an SI Celsius value into the display unit — web `convertTempFromSI`
    /// (`°C` identity, `°F` linear `c * 9 / 5 + 32`).
    public func convert(_ celsius: Double) -> Double {
        switch self {
        case .celsius: celsius
        case .fahrenheit: celsius * 9 / 5 + 32
        }
    }

    /// Resolves the unit from the web preference label (`"°F"` ⇒ Fahrenheit, else
    /// Celsius) so a `useUnits`-derived snapshot maps in cleanly.
    public static func fromLabel(_ label: String) -> ThermalTemperatureUnit {
        label == "°F" ? .fahrenheit : .celsius
    }
}

// MARK: - Unit context (web `useUnits` slice this surface consumes)

/// The display-unit context bound from `useUnits`: the temperature unit plus the
/// locale and precision the web `formatTemperature` honours. `precision` folds the web
/// `pref.precision` (a nil/negative value falls back to the temperature default of 1).
public struct ThermalUnitContext: Sendable, Equatable {
    public var temperature: ThermalTemperatureUnit
    public var locale: String?
    public var precision: Int?

    public init(
        temperature: ThermalTemperatureUnit = .celsius,
        locale: String? = nil,
        precision: Int? = nil
    ) {
        self.temperature = temperature
        self.locale = locale
        self.precision = precision
    }

    /// The resolved `Locale` for number formatting (web `pref.locale`, default device).
    public var resolvedLocale: Locale {
        guard let locale, !locale.isEmpty else { return .current }
        return Locale(identifier: locale)
    }
}

// MARK: - Severity (web `tempSeverityColor`)

/// The thermal severity of a sensor reading — the native equivalent of the web
/// `tempSeverityColor(celsius, max)` ladder. `unknown` is the web `celsius === null`
/// grey branch; the others are the `ratio >= 0.85` / `>= 0.65` thresholds.
public enum ThermalSeverity: String, Sendable, Equatable, CaseIterable {
    case unknown
    case good
    case warning
    case critical

    /// Web `tempSeverityColor`: a `nil` reading is unknown; otherwise classify by the
    /// `celsius / max` ratio. A non-positive or non-finite ceiling (never the case for
    /// the real 60/120/150 °C limits) is treated as unknown to avoid an `Inf`/`NaN`
    /// ratio rather than reporting a spurious `critical`.
    public static func forTemperature(_ celsius: Double?, maxTemp: Double) -> ThermalSeverity {
        guard let celsius, celsius.isFinite else { return .unknown }
        guard maxTemp > 0, maxTemp.isFinite else { return .unknown }
        let ratio = celsius / maxTemp
        if ratio >= 0.85 { return .critical }
        if ratio >= 0.65 { return .warning }
        return .good
    }
}

// MARK: - Bar fraction (web `MetricBar` `pct = min(value / max * 100, 100)`)

/// The proportional fill of a sensor's severity bar — the native equivalent of the web
/// `MetricBar` `Math.min((value / max) * 100, 100)`, expressed as a clamped `0...1`
/// fraction. A `nil` reading uses the web `value ?? 0` (an empty bar); a non-positive
/// or non-finite ceiling yields zero.
public enum ThermalBar {
    public static func fraction(value celsius: Double?, maxTemp: Double) -> Double {
        guard maxTemp > 0, maxTemp.isFinite else { return 0 }
        let value = celsius ?? 0
        guard value.isFinite else { return 0 }
        return Swift.min(Swift.max(value / maxTemp, 0), 1)
    }
}

// MARK: - Sensor reading (web `TempSensor`)

/// One thermal sensor row — the native mirror of the web `TempSensor` the panel maps
/// over. The display label is carried as an i18n key + English fallback (resolved in
/// the view); the value stays raw SI Celsius so the view formats it through the bound
/// `ThermalUnitContext`, and the ceiling drives both the bar fraction and the severity.
public struct ThermalSensorReading: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let valueCelsius: Double?
    public let maxTempCelsius: Double

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        valueCelsius: Double?,
        maxTempCelsius: Double
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.valueCelsius = valueCelsius
        self.maxTempCelsius = maxTempCelsius
    }

    /// The clamped `0...1` bar fill (web `MetricBar` percentage).
    public var fraction: Double {
        ThermalBar.fraction(value: valueCelsius, maxTemp: maxTempCelsius)
    }

    /// The severity tier driving the readout + bar colour (web `tempSeverityColor`).
    public var severity: ThermalSeverity {
        ThermalSeverity.forTemperature(valueCelsius, maxTemp: maxTempCelsius)
    }
}

// MARK: - Driving stats (web `DrivingStats` slice the inline metrics read)

/// The `DrivingStats` fields the panel's inline metrics consume — `totalDrives` and
/// `regenRatio` (a 0...1 fraction the view renders as a percentage).
public struct ThermalLoadStats: Equatable, Sendable {
    public let totalDrives: Int
    public let regenRatio: Double

    public init(totalDrives: Int, regenRatio: Double) {
        self.totalDrives = totalDrives
        self.regenRatio = regenRatio
    }
}

// MARK: - Number / temperature formatting (ports of numberFormat.ts + unitConversion.ts)

/// Pure number / percent / temperature / power formatting ported from the web helpers
/// so the rounding, the grouping separators, the temperature precision, and the
/// em-dash fallbacks match the source exactly. The web global `safeNumber` coerces
/// non-finite input to 0; the temperature default precision is 1.
public enum ThermalFormat {
    /// The em-dash sentinel the web renders for a missing / non-applicable value.
    public static let dash = "—"

    /// The web `DEFAULT_PRECISION.temperature` used when the unit context carries none.
    public static let defaultTemperaturePrecision = 1

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction digits,
    /// half-away rounding (the Intl `halfExpand` default), `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `fmtInt(v)` — a zero-fraction-digit locale integer with grouping.
    public static func int(_ value: Double, locale: Locale = .current) -> String {
        number(value, decimals: 0, locale: locale)
    }

    /// Native port of `fmtNumber(v, decimals)` with a trailing `%` (web regen ratio).
    public static func percent(_ value: Double, decimals: Int = 1, locale: Locale = .current) -> String {
        number(value, decimals: decimals, locale: locale) + "%"
    }

    /// Native port of `formatTemperature(celsius, pref)` (unitConversion.ts) as fed by
    /// `displayTemp`: a non-finite / missing reading is the em-dash; otherwise convert
    /// to the display unit and format with the resolved precision and no space before
    /// the unit symbol.
    public static func temperature(
        _ celsius: Double?,
        unit: ThermalTemperatureUnit,
        precision: Int? = nil,
        locale: Locale = .current
    ) -> String {
        guard let celsius, celsius.isFinite else { return dash }
        let digits = resolvePrecision(precision)
        let converted = unit.convert(celsius)
        return number(converted, decimals: digits, locale: locale) + unit.symbol
    }

    /// Native port of `resolvePrecision`: a valid (non-negative) override wins, else the
    /// temperature default of 1.
    static func resolvePrecision(_ precision: Int?) -> Int {
        guard let precision, precision >= 0 else { return defaultTemperaturePrecision }
        return precision
    }

    /// Web `peakPower > 0 ? `${fmtInt(peakPower)} kW` : '—'` — the integer-kW readout.
    public static func powerInteger(_ kilowatts: Double, locale: Locale = .current) -> String {
        kilowatts > 0 ? "\(int(kilowatts, locale: locale)) kW" : dash
    }

    /// Web `avgPowerMax > 0 ? `${fmtNumber(avgPowerMax, 1)} kW` : '—'` — the decimal-kW
    /// readout.
    public static func powerDecimal(
        _ kilowatts: Double,
        decimals: Int = 1,
        locale: Locale = .current
    ) -> String {
        kilowatts > 0 ? "\(number(kilowatts, decimals: decimals, locale: locale)) kW" : dash
    }

    /// Web `stats ? fmtInt(stats.totalDrives) : '—'` — the drives count.
    public static func drives(_ stats: ThermalLoadStats?, locale: Locale = .current) -> String {
        guard let stats else { return dash }
        return int(Double(stats.totalDrives), locale: locale)
    }

    /// Web `stats ? `${fmtNumber(stats.regenRatio * 100, 1)}%` : '—'` — the regen ratio.
    public static func regenRatio(_ stats: ThermalLoadStats?, locale: Locale = .current) -> String {
        guard let stats else { return dash }
        return percent(stats.regenRatio * 100, decimals: 1, locale: locale)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the sensor bars and the inline metrics from
/// already-localised parts, so the spoken content is asserted without rendering.
public enum ThermalAccessibility {
    /// The per-sensor spoken label: "{name}, {temperature}".
    public static func sensorLabel(name: String, value: String) -> String {
        "\(name), \(value)"
    }

    /// The per-metric spoken label: "{label}, {value}".
    public static func metricLabel(label: String, value: String) -> String {
        "\(label), \(value)"
    }
}
