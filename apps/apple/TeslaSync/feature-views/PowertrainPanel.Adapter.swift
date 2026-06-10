//
//  PowertrainPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0283 · PowertrainPanel (Apple)
//
//  The testable projection core for the Powertrain telemetry panel — the SwiftUI
//  parity of features/vehicles/components/telemetry-panels/PowertrainPanel.tsx plus
//  the web helpers it is fed by: `fmtNumber` / `fmtInt` (lib/numberFormat.ts) and
//  `useUnits().formatTemperature` → `formatTemperature` / `convertTempFromSI`
//  (lib/unitConversion.ts). Everything here is pure + dependency-free (no store, no
//  bundle, no rendered view, no KMP `Shared`), so the reading model, the formatting,
//  the SI °C conversion, the shift colour branch, the power-bar geometry, and the
//  per-field strings are all unit tested in isolation.
//
//  Parity notes (presentational leaf — formats verbatim, never rescales upstream):
//    • Power appends the "kW" label even when missing (web `{… ?? '—'} kW` ⇒ "— kW").
//    • RPM uses `fmtInt` (0-decimal); torque uses `fmtNumber` (2-decimal) + "Nm".
//    • Motor Temp (peak) is `max(front, rear)` over the SI °C readings (a missing side
//      is −∞ ⇒ both-missing renders the em-dash); the >80 hot branch tests the SI value
//      before conversion. Inverter Temp runs the same formatter (em-dash when missing).
//

import Foundation

// MARK: - Reading (web `MotorSnapshot` fields the panel consumes)

/// The motor-telemetry fields the panel renders — the native mirror of the web
/// `MotorSnapshot` prop (only the members the component reads). Every numeric field is
/// SI (°C, kW, Nm; rpm is the upstream's non-SI axle speed) and optional (the web
/// `… != null` guards), matching the API contract.
public struct PowertrainReading: Equatable, Sendable {
    /// Raw backend gear/shift string, shown verbatim (web `shift_state`).
    public var shiftState: String?
    /// Mechanical power in kilowatts, SI canonical (web `power_kw`). Drive only.
    public var powerKw: Double?
    /// Front-axle speed in rpm, the upstream non-SI value (web `motor_rpm_front`).
    public var motorRpmFront: Double?
    /// Rear-axle speed in rpm, the upstream non-SI value (web `motor_rpm_rear`).
    public var motorRpmRear: Double?
    /// Front-axle torque in newton-metres (web `torque_nm_front`).
    public var torqueNmFront: Double?
    /// Rear-axle torque in newton-metres (web `torque_nm_rear`).
    public var torqueNmRear: Double?
    /// Front motor temperature in °C, SI (web `motor_temp_c_front`).
    public var motorTempCFront: Double?
    /// Rear motor temperature in °C, SI (web `motor_temp_c_rear`).
    public var motorTempCRear: Double?
    /// Inverter temperature in °C, SI (web `inverter_temp_c`).
    public var inverterTempC: Double?
    /// Regen power in kilowatts, SI; always non-negative (web `regen_kw`).
    public var regenKw: Double?

    public init(
        shiftState: String? = nil,
        powerKw: Double? = nil,
        motorRpmFront: Double? = nil,
        motorRpmRear: Double? = nil,
        torqueNmFront: Double? = nil,
        torqueNmRear: Double? = nil,
        motorTempCFront: Double? = nil,
        motorTempCRear: Double? = nil,
        inverterTempC: Double? = nil,
        regenKw: Double? = nil
    ) {
        self.shiftState = shiftState
        self.powerKw = powerKw
        self.motorRpmFront = motorRpmFront
        self.motorRpmRear = motorRpmRear
        self.torqueNmFront = torqueNmFront
        self.torqueNmRear = torqueNmRear
        self.motorTempCFront = motorTempCFront
        self.motorTempCRear = motorTempCRear
        self.inverterTempC = inverterTempC
        self.regenKw = regenKw
    }
}

// MARK: - Shift-state badge (web colour branch)

/// The shift-state pill accent — the native mirror of the web ternary
/// `D → green : R → red : N → amber : else → muted`. The raw backend label is carried
/// separately and shown verbatim; this only picks the tone.
public enum PowertrainShiftBadge: String, Sendable, Equatable, CaseIterable {
    /// `shift_state === 'D'` → green accent.
    case drive
    /// `shift_state === 'R'` → red accent.
    case reverse
    /// `shift_state === 'N'` → amber accent.
    case neutral
    /// Any other value (incl. `P` / `nil`) → muted accent.
    case other

