//
//  ClimateStatusWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0028 · ClimateStatusWidget (Apple)
//
//  The pure, Foundation-only core for the surface: the user's temperature unit
//  (web `useUnits` → `unitPrefs.temperature`), the SI Celsius → display converter
//  (web `convertTempFromSI`), the locale-aware formatters (web `fmtInt` /
//  `fmtNumber`), the cached `/climate/latest` subset the surface reads, and the
//  value/boolean derivations the web computes inline (cabin / outside temp display,
//  the HVAC kW readout, the Defrost / Heater chip conditions). No SwiftUI / no
//  networking lives here so the logic can be exercised by a plain `swift` host
//  harness and XCTest. The assembled view-model lives in
//  ClimateStatusWidget.Projection.swift.
//

import Foundation

// MARK: - Temperature display unit (port of web TemperatureUnitPref)

/// The temperature display unit, mirroring the web `TemperatureUnitPref`
/// (`'°C' | '°F'`). The raw value is the suffix appended to a value, exactly as
/// the web concatenates `${fmtInt(value)}${tempUnit}` (the symbol already carries
/// the degree sign).
public enum ClimateStatusTemperatureUnit: String, Sendable, CaseIterable, Equatable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The display suffix (web `tempUnit` = `unitPrefs.temperature`).
    public var label: String {
        rawValue
    }

    /// Resolves the unit from a stored settings label, defaulting to Celsius —
    /// matching the web `UNIT_DEFAULTS.temperature` (`'°C'`), with `°F` honored
    /// when explicitly stored.
    public static func fromLabel(_ raw: String?) -> ClimateStatusTemperatureUnit {
        raw == "°F" ? .fahrenheit : .celsius
    }
}

// MARK: - SI conversion (display boundary — frontend SI cutover)

/// SI Celsius → the user's display unit. A faithful port of the web
/// `convertTempFromSI` (lib/unitConversion.ts). The DB and API stay SI (degrees
/// Celsius, per Phase-42); conversion happens only here, at the render boundary —
/// never on disk.
public enum ClimateStatusTempConvert {
    /// Converts SI Celsius to the display unit. Non-finite / absent input maps to
    /// `nil` (web only renders `inside_temp != null` / `outside_temp != null`).
    public static func fromSI(_ celsius: Double?, _ unit: ClimateStatusTemperatureUnit) -> Double? {
        guard let celsius, celsius.isFinite else { return nil }
        switch unit {
        case .celsius: return celsius
        case .fahrenheit: return celsius * 9 / 5 + 32
        }
    }
}

// MARK: - Display formatting (port of web fmtInt / fmtNumber)

/// Locale-aware number formatting mirroring the web helpers: `fmtInt` (0 decimals,
/// grouped — temperatures) and `fmtNumber(v, 1)` (exactly one decimal, grouped —
/// HVAC power kW). A missing value renders as an em dash, never "nan" or "0".
public enum ClimateStatusNumberFormat {
    /// The em dash shown for a missing value (web `'—'`).
    public static let dash = "—"

    /// Rounded integer with grouping separators (web `fmtInt(12345.6) → "12,346"`).
    public static func integer(_ value: Double) -> String {
        guard value.isFinite else { return dash }
        return grouped(value, fractionDigits: 0)
    }

    /// Exactly one fraction digit with grouping (web `fmtNumber(value, 1)`).
    public static func decimal1(_ value: Double) -> String {
        guard value.isFinite else { return dash }
        return grouped(value, fractionDigits: 1)
    }

    private static func grouped(_ value: Double, fractionDigits: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.locale = .current
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value))
            ?? String(format: "%.\(fractionDigits)f", value)
    }
}

// MARK: - Cached input (port of the web ClimateSnapshot subset the widget reads)

/// One cached `/climate/latest` row the state holder hands the surface. Mirrors the
/// exact subset of the web `ClimateSnapshot` the status widget consumes:
/// inside/outside temperature (SI Celsius — Phase-42 on-disk contract; `nil` models
/// an absent reading), the HVAC power in kW, the defrost mode string, and the
/// battery-heater flag.
public struct ClimateStatusInput: Equatable, Sendable {
    public var insideTemp: Double?
    public var outsideTemp: Double?
    public var hvacPower: Double?
    public var defrostMode: String?
    public var batteryHeaterOn: Bool?

    public init(
        insideTemp: Double? = nil,
        outsideTemp: Double? = nil,
        hvacPower: Double? = nil,
        defrostMode: String? = nil,
        batteryHeaterOn: Bool? = nil
    ) {
        self.insideTemp = insideTemp
        self.outsideTemp = outsideTemp
        self.hvacPower = hvacPower
        self.defrostMode = defrostMode
        self.batteryHeaterOn = batteryHeaterOn
    }
}

// MARK: - Boolean / value derivations (port of the web computed values)

/// The pure derivations the web computes inline (the Cabin / Outside temperature
/// values, the HVAC kW readout, the Defrost / Heater chip conditions), lifted out
/// so each branch is unit-testable without a store or a rendered view.
public enum ClimateStatusDerive {
    /// The inside temperature, converted to the display unit and formatted, with the
    /// unit suffix — or the em dash when absent (web
    /// `inside_temp != null ? ${fmtInt(convertTempFromSI(inside_temp))}${tempUnit} : '—'`).
    public static func insideDisplay(_ input: ClimateStatusInput, unit: ClimateStatusTemperatureUnit) -> String {
        temperatureDisplay(input.insideTemp, unit: unit)
    }

    /// The outside temperature, converted to the display unit and formatted, with the
    /// unit suffix — or the em dash when absent.
    public static func outsideDisplay(_ input: ClimateStatusInput, unit: ClimateStatusTemperatureUnit) -> String {
        temperatureDisplay(input.outsideTemp, unit: unit)
    }

    /// The HVAC power readout: `${fmtNumber(hvac_power, 1)} kW` whenever the value is
    /// present (the web guards only `hvac_power != null`, so a zero or negative value
    /// still shows), else the em dash.
    public static func hvacDisplay(_ input: ClimateStatusInput, kilowattUnit: String) -> String {
        guard let power = input.hvacPower, power.isFinite else { return ClimateStatusNumberFormat.dash }
        return "\(ClimateStatusNumberFormat.decimal1(power)) \(kilowattUnit)"
    }

    /// Web `defrost_mode && defrost_mode !== 'Off'` — whether the Defrost chip shows.
    public static func defrostActive(_ input: ClimateStatusInput) -> Bool {
        guard let mode = input.defrostMode else { return false }
        let trimmed = mode.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed != "Off"
    }

    /// Web `battery_heater_on` truthiness — whether the Heater chip shows.
    public static func batteryHeaterOn(_ input: ClimateStatusInput) -> Bool {
        input.batteryHeaterOn == true
    }

    private static func temperatureDisplay(
        _ celsius: Double?,
        unit: ClimateStatusTemperatureUnit
    ) -> String {
        guard let converted = ClimateStatusTempConvert.fromSI(celsius, unit) else {
            return ClimateStatusNumberFormat.dash
        }
        return "\(ClimateStatusNumberFormat.integer(converted))\(unit.label)"
    }
}
