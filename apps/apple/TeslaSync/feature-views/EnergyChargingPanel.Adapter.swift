//
//  EnergyChargingPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0279 · EnergyChargingPanel (Apple)
//
//  The testable projection core for the Energy & Charging telemetry panel — the
//  SwiftUI parity of
//  features/vehicles/components/telemetry-panels/EnergyChargingPanel.tsx plus the
//  web helpers it is fed by: `fmtNumber` / `fmtWithUnit` (lib/numberFormat.ts) and
//  `useUnits().formatSpeed` → `formatSpeed` / `convertSpeedFromSI`
//  (lib/unitConversion.ts). Everything here is pure + dependency-free (no store, no
//  bundle, no rendered view, no KMP `Shared`) so the reading model, the locale
//  number formatting, the SI m/s → display-unit speed conversion, the charging-state
//  colour branch, and the per-field display strings are all unit tested in isolation.
//
//  Parity notes (the panel is a presentational leaf; its parent computes the
//  telemetry, so this core formats verbatim and never rescales the upstream value):
//    • Charger Power formats `charger_power_w` (watts) with the literal "kW" label —
//      exactly `fmtWithUnit(charger_power_w, 'kW')` in the web source (no /1000).
//    • Energy Added formats `charge_energy_added_wh` (watt-hours) with the literal
//      "kWh" label — exactly `fmtWithUnit(charge_energy_added_wh, 'kWh')`.
//    • Charge Rate divides `range_added_meters_per_hour` by 3600 to m/s, then runs
//      the SI speed formatter at the speed precision (web `formatSpeed(value/3600)`).
//

import Foundation

// MARK: - Reading (web `ChargingTelemetry` fields the panel consumes)

/// The charging-telemetry fields the panel renders — the native mirror of the web
/// `ChargingTelemetry` prop (only the members the component reads). Every numeric
/// field is SI and optional (the web `… != null` guards), matching the API contract.
public struct EnergyChargingReading: Equatable, Sendable {
    /// Charger voltage in volts (web `charger_voltage`).
    public var chargerVoltage: Double?
    /// Charger actual current in amperes (web `charger_actual_current`).
    public var chargerActualCurrent: Double?
    /// Charger power in watts, SI canonical (web `charger_power_w`).
    public var chargerPowerW: Double?
    /// Energy added in watt-hours, SI canonical (web `charge_energy_added_wh`).
    public var chargeEnergyAddedWh: Double?
    /// Raw backend charging-state string, shown verbatim (web `charging_state`).
    public var chargingState: String?
    /// Battery level percentage (web `battery_level`).
    public var batteryLevel: Double?
    /// Range added in meters per hour, SI (web `range_added_meters_per_hour`).
    public var rangeAddedMetersPerHour: Double?

    public init(
        chargerVoltage: Double? = nil,
        chargerActualCurrent: Double? = nil,
        chargerPowerW: Double? = nil,
        chargeEnergyAddedWh: Double? = nil,
        chargingState: String? = nil,
        batteryLevel: Double? = nil,
        rangeAddedMetersPerHour: Double? = nil
    ) {
        self.chargerVoltage = chargerVoltage
        self.chargerActualCurrent = chargerActualCurrent
        self.chargerPowerW = chargerPowerW
        self.chargeEnergyAddedWh = chargeEnergyAddedWh
        self.chargingState = chargingState
        self.batteryLevel = batteryLevel
        self.rangeAddedMetersPerHour = rangeAddedMetersPerHour
    }
}

// MARK: - Charging-state badge (web colour branch)

/// The charging-state pill accent — the native mirror of the web ternary
/// `state === 'Charging' ? cyan : state === 'Complete' ? green : muted`. The raw
/// backend label is carried separately and shown verbatim; this only picks the tone.
public enum EnergyChargingStateBadge: String, Sendable, Equatable, CaseIterable {
    /// `charging_state === 'Charging'` → cyan accent.
    case charging
    /// `charging_state === 'Complete'` → green accent.
    case complete
    /// Any other value (or absent) → muted accent.
    case other

    /// The web charging-state value that maps to `charging` (matched verbatim).
    public static let chargingValue = "Charging"
    /// The web charging-state value that maps to `complete` (matched verbatim).
    public static let completeValue = "Complete"