    /// The web shift value that maps to `drive` (matched verbatim).
    public static let driveValue = "D"
    /// The web shift value that maps to `reverse` (matched verbatim).
    public static let reverseValue = "R"
    /// The web shift value that maps to `neutral` (matched verbatim).
    public static let neutralValue = "N"

    /// Maps a raw backend `shift_state` to a badge tone, falling back to ``other`` for
    /// any value outside the three coloured cases (incl. `nil`).
    public static func from(_ raw: String?) -> PowertrainShiftBadge {
        switch raw {
        case driveValue: .drive
        case reverseValue: .reverse
        case neutralValue: .neutral
        default: .other
        }
    }
}

// MARK: - Temperature unit (web `TemperatureUnitPref` + `convertTempFromSI`)

/// The display temperature unit — the native mirror of the web `TemperatureUnitPref`.
/// Resolves the unit symbol and the SI °C → unit conversion exactly as
/// `convertTempFromSI` (lib/unitConversion.ts) does.
public enum PowertrainTemperatureUnit: String, Sendable, Equatable, CaseIterable {
    case celsius
    case fahrenheit

    /// The unit symbol appended directly after the number, no space (web `pref.temperature`).
    public var symbol: String {
        switch self {
        case .celsius: "°C"
        case .fahrenheit: "°F"
        }
    }

    /// Port of `convertTempFromSI(celsius, to)`: `°C` is identity, `°F = c * 9/5 + 32`.
    public func fromCelsius(_ celsius: Double) -> Double {
        switch self {
        case .celsius: celsius
        case .fahrenheit: celsius * 9 / 5 + 32
        }
    }

    /// Resolves a web `TemperatureUnitPref` symbol ("°C" / "°F") to a unit, defaulting
    /// to `celsius` (the web SI/metric default) for anything else.
    public init(symbol: String) {
        self = symbol == "°F" ? .fahrenheit : .celsius
    }
}

// MARK: - Units (the `useUnits` projection this surface needs)

/// The slice of the user's `useUnits` preferences the panel needs — the display
/// temperature unit plus the optional precision / locale / empty sentinel that drive
/// the SI formatters. Mirrors the web `UnitPref` members the component's
/// `formatTemperature` call reads. Defaults reproduce the web SI/metric defaults.
public struct PowertrainUnits: Equatable, Sendable {
    public var temperature: PowertrainTemperatureUnit
    public var precision: Int?
    public var locale: String?
    public var emptyDisplay: String?

    public init(
        temperature: PowertrainTemperatureUnit = .celsius,
        precision: Int? = nil,
        locale: String? = nil,
        emptyDisplay: String? = nil
    ) {
        self.temperature = temperature
        self.precision = precision
        self.locale = locale
        self.emptyDisplay = emptyDisplay
    }

    /// Metric display defaults (°C).
    public static let metric = PowertrainUnits(temperature: .celsius)
    /// Imperial display defaults (°F).
    public static let imperial = PowertrainUnits(temperature: .fahrenheit)

    /// The resolved formatting locale — the configured tag, else `en_US` (the web
    /// `setGlobalLocale` fallback for empty/invalid tags).
    var resolvedLocale: Locale {
        guard let locale, !locale.trimmingCharacters(in: .whitespaces).isEmpty else {
            return Locale(identifier: "en_US")
        }
        return Locale(identifier: locale)
    }

    /// The empty sentinel for a missing value (web `pref.emptyDisplay ?? '—'`).
    var resolvedEmpty: String {
        emptyDisplay ?? PowertrainFormat.dash
    }
}

// MARK: - Number / temperature formatting (ports of numberFormat.ts + unitConversion.ts)

/// Pure number + temperature formatting ported from the web helpers so the rounding,
/// the grouping separators, and the SI conversion match the source exactly. The web
/// global number precision is 2, the integer precision is 0, and the temperature
/// precision default is 1; `safeNumber` coerces non-finite input to 0.
public enum PowertrainFormat {
    /// The em-dash sentinel the web renders for a missing/non-applicable value.
    public static let dash = "—"

