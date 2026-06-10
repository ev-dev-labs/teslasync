//
//  VehicleGauges.Adapter.swift
//  TeslaSync — P4 feature view · 0304 · VehicleGauges (Apple)
//
//  The testable projection core for the vehicle-detail gauges cluster — the SwiftUI
//  parity of features/vehicles/components/VehicleGauges.tsx plus the web helpers it is
//  fed by: `useUnits()` (`unitPrefs` + `formatDistance`), `convertDistanceFromSI` /
//  `convertSpeedFromSI` (lib/unitConversion.ts), `fmtNumber` (lib/numberFormat.ts), and
//  `batteryColor` / `boolColor` (lib/colors.ts). Everything here is pure + dependency-free
//  (no store, no bundle, no rendered view, no KMP `Shared` runtime) so the SI conversions,
//  the gauge value/max pairing, the semantic tint selection, and the model-key parsing are
//  all unit tested in isolation — and the parity-pin tests assert the canonical SI factors
//  so any drift from the shared converters is caught mechanically.
//
//  Parity note: the web component reads SI straight off the vehicle state (`rated_range`
//  in metres, `speed` in m/s, `charge_rate` in metres-per-hour) and converts at the display
//  boundary through `useUnits`. Two fields are NOT routed through the unit facade —
//  `battery_level` (a percent) and `charger_power` (a kW figure) — so this core renders
//  those verbatim, exactly as the source does.
//

import Foundation

// MARK: - Model key (web `TeslaModel` + `parseModelKey`)

/// The vehicle silhouette key — the native mirror of the web `TeslaModel` union
/// (`'model3' | 'models' | 'modely' | 'modelx' | 'cybertruck'`). `parse(_:)` reproduces the
/// web `parseModelKey` token matching so the car visualization picks the same shape.
public enum VehicleGaugesModelKey: String, Sendable, Equatable, CaseIterable {
    case model3
    case modelS
    case modelY
    case modelX
    case cybertruck

    /// Web `parseModelKey(modelStr)`: lower-cased, whitespace-stripped substring match with
    /// the same precedence (cybertruck → X → Y → S), defaulting to Model 3.
    public static func parse(_ modelString: String?) -> VehicleGaugesModelKey {
        guard let raw = modelString, !raw.isEmpty else { return .model3 }
        let value = raw.lowercased().filter { !$0.isWhitespace }
        if value.contains("cybertruck") || value.contains("ct") { return .cybertruck }
        if value.contains("modelx") || value.contains("mx") { return .modelX }
        if value.contains("modely") || value.contains("my") { return .modelY }
        if value.contains("models") || value.contains("ms") { return .modelS }
        return .model3
    }
}

// MARK: - Vehicle (web `Vehicle` — the field the gauges read)

/// The slice of the web `Vehicle` the gauges consume — only the display `model`, used to
/// pick the silhouette. Carried verbatim (no SI conversion applies to an identity string).
public struct VehicleGaugesVehicle: Sendable, Equatable {
    public let model: String

    public init(model: String) {
        self.model = model
    }
}

// MARK: - Vehicle state (web `VehicleState` — only the fields the gauges read)

/// The slice of the web `VehicleState` the gauges consume, carried as the raw numbers the
/// parent surface feeds the leaf. `ratedRange` is SI metres, `speed` SI m/s, `chargeRate`
/// SI metres-per-hour; `batteryLevel` is a percent and `chargerPower` a kW figure (both web
/// parity — not converted). The flags + `softwareVersion` back the status chips + car viz.
public struct VehicleGaugesState: Sendable, Equatable {
    public var batteryLevel: Double
    public var ratedRange: Double
    public var speed: Double
    public var chargerPower: Double
    public var chargeRate: Double
    public var isCharging: Bool
    public var isLocked: Bool
    public var isClimateOn: Bool
    public var sentryMode: Bool
    public var softwareVersion: String?

    public init(
        batteryLevel: Double = 0,
        ratedRange: Double = 0,
        speed: Double = 0,
        chargerPower: Double = 0,
        chargeRate: Double = 0,
        isCharging: Bool = false,
        isLocked: Bool = false,
        isClimateOn: Bool = false,
        sentryMode: Bool = false,
        softwareVersion: String? = nil
    ) {
        self.batteryLevel = batteryLevel
        self.ratedRange = ratedRange
        self.speed = speed
        self.chargerPower = chargerPower
        self.chargeRate = chargeRate
        self.isCharging = isCharging
        self.isLocked = isLocked
        self.isClimateOn = isClimateOn
        self.sentryMode = sentryMode
        self.softwareVersion = softwareVersion
    }

    /// Whether the vehicle reports any motion (web `speed > 0`) — drives the speed gauge tint
    /// and the car viz motion treatment.
    public var isMoving: Bool {
        speed > 0
    }
}

