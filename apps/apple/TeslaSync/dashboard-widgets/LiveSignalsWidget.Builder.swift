//
//  LiveSignalsWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0058 · LiveSignalsWidget (Apple)
//
//  Pure, Foundation-only adapter: a faithful Swift port of the web display math
//  this surface uses — convertTempFromSI / convertPressureFromSI
//  (lib/unitConversion.ts), fmtNumber / fmtInt / safeNumber (lib/numberFormat.ts),
//  cleanNil (lib/cleanNil.ts) — plus `buildProjection`, the unit-tested
//  cached-SI → display projection the SwiftUI view renders. No SwiftUI / transport
//  so it compiles and runs as a host binary (the executed adapter harness).
//

import Foundation

// MARK: - Pure conversion + formatting (port of lib/unitConversion.ts + lib/numberFormat.ts)

/// The display-math seam. Every function mirrors its web counterpart so both
/// platforms show identical strings (verified by the executed golden-vector
/// harness). The conversions floor at SI: Celsius for temperature, kilopascals
/// for pressure — exactly what the Phase-42 API stores.
public enum LiveSignalsFormat {
    /// The em-dash shown for a missing value (web `'—'`).
    public static let dash = "—"

    /// Kilopascals per psi (web `KPA_PER_PSI`).
    static let kpaPerPsi = 6.894757
    /// Kilopascals per bar (web `KPA_PER_BAR`).
    static let kpaPerBar = 100.0

    /// Coerces a possibly-absent/non-finite number to a safe Double (web `safeNumber`).
    public static func safeNumber(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }

    /// Converts SI Celsius to the user's display unit (web `convertTempFromSI`).
    public static func convertTempFromSI(_ celsius: Double, _ unit: LiveSignalsTemperatureUnit) -> Double {
        switch unit {
        case .celsius: celsius
        case .fahrenheit: celsius * 9 / 5 + 32
        }
    }

    /// Converts SI kilopascals to the user's display unit (web `convertPressureFromSI`).
    public static func convertPressureFromSI(_ kpa: Double, _ unit: LiveSignalsPressureUnit) -> Double {
        switch unit {
        case .kpa: kpa
        case .psi: kpa / kpaPerPsi
        case .bar: kpa / kpaPerBar
        }
    }

    /// Formats a number with a fixed fraction-digit count and locale-aware grouping
    /// (web `fmtNumber`, which delegates to `toLocaleString`). Non-finite / absent
    /// inputs format as `0`, matching `safeNumber`.
    public static func fmtNumber(_ value: Double?, _ decimals: Int, locale: String) -> String {
        let number = safeNumber(value)
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: locale)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: number)) ?? fallbackFixed(number, decimals)
    }

    /// Formats an integer with locale grouping (web `fmtInt` = `fmtNumber(v, 0)`).
    public static func fmtInt(_ value: Double?, locale: String) -> String {
        fmtNumber(value, 0, locale: locale)
    }

    /// Renders a raw number the way a JS template literal does (`${value}`): no
    /// grouping, integers without a fraction, otherwise the shortest decimal. Used
    /// for the torque row, which the web interpolates raw (`${motor.di_torque} Nm`).
    public static func jsNumber(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }

    /// Filters Go nil-string sentinels from an API string (web `cleanNil`): empty,
    /// `<nil>`, `nil`, and `null` all collapse to `nil`.
    public static func cleanNil(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        if value == "<nil>" || value == "nil" || value == "null" { return nil }
        return value
    }

    /// Locale-independent fixed-fraction fallback if `NumberFormatter` returns nil.
    private static func fallbackFixed(_ value: Double, _ decimals: Int) -> String {
        String(format: "%.\(max(0, decimals))f", value)
    }
}

// MARK: - Cached → projection adapter (port of the web row expressions)

/// Builds the display-ready `LiveSignalsProjection` from the cached SI DTOs and
/// the user's unit preferences. This is the testable core: each row reproduces
/// the exact web expression (convert-then-format, em-dash on a missing field). A
/// section is present whenever its DTO arrived, even if every field is `nil`
/// (web `{section ? rows : <Skeleton />}`), so the view renders rows-with-dashes
/// rather than a skeleton in that case.
public enum LiveSignalsBuilder {
    public static func buildProjection(
        motor: LiveSignalsMotorInput?,
        climate: LiveSignalsClimateInput?,
        security: LiveSignalsSecurityInput?,
        tires: LiveSignalsTiresInput?,
        prefs: LiveSignalsUnitPrefs
    ) -> LiveSignalsProjection {
        LiveSignalsProjection(
            motor: motor.map { motorRows($0, prefs) },
            climate: climate.map { climateRows($0, prefs) },
            tires: tires.map { tireRows($0, prefs) },
            security: security.map {
                LiveSignalsSecurityRows(locked: $0.locked == true, sentryActive: $0.sentryMode == true)
            }
        )
    }

    // MARK: Section row builders

    private static func motorRows(
        _ input: LiveSignalsMotorInput,
        _ prefs: LiveSignalsUnitPrefs
    ) -> LiveSignalsMotorRows {
        LiveSignalsMotorRows(
            torque: input.torqueNm.map { "\(LiveSignalsFormat.jsNumber($0)) Nm" } ?? LiveSignalsFormat.dash,
            temperature: temperatureValue(input.statorTempC, prefs),
            gear: LiveSignalsFormat.cleanNil(input.gear) ?? LiveSignalsFormat.dash
        )
    }

    private static func climateRows(
        _ input: LiveSignalsClimateInput,
        _ prefs: LiveSignalsUnitPrefs
    ) -> LiveSignalsClimateRows {
        LiveSignalsClimateRows(
            cabin: temperatureValue(input.insideTempC, prefs),
            outside: temperatureValue(input.outsideTempC, prefs),
            hvac: input.hvacPowerKw.map { "\(LiveSignalsFormat.fmtNumber($0, 1, locale: prefs.locale)) kW" }
                ?? LiveSignalsFormat.dash
        )
    }

    private static func tireRows(_ input: LiveSignalsTiresInput, _ prefs: LiveSignalsUnitPrefs) -> LiveSignalsTireRows {
        LiveSignalsTireRows(
            frontLeft: pressureValue(input.frontLeftKpa, prefs),
            frontRight: pressureValue(input.frontRightKpa, prefs),
            rearLeft: pressureValue(input.rearLeftKpa, prefs),
            rearRight: pressureValue(input.rearRightKpa, prefs)
        )
    }

    // MARK: Field formatters (convert-then-format, em-dash when absent)

    /// `value != null ? `${fmtInt(convertTempFromSI(value))}${tempUnit}` : '—'`.
    private static func temperatureValue(_ celsius: Double?, _ prefs: LiveSignalsUnitPrefs) -> String {
        guard let celsius else { return LiveSignalsFormat.dash }
        let display = LiveSignalsFormat.convertTempFromSI(celsius, prefs.temperature)
        return "\(LiveSignalsFormat.fmtInt(display, locale: prefs.locale))\(prefs.temperature.label)"
    }

    /// `value != null ? `${fmtNumber(convertPressureFromSI(value), 1)} ${pressureUnit}` : '—'`.
    private static func pressureValue(_ kpa: Double?, _ prefs: LiveSignalsUnitPrefs) -> String {
        guard let kpa else { return LiveSignalsFormat.dash }
        let display = LiveSignalsFormat.convertPressureFromSI(kpa, prefs.pressure)
        return "\(LiveSignalsFormat.fmtNumber(display, 1, locale: prefs.locale)) \(prefs.pressure.label)"
    }
}