    /// Web global precision for `fmtNumber` (power / torque / regen values).
    public static let defaultNumberPrecision = 2
    /// Web `fmtInt` precision (front / rear rpm values).
    public static let integerPrecision = 0
    /// Web `DEFAULT_PRECISION.temperature` (motor / inverter temperature values).
    public static let defaultTemperaturePrecision = 1

    /// The bipolar power-bar full scale in kW (web `±300` axis denominator).
    public static let powerScaleKw = 300.0

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

    /// Native port of `fmtInt(v)` — `fmtNumber(v, 0)`, locale-grouped integer.
    public static func integer(_ value: Double, locale: Locale) -> String {
        number(value, decimals: integerPrecision, locale: locale)
    }

    /// Native port of `formatTemperature(celsius, pref)` (lib/unitConversion.ts): a
    /// `nil` / non-finite input yields the empty sentinel; otherwise convert SI °C to
    /// the display unit and format at the temperature precision (`pref.precision ?? 1`)
    /// with the unit symbol appended directly (no space, the typographic convention).
    public static func temperature(celsius: Double?, units: PowertrainUnits) -> String {
        guard let celsius, celsius.isFinite else { return units.resolvedEmpty }
        let digits = units.precision ?? defaultTemperaturePrecision
        let value = units.temperature.fromCelsius(celsius)
        return number(value, decimals: digits, locale: units.resolvedLocale) + units.temperature.symbol
    }
}

// MARK: - Power bar (web bipolar `±300` meter geometry)

/// The resolved geometry for the bipolar power bar — the native mirror of the web
/// fill that anchors at the centre and extends toward the drive (`>= 0`) or regen
/// (`< 0`) side. `fillFraction` is a fraction of the full track width (web
/// `min(|p|/300, 1) * 0.5`, i.e. at most half the track). `nil` upstream power renders
/// no fill (web only draws the fill when `power_kw != null`).
public struct PowertrainPowerBar: Equatable, Sendable {
    /// Drive (`power_kw >= 0`) extends right with the success tone; regen extends left
    /// with the danger tone.
    public let isPositive: Bool
    /// The fill length as a fraction of the full track width (0 … 0.5).
    public let fillFraction: Double

    public init(isPositive: Bool, fillFraction: Double) {
        self.isPositive = isPositive
        self.fillFraction = fillFraction
    }

    /// Builds the bar geometry from a kilowatt reading: the sign picks the side/tone
    /// and the magnitude is clamped to the `±300` full scale, halved so it never
    /// crosses the centre divider (web `min(|p|/300 * 50, 50)%`).
    public static func make(powerKw: Double, scaleKw: Double = PowertrainFormat.powerScaleKw) -> PowertrainPowerBar {
        let clamped = min(abs(powerKw) / scaleKw, 1.0)
        return PowertrainPowerBar(isPositive: powerKw >= 0, fillFraction: clamped * 0.5)
    }
}

// MARK: - Projection (web render values: the pill, the bar, the cards, the rows)

/// The resolved, view-ready display strings for one motor reading — the native mirror
/// of the panel's per-field formatting. Every value is pre-formatted so the view is a
/// pure function of this projection; the unit symbols ("kW", "Nm", "RPM") are SI
/// literals (locale-independent), matching the web source.
public struct PowertrainProjection: Equatable, Sendable {
    /// The raw backend shift label (web `shift_state`), shown verbatim when present;
    /// `nil` means the view shows the localized "Unknown" fallback.
    public let shiftStateRawLabel: String?
    public let shiftBadge: PowertrainShiftBadge
    /// The power value with the always-appended "kW" label (web `{… ?? '—'} kW`).
    public let powerText: String
    /// The bipolar bar geometry, or `nil` when `power_kw` is missing (no fill drawn).
    public let powerBar: PowertrainPowerBar?
    /// The "-300" / "0" / "+300" power-axis scale markers (locale-formatted).
    public let powerAxisMinText: String
    public let powerAxisMidText: String
    public let powerAxisMaxText: String
    public let rpmFrontText: String
    public let rpmRearText: String
    public let torqueFrontText: String
    public let torqueRearText: String
    public let motorTempText: String
    /// Whether the peak motor temperature exceeds the 80 °C hot threshold (web red branch).
    public let motorTempIsHot: Bool
    public let inverterTempText: String
    public let regenText: String

