//
//  ClimateSection.Adapter.swift
//  TeslaSync — P4 feature view · 0291 · ClimateSection (Apple)
//
//  The testable projection core for the Climate section — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/ClimateSection.tsx plus the web helper it
//  is fed by: `useUnits().formatTemperature` → `formatTemperature` / `convertTempFromSI`
//  (lib/unitConversion.ts). Everything here is pure + dependency-free (no store, no
//  bundle, no rendered view), so the reading model, the SI °C conversion, the eight card
//  projections (value + accent), and the VoiceOver summaries are all unit tested alone.
//
//  Parity notes (presentational leaf — formats verbatim, never rescales upstream):
//  temperature tiles run the SI °C formatter (`precision ?? 1`, em-dash when missing);
//  fan speed shows the raw integer preferring legacy `hvac_fan_status` over `fan_status`;
//  seat heaters render "Level {n}" (word resolved via the facade in the view); defrost
//  shows its raw mode verbatim when active else localized "Off"; climate-on reads
//  `is_ac_on ?? is_climate_on`. The icon-box accent mirrors the web `MetricCard` `color`
//  (green → success, cyan → info, purple → power); defrost / climate-on flip by state.
//

import Foundation
import SwiftUI

// MARK: - Reading (web `ClimateSnapshot` fields the section consumes)

/// The climate-snapshot fields the section renders — the native mirror of the web
/// `ClimateSnapshot` prop (only the members the component reads), including the legacy
/// column aliases the web coalesces over (`inside_temp` / `outside_temp` /
/// `driver_temp_setting` / `hvac_fan_status` / `is_ac_on`). Temperatures are SI °C;
/// every field is optional (the web `?? ` / `!= null` guards), matching the API
/// contract where the typed SI column or its pre-migration alias may be populated.
public struct ClimateSectionReading: Equatable, Sendable {
    // SI canonical columns (temperatures in °C). Optional per the web `!= null` guards.
    public var insideTempC: Double?
    public var outsideTempC: Double?
    public var driverSetpointC: Double?
    public var fanStatus: Int?
    public var seatHeaterLeft: Int?
    public var seatHeaterRight: Int?
    /// Raw backend defrost mode, shown verbatim when active (web `defrost_mode`).
    public var defrostMode: String?
    public var isClimateOn: Bool?

    // Legacy / compat-view aliases (pre-migration column names). The web coalesces the
    // alias over the canonical column (`alias ?? canonical`); reproduced verbatim.
    public var insideTemp: Double?
    public var outsideTemp: Double?
    public var driverTempSetting: Double?
    public var hvacFanStatus: Int?
    public var isAcOn: Bool?

    public init(
        insideTempC: Double? = nil,
        outsideTempC: Double? = nil,
        driverSetpointC: Double? = nil,
        fanStatus: Int? = nil,
        seatHeaterLeft: Int? = nil,
        seatHeaterRight: Int? = nil,
        defrostMode: String? = nil,
        isClimateOn: Bool? = nil,
        insideTemp: Double? = nil,
        outsideTemp: Double? = nil,
        driverTempSetting: Double? = nil,
        hvacFanStatus: Int? = nil,
        isAcOn: Bool? = nil
    ) {
        self.insideTempC = insideTempC
        self.outsideTempC = outsideTempC
        self.driverSetpointC = driverSetpointC
        self.fanStatus = fanStatus
        self.seatHeaterLeft = seatHeaterLeft
        self.seatHeaterRight = seatHeaterRight
        self.defrostMode = defrostMode
        self.isClimateOn = isClimateOn
        self.insideTemp = insideTemp
        self.outsideTemp = outsideTemp
        self.driverTempSetting = driverTempSetting
        self.hvacFanStatus = hvacFanStatus
        self.isAcOn = isAcOn
    }

    /// The displayed values: the web coalesces the legacy alias over the canonical
    /// column (`alias ?? canonical`); reproduced verbatim.
    var resolvedInsideTemp: Double? {
        insideTemp ?? insideTempC
    }

    var resolvedOutsideTemp: Double? {
        outsideTemp ?? outsideTempC
    }

    var resolvedDriverSetpoint: Double? {
        driverTempSetting ?? driverSetpointC
    }

    var resolvedFanStatus: Int? {
        hvacFanStatus ?? fanStatus
    }

    var resolvedClimateOn: Bool {
        isAcOn ?? isClimateOn ?? false
    }

    /// Whether defrost is active: a mode is present and not the literal "Off"
    /// (web `defrost_mode && defrost_mode !== 'Off'`).
    var defrostIsActive: Bool {
        guard let mode = defrostMode else { return false }
        return mode != ClimateSectionFormat.offMode
    }
}

// MARK: - Temperature unit (web `TemperatureUnitPref` + `convertTempFromSI`)

/// The display temperature unit — the native mirror of the web `TemperatureUnitPref`.
/// Resolves the unit symbol and the SI °C → unit conversion exactly as
/// `convertTempFromSI` (lib/unitConversion.ts) does.
public enum ClimateSectionTemperatureUnit: String, Sendable, Equatable, CaseIterable {
    case celsius
    case fahrenheit

