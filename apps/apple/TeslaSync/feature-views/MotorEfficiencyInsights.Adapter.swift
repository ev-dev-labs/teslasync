//
//  MotorEfficiencyInsights.Adapter.swift
//  TeslaSync — P4 feature view · 0171 · MotorEfficiencyInsights (Apple)
//
//  The pure, Foundation-only adapter layer for the Motor Efficiency Insights surface —
//  the SwiftUI parity of
//  web/src/features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx.
//
//  It carries the computed motor view-model the web component receives as props
//  (`motorStats` + `throttleStyle`), the user's temperature display preference (web
//  `tempUnit` / `toTemperatureDisplay`), and the number/temperature formatters that
//  port web/src/lib/numberFormat.ts `fmtNumber(v, 1)`. Everything here is
//  SwiftUI-free so it is exhaustively unit-testable in isolation.
//
//  Unit semantics (mirrors the web prop contract — the parent page already computed
//  these from the SI signal_log via the P1/S8 holders, so this leaf treats them as
//  presentation values, not raw SI):
//    • torque  — newton-metres (Nm)
//    • power   — kilowatts (kW)          (the throttle thresholds + bar max are in kW)
//    • temp    — degrees Celsius (°C)     (converted to the display unit at render)
//    • share   — percent (%)
//

import Foundation

// MARK: - Throttle style (web helpers.ts `ThrottleStyle` + `getThrottleStyle`)

/// The driving-style classification the web derives from average motor power
/// (`getThrottleStyle`) and passes to the component as the `throttleStyle` prop.
public enum MotorThrottleStyle: String, Sendable, Equatable, CaseIterable {
    case conservative
    case moderate
    case aggressive

    /// i18n key for the badge label (resolved through the P1/S10 facade).
    public var labelKey: String {
        switch self {
        case .conservative: "dynamics.conservative"
        case .moderate: "dynamics.moderate"
        case .aggressive: "dynamics.aggressive"
        }
    }

    /// Web English fallback for the badge label (the `t(key, default)` default).
    public var labelFallback: String {
        switch self {
        case .conservative: "Conservative"
        case .moderate: "Moderate"
        case .aggressive: "Aggressive"
        }
    }
}

/// Derivation of the throttle style from average power — the exact port of web
/// `getThrottleStyle(avgPower)` (`< 20` conservative, `< 80` moderate, else
/// aggressive). Used as a null-safe fallback when the source omits the prop.
///
/// Raw `<` comparisons (no coercion) so Swift's NaN/∞ semantics match JS exactly:
/// `NaN`/`+∞` fall through to aggressive, `-∞` is conservative — identical to the
/// web. In practice `avgPower` is always finite (an average that defaults to 0).
public enum MotorThrottle {
    public static func style(forAveragePowerKW avgPowerKW: Double) -> MotorThrottleStyle {
        if avgPowerKW < 20 { return .conservative }
        if avgPowerKW < 80 { return .moderate }
        return .aggressive
    }
}

// MARK: - Motor thermal classification (web `maxMotorTemp < 100 / < 140` thresholds)

/// The motor-thermal badge classification. The web compares the RAW Celsius
/// `maxMotorTemp` (never the converted display value) against 100 °C / 140 °C.
public enum MotorThermalStatus: String, Sendable, Equatable, CaseIterable {
    case good
    case warm
    case hot

    /// Classifies on the raw Celsius max-motor temperature (web `< 100` / `< 140`
    /// thresholds). Raw `<` (no coercion) so Swift's NaN/∞ semantics match the web:
    /// `NaN`/`+∞` fall through to hot, `-∞` is good.
    public static func classify(maxMotorTempC: Double) -> MotorThermalStatus {
        if maxMotorTempC < 100 { return .good }
        if maxMotorTempC < 140 { return .warm }
        return .hot
    }

    public var labelKey: String {
        switch self {
        case .good: "dynamics.thermalGood"
        case .warm: "dynamics.thermalWarm"
        case .hot: "dynamics.thermalHot"
        }
    }

    public var labelFallback: String {
        switch self {
        case .good: "Thermal: Good"
        case .warm: "Thermal: Warm"
        case .hot: "Thermal: Hot"
        }
    }
}

// MARK: - Temperature display preference (web `TemperatureUnitPref` + `toTemperatureDisplay`)

/// The user's temperature display unit. Mirrors the web `tempUnit` prop, whose
/// suffix already INCLUDES the degree symbol — the formatter never prefixes a
/// second '°' (the "49.0°°C" regression the web test guards against).
public enum MotorTemperatureUnit: String, Sendable, Equatable, CaseIterable {
    case celsius
    case fahrenheit