    public init(
        shiftStateRawLabel: String?,
        shiftBadge: PowertrainShiftBadge,
        powerText: String,
        powerBar: PowertrainPowerBar?,
        powerAxisMinText: String,
        powerAxisMidText: String,
        powerAxisMaxText: String,
        rpmFrontText: String,
        rpmRearText: String,
        torqueFrontText: String,
        torqueRearText: String,
        motorTempText: String,
        motorTempIsHot: Bool,
        inverterTempText: String,
        regenText: String
    ) {
        self.shiftStateRawLabel = shiftStateRawLabel
        self.shiftBadge = shiftBadge
        self.powerText = powerText
        self.powerBar = powerBar
        self.powerAxisMinText = powerAxisMinText
        self.powerAxisMidText = powerAxisMidText
        self.powerAxisMaxText = powerAxisMaxText
        self.rpmFrontText = rpmFrontText
        self.rpmRearText = rpmRearText
        self.torqueFrontText = torqueFrontText
        self.torqueRearText = torqueRearText
        self.motorTempText = motorTempText
        self.motorTempIsHot = motorTempIsHot
        self.inverterTempText = inverterTempText
        self.regenText = regenText
    }

    /// Builds the display projection from a reading + the user's unit preferences — the
    /// native port of the web component's per-field formatting. Non-temperature numbers
    /// use the global precision (`precision ?? 2`), rpm uses `fmtInt` (0), temperatures
    /// run the SI temperature formatter (`precision ?? 1`), and every missing value
    /// renders the em-dash (web literal `'—'`).
    public static func make(reading: PowertrainReading, units: PowertrainUnits) -> PowertrainProjection {
        let decimals = units.precision ?? PowertrainFormat.defaultNumberPrecision
        let locale = units.resolvedLocale
        let dash = PowertrainFormat.dash

        func numberOrDash(_ value: Double?) -> String {
            guard let value else { return dash }
            return PowertrainFormat.number(value, decimals: decimals, locale: locale)
        }

        func intOrDash(_ value: Double?) -> String {
            guard let value else { return dash }
            return PowertrainFormat.integer(value, locale: locale)
        }

        // Power: the "kW" label is appended even for a missing value (web `{…} kW`).
        let powerValue = reading.powerKw.map { PowertrainFormat.number($0, decimals: decimals, locale: locale) } ?? dash
        let powerText = powerValue + " kW"
        let powerBar = reading.powerKw.map { PowertrainPowerBar.make(powerKw: $0) }

        // Peak motor temperature: max over the SI °C readings (a missing side is −∞).
        let front = reading.motorTempCFront ?? -.infinity
        let rear = reading.motorTempCRear ?? -.infinity
        let peak = Swift.max(front, rear)
        let hasPeak = peak.isFinite
        let motorTempText = hasPeak ? PowertrainFormat.temperature(celsius: peak, units: units) : dash
        let motorTempIsHot = hasPeak && peak > 80

        let regenText = reading.regenKw
            .map { PowertrainFormat.number($0, decimals: decimals, locale: locale) + " kW" } ?? dash

        return PowertrainProjection(
            shiftStateRawLabel: reading.shiftState,
            shiftBadge: .from(reading.shiftState),
            powerText: powerText,
            powerBar: powerBar,
            powerAxisMinText: PowertrainFormat.integer(-PowertrainFormat.powerScaleKw, locale: locale),
            powerAxisMidText: PowertrainFormat.integer(0, locale: locale),
            powerAxisMaxText: "+" + PowertrainFormat.integer(PowertrainFormat.powerScaleKw, locale: locale),
            rpmFrontText: intOrDash(reading.motorRpmFront),
            rpmRearText: intOrDash(reading.motorRpmRear),
            torqueFrontText: numberOrDash(reading.torqueNmFront),
            torqueRearText: numberOrDash(reading.torqueNmRear),
            motorTempText: motorTempText,
            motorTempIsHot: motorTempIsHot,
            inverterTempText: PowertrainFormat.temperature(celsius: reading.inverterTempC, units: units),
            regenText: regenText
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary for the panel from already-localized parts, so the
/// spoken content is asserted without rendering the view.
public enum PowertrainAccessibility {
    /// The panel's spoken summary: "{shift}, {power}, {regen}".
    public static func summary(shift: String, power: String, regen: String) -> String {
        "\(shift), \(power), \(regen)"
    }
}