    /// The unit symbol appended directly after the number, no space (web `°unit`).
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

/// The slice of the user's `useUnits` preferences the section needs — the display
/// temperature unit plus the optional precision / locale / empty sentinel that drive
/// the SI temperature formatter. Mirrors the web `UnitPref` members
/// `formatTemperature` reads. Defaults reproduce the web SI/metric defaults.
public struct ClimateSectionUnits: Equatable, Sendable {
    public var temperature: ClimateSectionTemperatureUnit
    public var precision: Int?
    public var locale: String?
    public var emptyDisplay: String?

    public init(
        temperature: ClimateSectionTemperatureUnit = .celsius,
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
    public static let metric = ClimateSectionUnits(temperature: .celsius)
    /// Imperial display defaults (°F).
    public static let imperial = ClimateSectionUnits(temperature: .fahrenheit)

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
        emptyDisplay ?? ClimateSectionFormat.dash
    }
}

// MARK: - Temperature formatting (port of unitConversion.ts `formatTemperature`)

/// Pure temperature formatting ported from the web `formatTemperature` so the rounding,
/// the grouping separators, the °unit no-space rule, and the SI conversion match the
/// source exactly. The web temperature default precision is 1, and a non-finite /
/// missing input renders the empty sentinel.
public enum ClimateSectionFormat {
    /// The em-dash sentinel the web renders for a missing/non-applicable value.
    public static let dash = "—"
    /// The web `defrost_mode` value treated as "inactive" (matched verbatim).
    public static let offMode = "Off"
    /// Web `DEFAULT_PRECISION.temperature` (the temperature tiles' fraction digits).
    public static let defaultTemperaturePrecision = 1

    /// Native port of `formatNumber(value, locale, digits)`: locale grouping, fixed
    /// fraction digits, half-away-from-zero rounding (the `Intl.NumberFormat` default).
    public static func number(_ value: Double, decimals: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value.isFinite ? value : 0)) ?? "0"
    }

    /// Native port of `formatTemperature(celsius, pref)`: a `nil` / non-finite input
    /// yields the empty sentinel; otherwise convert SI °C to the display unit and
    /// format at the temperature precision (`pref.precision ?? 1`) with the unit
    /// symbol appended directly (no space, the typographic convention).
    public static func temperature(celsius: Double?, units: ClimateSectionUnits) -> String {
        guard let celsius, celsius.isFinite else { return units.resolvedEmpty }
        let digits = units.precision ?? defaultTemperaturePrecision
        let value = units.temperature.fromCelsius(celsius)
        return number(value, decimals: digits, locale: units.resolvedLocale) + units.temperature.symbol
    }
}

// MARK: - Accent (web `MetricCard` `color` → semantic token)

/// The icon-box accent for a tile — the native mirror of the web `MetricCard` `color`
/// prop (the only thing `color` tints is the icon chip's bg / ring / glyph). The web
/// palette used here is green / cyan / purple; mapped to the shared semantic tokens so
/// the hex map lives once, in tokens.
public enum ClimateSectionAccent: String, Sendable, Equatable, CaseIterable {
    /// Web `color="green"` → success token.
    case success
    /// Web `color="cyan"` → info token (the cyan brand accent).
    case info
    /// Web `color="purple"` → the power chart-series token (the closest purple).
    case power

    /// The resolved colour for the icon glyph + its tinted chip.
    public var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .info: Color.TS.statusInfo
        case .power: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Metric kind (the eight web `MetricCard`s)

/// The eight climate metrics the section renders, in web composition order. The kind
/// drives the i18n label and the SF Symbol (resolved in the view); the value + accent
/// are computed by the projection.
public enum ClimateSectionMetricKind: String, Sendable, Equatable, CaseIterable {
    case insideTemp
    case outsideTemp
    case driverSetpoint
    case fanSpeed
    case seatHeaterLeft
    case seatHeaterRight
    case defrost
    case climateOn

    /// The i18n key for the tile label (web `t(key, default)`).
    public var labelKey: String {
        switch self {
        case .insideTemp: "common.insideTemp"
        case .outsideTemp: "common.outsideTemp"
        case .driverSetpoint: "vehicles.detail.driverSetpoint"
        case .fanSpeed: "vehicles.detail.fanSpeed"
        case .seatHeaterLeft: "vehicles.detail.seatHeaterL"
        case .seatHeaterRight: "vehicles.detail.seatHeaterR"
        case .defrost: "vehicles.detail.defrost"
        case .climateOn: "vehicles.detail.climateOn"
        }
    }

    /// The web English fallback for the tile label.
    public var labelFallback: String {
        switch self {
        case .insideTemp: "Inside Temp"
        case .outsideTemp: "Outside Temp"
        case .driverSetpoint: "Driver Setpoint"
        case .fanSpeed: "Fan Speed"
        case .seatHeaterLeft: "Seat Heater Left"
        case .seatHeaterRight: "Seat Heater Right"
        case .defrost: "Defrost"
        case .climateOn: "Climate On"
        }
    }

