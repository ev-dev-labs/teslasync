//
//  ChargingTelemetrySection.Adapter.swift
//  TeslaSync — P4 feature view · 0290 · ChargingTelemetrySection (Apple)
//
//  The testable projection core for the vehicle-detail "Charging Telemetry" section —
//  the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx plus the
//  web helpers it is fed by: `fmtNumber` (lib/numberFormat.ts) and
//  `useUnits().formatDistance` / `formatSpeed` (hooks/useUnits.ts → lib/unitConversion.ts).
//  Everything here is pure + dependency-free (no store, no bundle, no rendered view)
//  so the eight metric tiles, the locale number formatting, the SI distance/speed
//  conversion, and the per-field em-dash fallbacks are all unit tested in isolation.
//
//  Parity notes (the web source is THE spec — reproduced verbatim, not "corrected"):
//    • Charger Power renders `${fmtNumber(charger_power_w)} kW` — the raw watt figure
//      with a "kW" suffix; Energy Added renders `${fmtNumber(charge_energy_added_wh)}
//      kWh` — the raw watt-hour figure with a "kWh" suffix. The web does NOT rescale
//      these, so neither does this core (a leaf must not silently diverge from its
//      source — covenant #9). The suffixes are scientific symbols, not prose.
//    • Battery Level appends "%" with no separating space (web `${fmtNumber(x)}%`);
//      every other numeric tile uses a single space before its unit.
//    • Charge Rate is `formatSpeed(range_added_meters_per_hour / 3600)` — the upstream
//      value is metres-of-range-added per hour, divided by 3600 to metres-per-second
//      before the SI speed formatter converts it to the user's km/h | mph unit.
//    • Range Added is `formatDistance(range_added_meters)` — SI metres → km | mi.
//    • `fmtNumber` reads the global precision (web `settings.decimal_precision`,
//      default 2); `formatDistance` / `formatSpeed` read the same preference, falling
//      back to the per-quantity defaults (1 / 0) when it is unset. Reproduced exactly
//      by `resolvePrecision` below.
//

import Foundation

// MARK: - Telemetry data (the `ChargingTelemetry` prop subset this section reads)

/// The slice of the web `ChargingTelemetry` response the section consumes, carried as
/// its own value so the projection + tests never need the whole telemetry model. All
/// magnitudes are SI on the wire (watts, volts, amps, watt-hours, metres,
/// metres-per-hour); every field is optional to model the web `!= null` guards.
public struct ChargingTelemetrySectionData: Sendable, Equatable {
    /// Charger power in watts (web `charger_power_w`).
    public var chargerPowerW: Double?
    /// Charger voltage in volts (web `charger_voltage`).
    public var chargerVoltage: Double?
    /// Charger actual current in amperes (web `charger_actual_current`).
    public var chargerActualCurrent: Double?
    /// Energy added in watt-hours (web `charge_energy_added_wh`).
    public var chargeEnergyAddedWh: Double?
    /// The charging state string (web `charging_state`, e.g. "Charging" / "Complete").
    public var chargingState: String?
    /// Battery level as a percentage (web `battery_level`).
    public var batteryLevel: Double?
    /// Range added per hour, in metres (web `range_added_meters_per_hour`).
    public var rangeAddedMetersPerHour: Double?
    /// Range added in metres (web `range_added_meters`).
    public var rangeAddedMeters: Double?

    public init(
        chargerPowerW: Double? = nil,
        chargerVoltage: Double? = nil,
        chargerActualCurrent: Double? = nil,
        chargeEnergyAddedWh: Double? = nil,
        chargingState: String? = nil,
        batteryLevel: Double? = nil,
        rangeAddedMetersPerHour: Double? = nil,
        rangeAddedMeters: Double? = nil
    ) {
        self.chargerPowerW = chargerPowerW
        self.chargerVoltage = chargerVoltage
        self.chargerActualCurrent = chargerActualCurrent
        self.chargeEnergyAddedWh = chargeEnergyAddedWh
        self.chargingState = chargingState
        self.batteryLevel = batteryLevel
        self.rangeAddedMetersPerHour = rangeAddedMetersPerHour
        self.rangeAddedMeters = rangeAddedMeters
    }
}

// MARK: - Display-boundary unit preferences (web `useUnits().unitPrefs`)

/// The distance display unit — the native mirror of the web `unitPrefs.distance`
/// (`'mi' | 'km'`), derived from the shared `MeasurementSystem`.
public enum ChargingTelemetrySectionDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case km
    case mi

    /// Maps the shared measurement system onto the distance preference: imperial ⇒
    /// miles, metric ⇒ kilometres (the web `deriveDistance` split).
    public init(_ system: MeasurementSystem) {
        self = system == .imperial ? .mi : .km
    }

    /// The trailing unit label (web `pref.distance`).
    public var label: String {
        self == .mi ? "mi" : "km"
    }
}

/// The speed display unit — the native mirror of the web `unitPrefs.speed`
/// (`'mph' | 'km/h'`), derived from the shared `MeasurementSystem`.
public enum ChargingTelemetrySectionSpeedUnit: String, Sendable, Equatable, CaseIterable {
    case kmh
    case mph

    /// Maps the shared measurement system onto the speed preference: imperial ⇒ mph,
    /// metric ⇒ km/h (the web `deriveSpeed` split).
    public init(_ system: MeasurementSystem) {
        self = system == .imperial ? .mph : .kmh
    }

    /// The trailing unit label (web `pref.speed`).
    public var label: String {
        self == .mph ? "mph" : "km/h"
    }
}