    /// The unit suffix rendered after the value (degree symbol included).
    public var suffix: String {
        switch self {
        case .celsius: "°C"
        case .fahrenheit: "°F"
        }
    }

    /// Converts a raw Celsius value to this display unit (web `toTemperatureDisplay`).
    public func convert(fromCelsius celsius: Double) -> Double {
        switch self {
        case .celsius: celsius
        case .fahrenheit: celsius * 9.0 / 5.0 + 32.0
        }
    }
}

// MARK: - Motor metrics (web helpers.ts `MotorStats`, the subset this surface renders)

/// The computed motor statistics the web component consumes. Only the fields the
/// three panels actually render are carried (torque avg/max + high-torque share,
/// average power, and avg/max motor temperature in Celsius).
public struct MotorMetrics: Sendable, Equatable {
    public var averageTorqueNm: Double
    public var maxTorqueNm: Double
    public var highTorquePercent: Double
    public var averagePowerKW: Double
    public var averageMotorTempC: Double
    public var maxMotorTempC: Double

    public init(
        averageTorqueNm: Double,
        maxTorqueNm: Double,
        highTorquePercent: Double,
        averagePowerKW: Double,
        averageMotorTempC: Double,
        maxMotorTempC: Double
    ) {
        self.averageTorqueNm = averageTorqueNm
        self.maxTorqueNm = maxTorqueNm
        self.highTorquePercent = highTorquePercent
        self.averagePowerKW = averagePowerKW
        self.averageMotorTempC = averageMotorTempC
        self.maxMotorTempC = maxMotorTempC
    }
}

// MARK: - Number / unit formatting (port of numberFormat.ts `fmtNumber(v, 1)`)

/// Locale-aware formatting that ports `web/src/lib/numberFormat.ts`. `number`
/// mirrors `fmtNumber` (grouped separators, fixed decimals, non-finite coerced to
/// 0); the unit variants reproduce the web's exact spacing (a space before "Nm" /
/// "kW", none before "%" or the degree suffix).
public enum MotorEfficiencyFormat {
    /// The bar's max power (web `MetricBar max={200}`), in kW.
    public static let powerBarMaxKW: Double = 200

    /// Port of `fmtNumber(v, decimals)` — grouped, fixed-precision, NaN/∞ ⇒ 0.
    public static func number(_ value: Double, decimals: Int = 1, locale: Locale = .current) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(decimals)f", safe)
    }

    /// `fmtWithUnit` parity: "<number> <unit>" (a single space, web ` Nm` / ` kW`).
    public static func withUnit(
        _ value: Double,
        _ unit: String,
        decimals: Int = 1,
        locale: Locale = .current
    ) -> String {
        "\(number(value, decimals: decimals, locale: locale)) \(unit)"
    }

    /// `fmtPercent` parity: "<number>%" (no space, web `{fmtNumber(..)}%`).
    public static func percent(_ value: Double, decimals: Int = 1, locale: Locale = .current) -> String {
        "\(number(value, decimals: decimals, locale: locale))%"
    }

    /// Web `{fmtNumber(toTemperatureDisplay(c), 1)}{tempUnit}` — convert then suffix,
    /// with NO extra degree prefix (the suffix already carries '°').
    public static func temperature(
        celsius: Double,
        unit: MotorTemperatureUnit,
        decimals: Int = 1,
        locale: Locale = .current
    ) -> String {
        let display = unit.convert(fromCelsius: celsius)
        return "\(number(display, decimals: decimals, locale: locale))\(unit.suffix)"
    }

    /// The throttle bar fill fraction — web `MetricBar value={avgPower} max={200}`,
    /// clamped to 0…1 and non-finite-safe.
    public static func powerFraction(_ averagePowerKW: Double, max: Double = powerBarMaxKW) -> Double {
        guard max > 0, averagePowerKW.isFinite else { return 0 }
        return min(Swift.max(averagePowerKW / max, 0), 1)
    }
}

// MARK: - Accessibility summaries

/// Builds the combined VoiceOver strings for the metric rows + panels, joining the
/// already-localized parts so the labels stay translation-driven.
public enum MotorEfficiencyAccessibility {
    /// Joins non-empty parts with ", " (the standard VoiceOver list separator).
    public static func join(_ parts: [String]) -> String {
        parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    /// "<label>, <value>" for one metric row.
    public static func metric(_ label: String, _ value: String) -> String {
        join([label, value])
    }
}
