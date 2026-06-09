//
//  ClimateControlPanelWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0026 · ClimateControlPanelWidget (Apple)
//
//  The pure, Foundation-only core for the surface: the user's temperature unit
//  (web `useUnits` → `unitPrefs.temperature`), the SI Celsius → display converter
//  (web `convertTempFromSI`), the locale-aware formatters (web `fmtInt` /
//  `fmtNumber`), the five seat positions, the cached `/climate/latest` input the
//  state holder hands the surface, and the boolean/level derivations (HVAC on,
//  active seat heaters, steering-wheel level, defrost active, battery heater). No
//  SwiftUI / no networking lives here so the logic can be exercised by a plain
//  `swift` host harness and XCTest. The assembled view-model lives in
//  ClimateControlPanelWidget.Projection.swift.
//

import Foundation

// MARK: - Temperature display unit (port of web TemperatureUnitPref)

/// The temperature display unit, mirroring the web `TemperatureUnitPref`
/// (`'°C' | '°F'`). The raw value is the suffix appended to a value, exactly as
/// the web concatenates `${fmtInt(value)}${tempUnit}` (the symbol already carries
/// the degree sign).
public enum ClimatePanelTemperatureUnit: String, Sendable, CaseIterable, Equatable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The display suffix (web `tempUnit` = `unitPrefs.temperature`).
    public var label: String {
        rawValue
    }

    /// Resolves the unit from a stored settings label, defaulting to Celsius —
    /// matching the web `UNIT_DEFAULTS.temperature` (`'°C'`), with `°F` honored
    /// when explicitly stored.
    public static func fromLabel(_ raw: String?) -> ClimatePanelTemperatureUnit {
        raw == "°F" ? .fahrenheit : .celsius
    }
}

// MARK: - SI conversion (display boundary — frontend SI cutover)

/// SI Celsius → the user's display unit. A faithful port of the web
/// `convertTempFromSI` (lib/unitConversion.ts). The DB and API stay SI (degrees
/// Celsius, per Phase-42); conversion happens only here, at the render boundary —
/// never on disk.
public enum ClimatePanelTempConvert {
    /// Converts SI Celsius to the display unit. Non-finite / absent input maps to
    /// `nil` (web only renders `inside_temp != null` / `outside_temp != null`).
    public static func fromSI(_ celsius: Double?, _ unit: ClimatePanelTemperatureUnit) -> Double? {
        guard let celsius, celsius.isFinite else { return nil }
        switch unit {
        case .celsius: return celsius
        case .fahrenheit: return celsius * 9 / 5 + 32
        }
    }
}

// MARK: - Display formatting (port of web fmtInt / fmtNumber)

/// Locale-aware number formatting mirroring the web helpers: `fmtInt` (0 decimals,
/// grouped — temperatures), `fmtNumber(v, 1)` (exactly one decimal, grouped — HVAC
/// power kW), and the bare `${value}` template interpolation (no grouping — fan
/// speed). A missing value renders as an em dash, never "nan" or "0".
public enum ClimatePanelNumberFormat {
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