/// The resolved display preferences threaded through the P1/S8 source so the view
/// never does unit math — the native counterpart of the web `useUnits` `unitPrefs`
/// bag. `localeIdentifier` drives locale-aware grouping (web `pref.locale`);
/// `decimalPrecision` mirrors the user's `settings.decimal_precision` (web
/// `unitPrefs.precision` / the `fmtNumber` global precision), `nil` ⇒ the per-quantity
/// defaults.
public struct ChargingTelemetrySectionUnitPrefs: Sendable, Equatable {
    public var distance: ChargingTelemetrySectionDistanceUnit
    public var speed: ChargingTelemetrySectionSpeedUnit
    public var localeIdentifier: String
    public var decimalPrecision: Int?

    public init(
        distance: ChargingTelemetrySectionDistanceUnit = .km,
        speed: ChargingTelemetrySectionSpeedUnit = .kmh,
        localeIdentifier: String = "en-US",
        decimalPrecision: Int? = nil
    ) {
        self.distance = distance
        self.speed = speed
        self.localeIdentifier = localeIdentifier
        self.decimalPrecision = decimalPrecision
    }

    /// Builds the preferences from the shared `MeasurementSystem` (web `useUnits`
    /// reading the user setting): imperial ⇒ mi + mph, metric ⇒ km + km/h.
    public init(
        _ system: MeasurementSystem,
        localeIdentifier: String = "en-US",
        decimalPrecision: Int? = nil
    ) {
        self.init(
            distance: ChargingTelemetrySectionDistanceUnit(system),
            speed: ChargingTelemetrySectionSpeedUnit(system),
            localeIdentifier: localeIdentifier,
            decimalPrecision: decimalPrecision
        )
    }

    /// The resolved `Locale` for the active identifier.
    public var locale: Locale {
        Locale(identifier: localeIdentifier)
    }

    /// Metric defaults (km + km/h) — the parity baseline.
    public static let metric = ChargingTelemetrySectionUnitPrefs(distance: .km, speed: .kmh)

    /// Imperial defaults (mi + mph).
    public static let imperial = ChargingTelemetrySectionUnitPrefs(distance: .mi, speed: .mph)
}

// MARK: - Number / SI formatting (ports of numberFormat.ts + unitConversion.ts)

/// Pure number + SI-distance + SI-speed formatting ported from the web helpers so the
/// rounding, the grouping separators, the conversion factors, and the per-quantity
/// precision defaults all match the source exactly. Locale is injectable so the output
/// is deterministic under test.
public enum ChargingTelemetrySectionFormat {
    /// The em-dash sentinel the web renders for a missing / non-finite value
    /// (`DEFAULT_EMPTY_DISPLAY`).
    public static let dash = "—"

    /// Metres in a kilometre / a statute mile (web `METERS_PER_KM` / `METERS_PER_MILE`).
    static let metersPerKm = 1000.0
    static let metersPerMile = 1609.344
    /// Seconds in an hour (web `SECONDS_PER_HOUR`).
    static let secondsPerHour = 3600.0

    /// Web per-quantity `DEFAULT_PRECISION` (the fallback when no user precision is set).
    static let defaultNumberPrecision = 2
    static let defaultDistancePrecision = 1
    static let defaultSpeedPrecision = 0

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `resolvePrecision`: a finite, non-negative user preference wins
    /// (floored), otherwise the per-quantity `fallback`.
    static func resolvePrecision(_ preference: Int?, fallback: Int) -> Int {
        guard let preference, preference >= 0 else { return fallback }
        return preference
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction digits,
    /// half-away rounding (web `toLocaleString` default), `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        let digits = max(0, decimals)
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `convertDistanceFromSI`: metres → km (÷1000) | mi (÷1609.344).
    static func convertDistance(_ meters: Double, to unit: ChargingTelemetrySectionDistanceUnit) -> Double {
        switch unit {
        case .km: meters / metersPerKm
        case .mi: meters / metersPerMile
        }
    }

    /// Native port of `convertSpeedFromSI`: m/s → km/h | mph (× 3600 ÷ unit metres).
    static func convertSpeed(_ mps: Double, to unit: ChargingTelemetrySectionSpeedUnit) -> Double {
        switch unit {
        case .kmh: (mps * secondsPerHour) / metersPerKm
        case .mph: (mps * secondsPerHour) / metersPerMile
        }
    }

    /// Native port of `formatDistance(meters, pref)` — SI metres formatted in the
    /// user's distance unit (`"12.3 km"`). Null / non-finite ⇒ the em-dash sentinel.
    public static func distance(
        _ meters: Double?,
        unit: ChargingTelemetrySectionDistanceUnit,
        precision: Int?,
        locale: Locale = .current
    ) -> String {
        guard let meters, meters.isFinite else { return dash }
        let digits = resolvePrecision(precision, fallback: defaultDistancePrecision)
        let value = convertDistance(meters, to: unit)
        return "\(number(value, decimals: digits, locale: locale)) \(unit.label)"
    }

    /// Native port of `formatSpeed(mps, pref)` — SI metres-per-second formatted in the
    /// user's speed unit (`"45 km/h"`). Null / non-finite ⇒ the em-dash sentinel.
    public static func speed(
        _ mps: Double?,
        unit: ChargingTelemetrySectionSpeedUnit,
        precision: Int?,
        locale: Locale = .current
    ) -> String {
        guard let mps, mps.isFinite else { return dash }
        let digits = resolvePrecision(precision, fallback: defaultSpeedPrecision)
        let value = convertSpeed(mps, to: unit)
        return "\(number(value, decimals: digits, locale: locale)) \(unit.label)"
    }
}