    /// Maps a raw backend `charging_state` to a badge tone, falling back to
    /// ``other`` for any value outside the two coloured cases (incl. `nil`).
    public static func from(_ raw: String?) -> EnergyChargingStateBadge {
        switch raw {
        case chargingValue: .charging
        case completeValue: .complete
        default: .other
        }
    }
}

// MARK: - Speed unit (web `SpeedUnitPref` + `convertSpeedFromSI`)

/// The display speed unit for the charge-rate value — the native mirror of the web
/// `SpeedUnitPref`. Resolves the unit label and the SI m/s → unit conversion exactly
/// as `convertSpeedFromSI` (lib/unitConversion.ts) does.
public enum EnergySpeedUnit: String, Sendable, Equatable, CaseIterable {
    case kilometersPerHour
    case milesPerHour

    /// The unit label appended after the number (web `pref.speed`).
    public var label: String {
        switch self {
        case .kilometersPerHour: "km/h"
        case .milesPerHour: "mph"
        }
    }

    /// Port of `convertSpeedFromSI(mps, to)`:
    /// `km/h = mps * 3600 / 1000`, `mph = mps * 3600 / 1609.344`.
    public func fromMetersPerSecond(_ mps: Double) -> Double {
        let perHour = mps * EnergyChargingFormat.secondsPerHour
        switch self {
        case .kilometersPerHour: return perHour / EnergyChargingFormat.metersPerKilometer
        case .milesPerHour: return perHour / EnergyChargingFormat.metersPerMile
        }
    }

    /// Resolves a web `SpeedUnitPref` label ("km/h" / "mph") to a unit, defaulting to
    /// `kilometersPerHour` (the web SI/metric default) for anything else.
    public init(label: String) {
        self = label == "mph" ? .milesPerHour : .kilometersPerHour
    }
}

// MARK: - Units (the `useUnits` projection this surface needs)

/// The slice of the user's `useUnits` preferences the panel needs — the display
/// speed unit plus the optional precision / locale / empty sentinel that drive the
/// SI formatters. Mirrors the web `UnitPref` members the component's `formatSpeed`
/// call reads. Defaults reproduce the web SI/metric defaults.
public struct EnergyChargingUnits: Equatable, Sendable {
    public var speed: EnergySpeedUnit
    public var precision: Int?
    public var locale: String?
    public var emptyDisplay: String?

    public init(
        speed: EnergySpeedUnit = .kilometersPerHour,
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
    public static let metric = EnergyChargingUnits(speed: .kilometersPerHour)
    /// Imperial display defaults (mph).
    public static let imperial = EnergyChargingUnits(speed: .milesPerHour)

    /// The resolved formatting locale — the configured tag, else `en_US` (the web
    /// `setGlobalLocale` fallback for empty/invalid tags).
    var resolvedLocale: Locale {
        guard let locale, !locale.trimmingCharacters(in: .whitespaces).isEmpty else {
            return Locale(identifier: "en_US")
        }
        return Locale(identifier: locale)
    }

    /// The empty sentinel for a missing speed value (web `pref.emptyDisplay ?? '—'`).
    var resolvedEmpty: String {
        emptyDisplay ?? EnergyChargingFormat.dash
    }
}

// MARK: - Number / speed formatting (ports of numberFormat.ts + unitConversion.ts)

/// Pure number + speed formatting ported from the web helpers so the rounding, the
/// grouping separators, and the SI conversion match the source exactly. The web
/// global number precision is 2 and the speed precision default is 0; `safeNumber`
/// coerces non-finite input to 0. All three are reproduced here.
public enum EnergyChargingFormat {
    /// The em-dash sentinel the web renders for a missing/non-applicable value.
    public static let dash = "—"

    static let secondsPerHour = 3600.0
    static let metersPerKilometer = 1000.0
    static let metersPerMile = 1609.344

    /// Web global precision for `fmtNumber` (used by every non-speed value).
    public static let defaultNumberPrecision = 2
    /// Web `DEFAULT_PRECISION.speed` (used by `formatSpeed` unless overridden).
    public static let defaultSpeedPrecision = 0

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

    /// Native port of `fmtWithUnit(v, unit)` — `fmtNumber(v)` plus a spaced unit.
    public static func withUnit(_ value: Double, _ unit: String, decimals: Int, locale: Locale) -> String {
        number(value, decimals: decimals, locale: locale) + " " + unit
    }