    /// Bare numeric string with no grouping (web `${value}` template literal): an
    /// integral value prints without a fraction, otherwise up to six significant
    /// fraction digits with trailing zeros trimmed — matching JS `Number.toString`.
    public static func plain(_ value: Double) -> String {
        guard value.isFinite else { return dash }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.locale = .current
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 6
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%g", value)
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

// MARK: - Seat position (web seat-heater fields, in render order)

/// The five seat-heater positions, in the exact web push order
/// (`left, right, rear_left, rear_center, rear_right`). Drives the seat-chip row
/// and the accessibility summary so both stay in lock-step.
public enum ClimatePanelSeatPosition: String, Sendable, CaseIterable, Equatable {
    case frontLeft
    case frontRight
    case rearLeft
    case rearCenter
    case rearRight

    /// The P1/S10 label key (web `t('widget.climatePanel.seatFL', …)`).
    public var labelKey: String {
        switch self {
        case .frontLeft: "widget.climatePanel.seatFL"
        case .frontRight: "widget.climatePanel.seatFR"
        case .rearLeft: "widget.climatePanel.seatRL"
        case .rearCenter: "widget.climatePanel.seatRC"
        case .rearRight: "widget.climatePanel.seatRR"
        }
    }

    /// The web English fallback for the label (`'FL' | 'FR' | 'RL' | 'RC' | 'RR'`).
    public var labelFallback: String {
        switch self {
        case .frontLeft: "FL"
        case .frontRight: "FR"
        case .rearLeft: "RL"
        case .rearCenter: "RC"
        case .rearRight: "RR"
        }
    }

    /// Reads this position's heater level off a cached input.
    public func level(in input: ClimatePanelInput) -> Int? {
        switch self {
        case .frontLeft: input.seatHeaterLeft
        case .frontRight: input.seatHeaterRight
        case .rearLeft: input.seatHeaterRearLeft
        case .rearCenter: input.seatHeaterRearCenter
        case .rearRight: input.seatHeaterRearRight
        }
    }
}

// MARK: - Cached input (port of the web ClimateSnapshot subset the widget reads)

/// One cached `/climate/latest` row the state holder hands the surface. Mirrors the
/// exact subset of the web `ClimateSnapshot` the panel consumes. Temperatures are
/// SI Celsius (Phase-42 on-disk contract); `nil` models an absent reading. Seat /
/// steering levels are `0…3`; `hvacPower` is kW.
public struct ClimatePanelInput: Equatable, Sendable {
    public var insideTemp: Double?
    public var outsideTemp: Double?
    public var hvacPower: Double?
    public var hvacACEnabled: Bool?
    public var hvacFanSpeed: Double?
    public var seatHeaterLeft: Int?
    public var seatHeaterRight: Int?
    public var seatHeaterRearLeft: Int?
    public var seatHeaterRearCenter: Int?
    public var seatHeaterRearRight: Int?
    public var steeringWheelHeatLevel: Int?
    public var defrostMode: String?
    public var batteryHeaterOn: Bool?

    public init(
        insideTemp: Double? = nil,
        outsideTemp: Double? = nil,
        hvacPower: Double? = nil,
        hvacACEnabled: Bool? = nil,
        hvacFanSpeed: Double? = nil,
        seatHeaterLeft: Int? = nil,
        seatHeaterRight: Int? = nil,
        seatHeaterRearLeft: Int? = nil,
        seatHeaterRearCenter: Int? = nil,
        seatHeaterRearRight: Int? = nil,
        steeringWheelHeatLevel: Int? = nil,
        defrostMode: String? = nil,
        batteryHeaterOn: Bool? = nil
    ) {
        self.insideTemp = insideTemp
        self.outsideTemp = outsideTemp
        self.hvacPower = hvacPower
        self.hvacACEnabled = hvacACEnabled
        self.hvacFanSpeed = hvacFanSpeed
        self.seatHeaterLeft = seatHeaterLeft
        self.seatHeaterRight = seatHeaterRight
        self.seatHeaterRearLeft = seatHeaterRearLeft
        self.seatHeaterRearCenter = seatHeaterRearCenter
        self.seatHeaterRearRight = seatHeaterRearRight
        self.steeringWheelHeatLevel = steeringWheelHeatLevel
        self.defrostMode = defrostMode
        self.batteryHeaterOn = batteryHeaterOn
    }
}

// MARK: - One active seat heater (web `{ label, level }`)

/// One active seat-heater entry — the native port of the web
/// `{ label: string; level: number }` pushed for every seat with `level > 0`.
public struct ClimatePanelActiveSeat: Equatable, Sendable {
    public let position: ClimatePanelSeatPosition
    public let level: Int

    public init(position: ClimatePanelSeatPosition, level: Int) {
        self.position = position
        self.level = level
    }
}

// MARK: - Boolean / level derivations (port of the web computed values)

/// The pure derivations the web computes inline (`hvacOn`, the `seatHeaters`
/// `useMemo`, `steeringHeat`, the defrost / battery-heater chip conditions), lifted
/// out so each branch is unit-testable without a store or a rendered view.
public enum ClimatePanelDerive {
    /// Web `hvacOn = (hvac_power != null && hvac_power > 0) || hvac_ac_enabled === true`.
    public static func hvacOn(_ input: ClimatePanelInput) -> Bool {
        if let power = input.hvacPower, power.isFinite, power > 0 { return true }
        return input.hvacACEnabled == true
    }

    /// Web `hvac_power != null && hvac_power > 0` — whether the kW readout shows.
    public static func hvacPowerKW(_ input: ClimatePanelInput) -> Double? {
        guard let power = input.hvacPower, power.isFinite, power > 0 else { return nil }
        return power
    }

    /// Web `seatHeaters` `useMemo`: every seat with a non-nil level `> 0`, in the
    /// fixed `FL, FR, RL, RC, RR` order.
    public static func activeSeats(_ input: ClimatePanelInput) -> [ClimatePanelActiveSeat] {
        ClimatePanelSeatPosition.allCases.compactMap { position in
            guard let level = position.level(in: input), level > 0 else { return nil }
            return ClimatePanelActiveSeat(position: position, level: level)
        }
    }

    /// Web `steeringHeat = hvac_steering_wheel_heat_level ?? 0`.
    public static func steeringLevel(_ input: ClimatePanelInput) -> Int {
        input.steeringWheelHeatLevel ?? 0
    }

    /// Web `defrost_mode && defrost_mode !== 'Off'` — whether the Defrost chip shows.
    public static func defrostActive(_ input: ClimatePanelInput) -> Bool {
        guard let mode = input.defrostMode else { return false }
        let trimmed = mode.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && trimmed != "Off"
    }

    /// Web `battery_heater_on` truthiness — whether the Bat Heater chip shows.
    public static func batteryHeaterOn(_ input: ClimatePanelInput) -> Bool {
        input.batteryHeaterOn == true
    }

    /// The inside temperature, converted to the display unit and formatted (web
    /// `inside_temp != null ? fmtInt(convertTempFromSI(inside_temp)) : null`).
    public static func insideDisplay(_ input: ClimatePanelInput, unit: ClimatePanelTemperatureUnit) -> String? {
        formatted(input.insideTemp, unit: unit)
    }

    /// The outside temperature, converted to the display unit and formatted.
    public static func outsideDisplay(_ input: ClimatePanelInput, unit: ClimatePanelTemperatureUnit) -> String? {
        formatted(input.outsideTemp, unit: unit)
    }

    private static func formatted(_ celsius: Double?, unit: ClimatePanelTemperatureUnit) -> String? {
        guard let converted = ClimatePanelTempConvert.fromSI(celsius, unit) else { return nil }
        return ClimatePanelNumberFormat.integer(converted)
    }
}
