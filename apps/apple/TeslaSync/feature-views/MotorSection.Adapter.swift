//
//  MotorSection.Adapter.swift
//  TeslaSync — P4 feature view · 0293 · MotorSection (Apple)
//
//  The pure (Foundation-only) value types for the vehicle-detail "Powertrain" surface —
//  the SwiftUI parity of features/vehicles/components/vehicle-detail/MotorSection.tsx.
//  This file holds the reading model, the display-unit preferences, the icon-box accent,
//  the metric-kind catalog, the projected card, and the VoiceOver summary. The numeric
//  ports (`fmtNumber` / `fmtInt` / `formatTemperature`) and the projection live in
//  MotorSection.Projector.swift; the render-phase resolver lives in MotorSection.Model.swift;
//  the SwiftUI chrome + the accent→Color mapping layer on top in the .Views.swift / .swift
//  files. Everything here is dependency-free so every value can be pinned by unit tests
//  without a bundle or a rendered view.
//
//  Parity notes (presentational leaf — formats verbatim, never rescales upstream):
//  the pack-voltage tile reads `vbat_rear ?? vbat_front`; the peak motor-temperature
//  tile reads `max(motor_temp_c_front ?? -∞, motor_temp_c_rear ?? -∞)` and renders the
//  em-dash unless that maximum is finite (web `maxMotorTemp != null && isFinite`). The
//  icon-box accent mirrors the web `MetricCard` `color` (green → success, cyan → info,
//  purple → power).
//

import Foundation

// MARK: - Reading (web `MotorSnapshot` fields the section consumes)

/// The motor-snapshot fields the section renders — the native mirror of the web
/// `MotorSnapshot` prop (only the members the component reads). Torques are newton-metres
/// (SI), currents amperes (SI), voltages volts (SI), temperatures °C (SI), and the two
/// axle speeds are rpm; every field is optional (the web `?? ` / `!= null` guards),
/// matching the handler contract where a field with no backing signal is omitted.
public struct MotorSectionReading: Equatable, Sendable {
    public var shiftState: String?
    public var vbatFront: Double?
    public var vbatRear: Double?
    public var motorCurrentFront: Double?
    public var torqueNmFront: Double?
    public var torqueNmRear: Double?
    public var motorRpmFront: Double?
    public var motorRpmRear: Double?
    public var motorTempCFront: Double?
    public var motorTempCRear: Double?

    public init(
        shiftState: String? = nil,
        vbatFront: Double? = nil,
        vbatRear: Double? = nil,
        motorCurrentFront: Double? = nil,
        torqueNmFront: Double? = nil,
        torqueNmRear: Double? = nil,
        motorRpmFront: Double? = nil,
        motorRpmRear: Double? = nil,
        motorTempCFront: Double? = nil,
        motorTempCRear: Double? = nil
    ) {
        self.shiftState = shiftState
        self.vbatFront = vbatFront
        self.vbatRear = vbatRear
        self.motorCurrentFront = motorCurrentFront
        self.torqueNmFront = torqueNmFront
        self.torqueNmRear = torqueNmRear
        self.motorRpmFront = motorRpmFront
        self.motorRpmRear = motorRpmRear
        self.motorTempCFront = motorTempCFront
        self.motorTempCRear = motorTempCRear
    }

    /// The pack-voltage value: the web `vbat_rear ?? vbat_front` (the rear inverter bus
    /// preferred over the front), reproduced verbatim.
    var resolvedVbat: Double? {
        vbatRear ?? vbatFront
    }

    /// The peak motor temperature in SI °C: the web
    /// `Math.max(motor_temp_c_front ?? -Infinity, motor_temp_c_rear ?? -Infinity)`
    /// followed by the `isFinite` guard — `nil` when neither motor reported (so the tile
    /// shows the em-dash) and the hotter of the two otherwise.
    var maxMotorTempC: Double? {
        let front = motorTempCFront ?? -.infinity
        let rear = motorTempCRear ?? -.infinity
        let peak = Swift.max(front, rear)
        return peak.isFinite ? peak : nil
    }
}

// MARK: - Temperature unit (web `TemperatureUnitPref` + `convertTempFromSI`)

/// The display temperature unit — the native mirror of the web `TemperatureUnitPref`.
/// Resolves the unit symbol and the SI °C → unit conversion exactly as
/// `convertTempFromSI` (lib/unitConversion.ts) does.
public enum MotorSectionTemperatureUnit: String, Sendable, Equatable, CaseIterable {
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

/// The slice of the user's `useUnits` / settings preferences the section needs — the
/// display temperature unit, the decimal precision (web `settings.decimal_precision`,
/// the global precision `fmtNumber` reads), the formatting locale, and the empty
/// sentinel. Defaults reproduce the web SI/metric defaults.
public struct MotorSectionUnits: Equatable, Sendable {
    public var temperature: MotorSectionTemperatureUnit
    public var decimalPrecision: Int?
    public var locale: String?
    public var emptyDisplay: String?

    public init(
        temperature: MotorSectionTemperatureUnit = .celsius,
        decimalPrecision: Int? = nil,
        locale: String? = nil,
        emptyDisplay: String? = nil
    ) {
        self.temperature = temperature
        self.decimalPrecision = decimalPrecision
        self.locale = locale
        self.emptyDisplay = emptyDisplay
    }

    /// Metric display defaults (°C).
    public static let metric = MotorSectionUnits(temperature: .celsius)
    /// Imperial display defaults (°F).
    public static let imperial = MotorSectionUnits(temperature: .fahrenheit)