// MARK: - Unit preferences (web `useUnits().unitPrefs`)

/// The user's distance display preference — the native mirror of the web `unitPrefs.distance`
/// symbol (`'km'` / `'mi'`), used both as the range gauge unit and as the charge-rate base.
public enum VehicleGaugesDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"

    /// Resolves the unit from the web preference symbol, defaulting to km (the metric default).
    public static func from(symbol: String) -> VehicleGaugesDistanceUnit {
        VehicleGaugesDistanceUnit(rawValue: symbol) ?? .kilometers
    }
}

/// The user's speed display preference — the native mirror of the web `unitPrefs.speed`
/// symbol (`'km/h'` / `'mph'`), used as the speed gauge unit.
public enum VehicleGaugesSpeedUnit: String, Sendable, Equatable, CaseIterable {
    case kilometersPerHour = "km/h"
    case milesPerHour = "mph"

    /// Resolves the unit from the web preference symbol, defaulting to km/h (the metric default).
    public static func from(symbol: String) -> VehicleGaugesSpeedUnit {
        VehicleGaugesSpeedUnit(rawValue: symbol) ?? .kilometersPerHour
    }
}

/// The display preferences this surface reads — the native mirror of `useUnits()` + the
/// global number-format settings. `precision` is the web `getGlobalPrecision()` fallback the
/// `formatDistance` sublabels honour; the view never reads settings directly.
public struct VehicleGaugesUnits: Sendable, Equatable {
    public var distance: VehicleGaugesDistanceUnit
    public var speed: VehicleGaugesSpeedUnit
    public var precision: Int?
    public var localeIdentifier: String

    public init(
        distance: VehicleGaugesDistanceUnit = .kilometers,
        speed: VehicleGaugesSpeedUnit = .kilometersPerHour,
        precision: Int? = nil,
        localeIdentifier: String = "en_US"
    ) {
        self.distance = distance
        self.speed = speed
        self.precision = precision
        self.localeIdentifier = localeIdentifier
    }

    /// Metric defaults (km, km/h).
    public static let metric = VehicleGaugesUnits()

    /// Imperial defaults (mi, mph).
    public static let imperial = VehicleGaugesUnits(distance: .miles, speed: .milesPerHour)

    /// The resolved `Locale` for number formatting (web `Intl.NumberFormat` locale).
    public var locale: Locale {
        localeIdentifier.isEmpty ? .current : Locale(identifier: localeIdentifier)
    }
}

// MARK: - Semantic tint (web hex constants → design-token role)

/// The semantic colour role a gauge / bar / chip renders in — the native mirror of the web
/// hex constants the source uses (`CYAN` / `PURPLE` / green `#10b981` / amber / red / the
/// muted-grey inactive). The view maps each case to a design token so no hex lives in the
/// core (ADR-006 semantic colour parity).
public enum VehicleGaugesTint: String, Sendable, Equatable, CaseIterable {
    case accent
    case power
    case success
    case warning
    case danger
    case inactive
}

// MARK: - Tint selection (web `batteryColor` / `boolColor` / inline ternaries)

/// The pure tint mappings the web derives from the vehicle state. Unit tested across the
/// thresholds + boolean branches so the gauges/bars/chips pick the same colour the source does.
public enum VehicleGaugesTintRules {
    /// Web `batteryColor(level)`: > 60 → green, > 25 → amber, else red.
    public static func battery(level: Double) -> VehicleGaugesTint {
        if level > 60 { return .success }
        if level > 25 { return .warning }
        return .danger
    }

    /// Web `boolColor(is_locked)`: locked → green, unlocked → red.
    public static func lock(isLocked: Bool) -> VehicleGaugesTint {
        isLocked ? .success : .danger
    }

    /// Web `sentry_mode ? BAD : MUTED`: armed → red, off → inactive grey.
    public static func sentry(enabled: Bool) -> VehicleGaugesTint {
        enabled ? .danger : .inactive
    }

    /// Web `is_climate_on ? CYAN : MUTED`: on → accent, off → inactive grey.
    public static func climate(enabled: Bool) -> VehicleGaugesTint {
        enabled ? .accent : .inactive
    }

    /// Web speed gauge `speed > 0 ? PURPLE : DARK`: moving → power, parked → inactive.
    public static func speed(moving: Bool) -> VehicleGaugesTint {
        moving ? .power : .inactive
    }

    /// Web power gauge `boolColorMuted(is_charging)`: charging → green, idle → inactive grey.
    public static func power(isCharging: Bool) -> VehicleGaugesTint {
        isCharging ? .success : .inactive
    }
}

// MARK: - SI conversion + number formatting (ports of unitConversion.ts + numberFormat.ts)