    /// The SF Symbol mirroring the web lucide glyph (Thermometer / Wind / CircleDot /
    /// Snowflake / Flame).
    public var systemImage: String {
        switch self {
        case .insideTemp, .outsideTemp, .driverSetpoint: "thermometer.medium"
        case .fanSpeed: "wind"
        case .seatHeaterLeft, .seatHeaterRight: "smallcircle.filled.circle"
        case .defrost: "snowflake"
        case .climateOn: "flame.fill"
        }
    }
}

// MARK: - Value (the resolved per-tile content, before i18n)

/// The semantic value of one tile — kept abstract so the i18n-dependent variants
/// (`Level {n}`, `On`/`Off`) resolve through the facade in the view, while the
/// locale-independent variants (formatted temperatures, the raw fan integer, the raw
/// defrost mode) carry their final text. Unit tested directly (no rendering needed).
public enum ClimateSectionValue: Equatable, Sendable {
    /// A finished, locale-independent string (a formatted temperature, the fan
    /// integer, or the raw active defrost mode shown verbatim).
    case measurement(String)
    /// A missing/non-applicable value → the view renders the em-dash.
    case missing
    /// A seat-heater level → the view renders "{Level} {n}" via the i18n facade.
    case seatLevel(Int)
    /// A boolean climate flag → the view renders the localized "On" / "Off".
    case onOff(Bool)
}

// MARK: - Card (one projected tile: kind + value + accent)

/// The view-ready projection of one tile — its kind (label + icon), its semantic
/// value, and its icon-box accent. `Identifiable` over the kind so the grid is stable.
public struct ClimateSectionCard: Identifiable, Equatable, Sendable {
    public var id: ClimateSectionMetricKind {
        kind
    }

    public let kind: ClimateSectionMetricKind
    public let value: ClimateSectionValue
    public let accent: ClimateSectionAccent

    public init(kind: ClimateSectionMetricKind, value: ClimateSectionValue, accent: ClimateSectionAccent) {
        self.kind = kind
        self.value = value
        self.accent = accent
    }
}

// MARK: - Projection (web render values for the eight `MetricCard`s)

/// The resolved, view-ready set of the eight tiles — a pure function of one reading +
/// the user's unit preferences, reproducing each web `MetricCard`'s value expression
/// and `color` prop. The view switches over `cards` so it holds no formatting logic.
public struct ClimateSectionProjection: Equatable, Sendable {
    public let cards: [ClimateSectionCard]

    public init(cards: [ClimateSectionCard]) {
        self.cards = cards
    }

    /// Builds the eight tiles from a reading + unit preferences — the native port of
    /// the web component's per-card expressions (the three temperature tiles, the fan
    /// integer, the two seat-heater levels, the defrost mode, and the climate-on flag),
    /// including the green↔cyan accent flip the defrost / climate tiles do by state.
    public static func make(reading: ClimateSectionReading, units: ClimateSectionUnits) -> ClimateSectionProjection {
        func temp(_ celsius: Double?) -> ClimateSectionValue {
            .measurement(ClimateSectionFormat.temperature(celsius: celsius, units: units))
        }

        let fan: ClimateSectionValue = reading.resolvedFanStatus.map { .measurement(String($0)) } ?? .missing
        let seatLeft: ClimateSectionValue = reading.seatHeaterLeft.map { .seatLevel($0) } ?? .missing
        let seatRight: ClimateSectionValue = reading.seatHeaterRight.map { .seatLevel($0) } ?? .missing

        let defrostActive = reading.defrostIsActive
        let defrostValue: ClimateSectionValue = defrostActive
            ? .measurement(reading.defrostMode ?? ClimateSectionFormat.offMode)
            : .onOff(false)
        let climateOn = reading.resolvedClimateOn

        return ClimateSectionProjection(cards: [
            ClimateSectionCard(kind: .insideTemp, value: temp(reading.resolvedInsideTemp), accent: .success),
            ClimateSectionCard(kind: .outsideTemp, value: temp(reading.resolvedOutsideTemp), accent: .info),
            ClimateSectionCard(kind: .driverSetpoint, value: temp(reading.resolvedDriverSetpoint), accent: .power),
            ClimateSectionCard(kind: .fanSpeed, value: fan, accent: .info),
            ClimateSectionCard(kind: .seatHeaterLeft, value: seatLeft, accent: .success),
            ClimateSectionCard(kind: .seatHeaterRight, value: seatRight, accent: .success),
            ClimateSectionCard(kind: .defrost, value: defrostValue, accent: defrostActive ? .success : .info),
            ClimateSectionCard(kind: .climateOn, value: .onOff(climateOn), accent: climateOn ? .success : .info)
        ])
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the combined VoiceOver phrase for a labelled tile from its already-resolved
/// display strings. Pure + public so the spoken content is asserted without rendering
/// the view; empty fragments are dropped so the phrase never reads a stray comma.
public enum ClimateSectionAccessibility {
    public static func tileSummary(label: String, value: String) -> String {
        [label, value].filter { !$0.isEmpty }.joined(separator: ", ")
    }
}