    /// Fraction digits for the `fmtNumber` tiles (voltage / current / torque): the web
    /// global precision, which defaults to 2 when no settings preference is set.
    var numberPrecision: Int {
        decimalPrecision ?? MotorSectionFormat.defaultNumberPrecision
    }

    /// Fraction digits for the temperature tile: the web `pref.precision` with the
    /// `DEFAULT_PRECISION.temperature` (1) fallback.
    var temperaturePrecision: Int {
        decimalPrecision ?? MotorSectionFormat.defaultTemperaturePrecision
    }

    /// The resolved formatting locale — the configured tag, else `en_US` (the web
    /// `setGlobalLocale` fallback for empty/invalid tags).
    var resolvedLocale: Locale {
        guard let locale, !locale.trimmingCharacters(in: .whitespaces).isEmpty else {
            return Locale(identifier: "en_US")
        }
        return Locale(identifier: locale)
    }

    /// The empty sentinel for a missing value (web `'—'`).
    var resolvedEmpty: String {
        emptyDisplay ?? MotorSectionFormat.dash
    }
}

// MARK: - Accent (web `MetricCard` `color` → semantic token)

/// The icon-box accent for a tile — the native mirror of the web `MetricCard` `color`
/// prop (the only thing `color` tints is the icon chip's bg / ring / glyph). The web
/// palette used by MotorSection is green / cyan / purple; this enum stays Foundation-only
/// and is mapped to the shared design-system colour at the view boundary (.Views.swift),
/// so the classifier remains bundle-free testable.
public enum MotorSectionAccent: String, Sendable, Equatable, CaseIterable {
    /// Web `color="green"` → success token.
    case success
    /// Web `color="cyan"` → info token (the cyan brand accent).
    case info
    /// Web `color="purple"` → the power chart-series token (the closest purple).
    case power
}

// MARK: - Metric kind (the eight web `MetricCard`s)

/// The eight powertrain metrics the section renders, in web composition order. The kind
/// drives the i18n label, the SF Symbol, and the icon-box accent; the value is computed
/// by the projection.
public enum MotorSectionMetricKind: String, Sendable, Equatable, CaseIterable {
    case shiftState
    case packVoltage
    case motorCurrentFront
    case torqueFront
    case torqueRear
    case rpmFront
    case rpmRear
    case motorTemp

    /// The i18n key for the tile label (web `t(key, default)`).
    public var labelKey: String {
        switch self {
        case .shiftState: "vehicles.detail.shiftState"
        case .packVoltage: "vehicles.detail.packVoltage"
        case .motorCurrentFront: "vehicles.detail.motorCurrentFront"
        case .torqueFront: "vehicles.detail.torqueFront"
        case .torqueRear: "vehicles.detail.torqueRear"
        case .rpmFront: "vehicles.detail.rpmFront"
        case .rpmRear: "vehicles.detail.rpmRear"
        case .motorTemp: "vehicles.detail.motorTemp"
        }
    }

    /// The web English fallback for the tile label.
    public var labelFallback: String {
        switch self {
        case .shiftState: "Shift State"
        case .packVoltage: "Pack Voltage"
        case .motorCurrentFront: "Motor Current (F)"
        case .torqueFront: "Front Torque"
        case .torqueRear: "Rear Torque"
        case .rpmFront: "Front RPM"
        case .rpmRear: "Rear RPM"
        case .motorTemp: "Motor Temp (peak)"
        }
    }

    /// The SF Symbol mirroring the web lucide glyph (Settings / Battery / Zap / Activity /
    /// Gauge / Thermometer).
    public var systemImage: String {
        switch self {
        case .shiftState: "gearshape.fill"
        case .packVoltage: "battery.100"
        case .motorCurrentFront: "bolt.fill"
        case .torqueFront, .torqueRear: "waveform.path.ecg"
        case .rpmFront, .rpmRear: "gauge.medium"
        case .motorTemp: "thermometer.medium"
        }
    }

    /// The icon-box accent (web `MetricCard` `color`): cyan → info, purple → power,
    /// green → success, reproduced per-tile from the source.
    public var accent: MotorSectionAccent {
        switch self {
        case .shiftState, .torqueFront, .rpmFront: .info
        case .packVoltage, .torqueRear, .rpmRear: .power
        case .motorCurrentFront, .motorTemp: .success
        }
    }
}

// MARK: - Card (one projected tile: kind + value + accent)

/// The view-ready projection of one tile — its kind (label + icon + accent) and its
/// already-formatted display value. `Identifiable` over the kind so the grid is stable.
public struct MotorSectionCard: Identifiable, Equatable, Sendable {
    public var id: MotorSectionMetricKind {
        kind
    }

    public let kind: MotorSectionMetricKind
    public let valueText: String
    public let accent: MotorSectionAccent

    public init(kind: MotorSectionMetricKind, valueText: String, accent: MotorSectionAccent) {
        self.kind = kind
        self.valueText = valueText
        self.accent = accent
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the combined VoiceOver phrase for a labelled tile from its already-resolved
/// display strings. Pure + public so the spoken content is asserted without rendering the
/// view; empty fragments are dropped so the phrase never reads a stray comma.
public enum MotorSectionAccessibility {
    public static func tileSummary(label: String, value: String) -> String {
        [label, value].filter { !$0.isEmpty }.joined(separator: ", ")
    }
}