/// Pure SI → display-unit conversion and locale number formatting ported from the web helpers
/// so the rounding, grouping separators, unit labels, and empty sentinel match the source
/// exactly. Kept local (not routed through the KMP `Units` facade) so the projection is
/// deterministic and unit-testable without the Kotlin runtime; parity-pin tests assert the
/// exact canonical factors.
public enum VehicleGaugesFormat {
    public static let metersPerKm = 1000.0
    public static let metersPerMile = 1609.344
    public static let secondsPerHour = 3600.0
    public static let metersPerSecondPerMph = 0.44704

    /// Web gauge ceilings, expressed in SI so the percent fill is unit-independent
    /// (`600 mi`, `250 mph`, `100 mi/h`).
    public static let maxRangeMeters = 600.0 * metersPerMile
    public static let maxSpeedMetersPerSecond = 250.0 * metersPerSecondPerMph
    public static let maxChargeRateMetersPerHour = 100.0 * metersPerMile

    /// The em-dash sentinel the web formatters return for nullish / non-finite input.
    public static let dash = "—"

    /// Web `getGlobalPrecision()` default decimal precision (numberFormat.ts).
    public static let globalPrecision = 2

    /// Web `DEFAULT_PRECISION.distance` (unitConversion.ts) — the `formatDistance` fallback.
    public static let distancePrecision = 1

    /// Web `safeNumber`: a finite number, else 0.
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `convertDistanceFromSI(meters, to)` — metres → km / mi.
    public static func convertDistance(_ meters: Double, to unit: VehicleGaugesDistanceUnit) -> Double {
        unit == .miles ? meters / metersPerMile : meters / metersPerKm
    }

    /// Web `convertSpeedFromSI(mps, to)` — m/s → km/h / mph.
    public static func convertSpeed(_ mps: Double, to unit: VehicleGaugesSpeedUnit) -> Double {
        unit == .milesPerHour ? mps * secondsPerHour / metersPerMile : mps * secondsPerHour / metersPerKm
    }

    /// Web `formatNumber(value, locale, digits)` — `Intl.NumberFormat` with fixed fraction
    /// digits, locale grouping, half-away rounding.
    public static func formatNumber(_ value: Double, digits: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "\(safe(value))"
    }

    /// Web `fmtNumber(v, decimals)` — `safeNumber` guard, the global-precision default, locale
    /// grouping. Used by the battery bar sublabel `${fmtNumber(battery_level, 0)}%`.
    public static func fmtNumber(_ value: Double, decimals: Int? = nil, locale: Locale = .current) -> String {
        formatNumber(value, digits: decimals ?? globalPrecision, locale: locale)
    }

    /// Web gauge centre value `fmtNumber(clamped, decimals ?? (isInteger ? 0 : globalPrecision))`
    /// — integral readings drop the decimals, otherwise fall back to the global precision.
    public static func gaugeValue(_ clamped: Double, decimals: Int? = nil, locale: Locale = .current) -> String {
        let digits = decimals ?? (clamped == clamped.rounded() ? 0 : globalPrecision)
        return formatNumber(clamped, digits: digits, locale: locale)
    }

    /// Web `formatDistance(meters, pref, { precision })` — metres → display unit with the unit
    /// label spaced after the value; non-finite input yields the em-dash sentinel.
    public static func formatDistance(
        _ meters: Double,
        unit: VehicleGaugesDistanceUnit,
        precision: Int? = nil,
        locale: Locale = .current
    ) -> String {
        guard meters.isFinite else { return dash }
        let digits = precision ?? distancePrecision
        let value = convertDistance(meters, to: unit)
        return "\(formatNumber(value, digits: digits, locale: locale)) \(unit.rawValue)"
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the car-visualization VoiceOver string from already-localized parts, so the spoken
/// content is asserted without rendering the view. Mirrors the surface: the model, the battery
/// percent, the charging / lock / climate / sentry state, and the motion read as one sentence.
public enum VehicleGaugesAccessibility {
    /// The composed spoken label, dropping empty parts so a sparse state still reads cleanly.
    public static func carLabel(modelName: String, batteryText: String, statusParts: [String]) -> String {
        var parts: [String] = []
        if !modelName.isEmpty { parts.append(modelName) }
        if !batteryText.isEmpty { parts.append(batteryText) }
        parts.append(contentsOf: statusParts.filter { !$0.isEmpty })
        return parts.joined(separator: ", ")
    }

    /// "{label}, {value} {unit}" for a gauge, dropping an empty unit so percent / kW read well.
    public static func gaugeLabel(label: String, value: String, unit: String) -> String {
        unit.isEmpty ? "\(label), \(value)" : "\(label), \(value) \(unit)"
    }

    /// "{label}, {sublabel}" for a metric bar.
    public static func barLabel(label: String, sublabel: String) -> String {
        "\(label), \(sublabel)"
    }
}