    /// Native port of `formatSpeed(mps, pref)` (lib/unitConversion.ts): a `nil` /
    /// non-finite input yields the empty sentinel; otherwise convert SI m/s to the
    /// display unit and format at the speed precision (`pref.precision ?? 0`) with the
    /// unit label appended.
    public static func speed(metersPerSecond mps: Double?, units: EnergyChargingUnits) -> String {
        guard let mps, mps.isFinite else { return units.resolvedEmpty }
        let digits = units.precision ?? defaultSpeedPrecision
        let value = units.speed.fromMetersPerSecond(mps)
        return number(value, decimals: digits, locale: units.resolvedLocale) + " " + units.speed.label
    }
}

// MARK: - Projection (web render values: the metric cards + the rows + the pill)

/// The resolved, view-ready display strings for one charging reading — the native
/// mirror of the panel's per-field formatting. Every value is pre-formatted so the
/// view is a pure function of this projection; the unit symbols ("V", "A", "kW",
/// "kWh", "%") are SI literals (locale-independent), matching the web source.
public struct EnergyChargingProjection: Equatable, Sendable {
    public let voltageValue: String
    public let voltageUnit: String
    public let currentValue: String
    public let currentUnit: String
    public let powerText: String
    public let energyAddedText: String
    public let batteryLevelText: String
    public let chargeRateText: String
    /// The raw backend charging-state label (web `charging_state`), shown verbatim
    /// when present; `nil` means the view shows the localized "Unknown" fallback.
    public let stateRawLabel: String?
    public let stateBadge: EnergyChargingStateBadge

    public init(
        voltageValue: String,
        voltageUnit: String,
        currentValue: String,
        currentUnit: String,
        powerText: String,
        energyAddedText: String,
        batteryLevelText: String,
        chargeRateText: String,
        stateRawLabel: String?,
        stateBadge: EnergyChargingStateBadge
    ) {
        self.voltageValue = voltageValue
        self.voltageUnit = voltageUnit
        self.currentValue = currentValue
        self.currentUnit = currentUnit
        self.powerText = powerText
        self.energyAddedText = energyAddedText
        self.batteryLevelText = batteryLevelText
        self.chargeRateText = chargeRateText
        self.stateRawLabel = stateRawLabel
        self.stateBadge = stateBadge
    }

    /// Builds the display projection from a reading + the user's unit preferences —
    /// the native port of the web component's per-field formatting. Non-speed numbers
    /// use the global precision (`precision ?? 2`); the charge rate runs the SI speed
    /// formatter; every missing value renders the em-dash (web literal `'—'`).
    public static func make(reading: EnergyChargingReading, units: EnergyChargingUnits) -> EnergyChargingProjection {
        let decimals = units.precision ?? EnergyChargingFormat.defaultNumberPrecision
        let locale = units.resolvedLocale
        let dash = EnergyChargingFormat.dash

        func numberOrDash(_ value: Double?) -> String {
            guard let value else { return dash }
            return EnergyChargingFormat.number(value, decimals: decimals, locale: locale)
        }

        func unitOrDash(_ value: Double?, _ unit: String) -> String {
            guard let value else { return dash }
            return EnergyChargingFormat.withUnit(value, unit, decimals: decimals, locale: locale)
        }

        let battery = reading.batteryLevel
            .map { EnergyChargingFormat.number($0, decimals: decimals, locale: locale) + "%" } ?? dash
        let chargeRate = reading.rangeAddedMetersPerHour
            .map { EnergyChargingFormat.speed(metersPerSecond: $0 / EnergyChargingFormat.secondsPerHour, units: units) }
            ?? dash

        return EnergyChargingProjection(
            voltageValue: numberOrDash(reading.chargerVoltage),
            voltageUnit: "V",
            currentValue: numberOrDash(reading.chargerActualCurrent),
            currentUnit: "A",
            powerText: unitOrDash(reading.chargerPowerW, "kW"),
            energyAddedText: unitOrDash(reading.chargeEnergyAddedWh, "kWh"),
            batteryLevelText: battery,
            chargeRateText: chargeRate,
            stateRawLabel: reading.chargingState,
            stateBadge: .from(reading.chargingState)
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary for the panel from already-localized parts, so the
/// spoken content is asserted without rendering the view.
public enum EnergyChargingAccessibility {
    /// The panel's spoken summary: "{state}, {battery}, {power}".
    public static func summary(state: String, battery: String, power: String) -> String {
        "\(state), \(battery), \(power)"
    }
}
