//
//  TelemetryGrid.Adapter.swift
//  TeslaSync — P4 feature view · 0285 · TelemetryGrid (Apple)
//
//  The testable formatting + presentation core for the telemetry grid — the SwiftUI parity
//  of features/vehicles/components/telemetry-panels/TelemetryGrid.tsx. Reproduces the web
//  numeric pipeline VERBATIM so the native tiles show the same values:
//    • web lib/numberFormat `fmtNumber` / `fmtInt` (grouped, locale-aware, half-up),
//    • web lib/unitConversion `convert*FromSI` + `format*` (distance / speed / temperature),
//      with the same per-quantity default precision + the °unit no-space rule,
//    • the six-tile projection (battery / speed / inside / odometer / charger / sentry) the
//      web `TelemetryGrid` renders, including its exact tone thresholds and sub-labels,
//    • the freshness age label for the P4 stale / offline chrome.
//
//  Deliberately free of SwiftUI (Foundation only) so the formatting + projection compile and
//  run on a plain host and are pinned by unit tests; the SwiftUI chrome layers on top in the
//  other TelemetryGrid.* files.
//

import Foundation

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware decimal formatting mirroring web `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), rounding half away
/// from zero to match `Intl.NumberFormat`'s default `halfExpand`. `fmtInt` is the 0-digit
/// case. The global `fmtNumber` precision (web default 2) is carried on
/// `TGUnitPrefs.numberPrecision`.
public enum TGFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` core — fixed fraction digits, grouped, half-up.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// Web `fmtNumber(v)` — uses the global precision (`numberPrecision`, default 2) unless a
    /// per-call `decimals` override is given.
    public static func fmtNumber(_ value: Double, _ units: TGUnitPrefs, decimals: Int? = nil) -> String {
        number(value, decimals: decimals ?? units.numberPrecision, localeIdentifier: units.localeIdentifier)
    }

    /// Web `fmtInt(v)` — `fmtNumber(v, 0)`.
    public static func fmtInt(_ value: Double, _ units: TGUnitPrefs) -> String {
        number(value, decimals: 0, localeIdentifier: units.localeIdentifier)
    }
}

// MARK: - SI converters + unit formatters (ported from web lib/unitConversion.ts)

/// SI→display conversion + formatting matching the web `convert*FromSI` + `format*` the grid
/// uses through `useUnits`. Constants are byte-for-byte the web `METERS_PER_*`. Each
/// formatter returns the web `—` fallback for nil / non-finite input and applies the web
/// per-quantity default precision (distance 1, speed 0, temperature 1) unless
/// `units.unitPrecision` (or a per-call override) replaces it.
public enum TGUnits {
    static let metersPerKm = 1000.0
    static let metersPerMile = 1609.344
    static let secondsPerHour = 3600.0
    static let emptyDisplay = "—"

    public static func distanceFromSI(_ meters: Double, to unit: String) -> Double {
        switch unit {
        case "mi": meters / metersPerMile
        default: meters / metersPerKm
        }
    }

    public static func speedFromSI(_ mps: Double, to unit: String) -> Double {
        switch unit {
        case "mph": (mps * secondsPerHour) / metersPerMile
        default: (mps * secondsPerHour) / metersPerKm
        }
    }

    public static func temperatureFromSI(_ celsius: Double, to unit: String) -> Double {
        switch unit {
        case "°F": (celsius * 9) / 5 + 32
        default: celsius
        }
    }

    private static func precision(_ units: TGUnitPrefs, override: Int?, fallback: Int) -> Int {
        if let override, override >= 0 { return override }
        if let unitPrecision = units.unitPrecision, unitPrecision >= 0 { return unitPrecision }
        return fallback
    }

    /// Web `formatDistance(meters, { precision })` — `"{num} {km|mi}"`, default precision 1.
    public static func formatDistance(
        _ meters: Double?,
        _ units: TGUnitPrefs,
        precision override: Int? = nil
    ) -> String {
        guard let meters, meters.isFinite else { return emptyDisplay }
        let num = TGFormat.number(
            distanceFromSI(meters, to: units.distance),
            decimals: precision(units, override: override, fallback: 1),
            localeIdentifier: units.localeIdentifier
        )
        return "\(num) \(units.distance)"
    }

    /// Web `formatSpeed(mps)` — `"{num} {km/h|mph}"`, default precision 0.
    public static func formatSpeed(_ mps: Double?, _ units: TGUnitPrefs) -> String {
        guard let mps, mps.isFinite else { return emptyDisplay }
        let num = TGFormat.number(
            speedFromSI(mps, to: units.speed),
            decimals: precision(units, override: nil, fallback: 0),
            localeIdentifier: units.localeIdentifier
        )
        return "\(num) \(units.speed)"
    }

    /// Web `formatTemperature(celsius)` — `"{num}{°C|°F}"` (no space), default precision 1.
    public static func formatTemperature(_ celsius: Double?, _ units: TGUnitPrefs) -> String {
        guard let celsius, celsius.isFinite else { return emptyDisplay }
        let num = TGFormat.number(
            temperatureFromSI(celsius, to: units.temperature),
            decimals: precision(units, override: nil, fallback: 1),
            localeIdentifier: units.localeIdentifier
        )
        return "\(num)\(units.temperature)"
    }
}

// MARK: - Tile tone (web InfoTile `color` → P1/S9 tokens)

/// The semantic tint of a tile's value, mapped to design tokens in the view layer. Mirrors
/// the web InfoTile `color` prop: the default primary text, the battery emerald / amber /
/// rose thresholds, and the muted "off" treatment (web `text-[var(--text-muted)]`).
public enum TGTone: String, Sendable, Equatable {
    case primary
    case success
    case warning
    case danger
    case muted
}

// MARK: - Tile presentation model (web `InfoTile` props)

/// One projected tile (web `InfoTile`): the leading SF Symbol, the muted label, the toned
/// value, and an optional sub-caption. Foundation-only so the projection is host-testable.
public struct TelemetryGridTile: Identifiable, Equatable, Sendable {
    public let id: String
    public let iconSystemName: String
    public let label: String
    public let value: String
    public let valueTone: TGTone
    public let sub: String?

    public init(
        id: String,
        iconSystemName: String,
        label: String,
        value: String,
        valueTone: TGTone = .primary,
        sub: String? = nil
    ) {
        self.id = id
        self.iconSystemName = iconSystemName
        self.label = label
        self.value = value
        self.valueTone = valueTone
        self.sub = sub
    }

    /// The spoken "label, value, sub" phrase for VoiceOver.
    public var spoken: String {
        [label, value, sub].compactMap(\.self).joined(separator: ", ")
    }
}

// MARK: - Aggregate projection + projector

/// The fully-projected, view-ready grid derived from one `TelemetryGridUpdate`: the six
/// tiles + the freshness age label + whether a vehicle state resolved (drives the
/// surface-level empty state).
public struct TelemetryGridProjection: Equatable, Sendable {
    public let tiles: [TelemetryGridTile]
    public let ageLabel: String
    public let hasData: Bool
}

/// Pure projector: `TelemetryGridUpdate` → `TelemetryGridProjection`. Reproduces the six web
/// `InfoTile`s VERBATIM — same icons, labels, values, tone thresholds, and sub-captions.
public enum TelemetryGridProjector {
    public static func project(update: TelemetryGridUpdate, now: Date = Date()) -> TelemetryGridProjection {
        guard let vehicle = update.vehicle else {
            return TelemetryGridProjection(
                tiles: [],
                ageLabel: TGRelativeTime.formatAge(update.updatedAt, now: now),
                hasData: false
            )
        }
        let units = update.units
        return TelemetryGridProjection(
            tiles: [
                batteryTile(vehicle, units),
                speedTile(vehicle, units),
                insideTile(vehicle, units),
                odometerTile(vehicle, units),
                chargerTile(vehicle, units),
                sentryTile(vehicle)
            ],
            ageLabel: TGRelativeTime.formatAge(update.updatedAt, now: now),
            hasData: true
        )
    }

    // MARK: tile builders (each reproduces its web `InfoTile` verbatim)

    /// Web battery tile: `"{fmtInt(level)}%"`, emerald > 50 / amber > 20 / rose otherwise,
    /// sub `"{formatDistance(rated_range)} {range}"`.
    private static func batteryTile(_ vehicle: TGVehicleSnapshot, _ units: TGUnitPrefs) -> TelemetryGridTile {
        let value = vehicle.batteryLevel.map { "\(TGFormat.fmtInt($0, units))%" } ?? TGUnits.emptyDisplay
        let tone: TGTone = {
            guard let level = vehicle.batteryLevel else { return .muted }
            if level > 50 { return .success }
            if level > 20 { return .warning }
            return .danger
        }()
        let rangeWord = TelemetryGridStrings.string("common.range", "range")
        return TelemetryGridTile(
            id: "battery",
            iconSystemName: "battery.100",
            label: TelemetryGridStrings.string("common.battery", "Battery"),
            value: value,
            valueTone: tone,
            sub: "\(TGUnits.formatDistance(vehicle.ratedRangeMeters, units)) \(rangeWord)"
        )
    }

    /// Web speed tile: `formatSpeed(speed)`, sub `speed > 0 ? Driving : Parked`.
    private static func speedTile(_ vehicle: TGVehicleSnapshot, _ units: TGUnitPrefs) -> TelemetryGridTile {
        let moving = (vehicle.speedMetersPerSecond ?? 0) > 0
        let subKey = moving ? "telemetryGrid.driving" : "telemetryGrid.parked"
        let subFallback = moving ? "Driving" : "Parked"
        return TelemetryGridTile(
            id: "speed",
            iconSystemName: "speedometer",
            label: TelemetryGridStrings.string("common.speed", "Speed"),
            value: TGUnits.formatSpeed(vehicle.speedMetersPerSecond, units),
            sub: TelemetryGridStrings.string(subKey, subFallback)
        )
    }

    /// Web inside-temp tile: `formatTemperature(inside_temp)`, sub
    /// `"{Outside}: {formatTemperature(outside_temp)}"`.
    private static func insideTile(_ vehicle: TGVehicleSnapshot, _ units: TGUnitPrefs) -> TelemetryGridTile {
        let outsideWord = TelemetryGridStrings.string("common.outside", "Outside")
        return TelemetryGridTile(
            id: "inside",
            iconSystemName: "thermometer.medium",
            label: TelemetryGridStrings.string("common.inside", "Inside"),
            value: TGUnits.formatTemperature(vehicle.insideTempC, units),
            sub: "\(outsideWord): \(TGUnits.formatTemperature(vehicle.outsideTempC, units))"
        )
    }

    /// Web odometer tile: `formatDistance(odometer, { precision: 0 })`, no sub.
    private static func odometerTile(_ vehicle: TGVehicleSnapshot, _ units: TGUnitPrefs) -> TelemetryGridTile {
        TelemetryGridTile(
            id: "odometer",
            iconSystemName: "location.north.fill",
            label: TelemetryGridStrings.string("common.odometer", "Odometer"),
            value: TGUnits.formatDistance(vehicle.odometerMeters, units, precision: 0)
        )
    }

    /// Web charger tile: `is_charging ? "{fmtInt(charger_power)} kW" : Not charging`, emerald
    /// when charging else muted, sub `is_charging && ttf != nil ? "Full in {fmtNumber(ttf)}h"`.
    private static func chargerTile(_ vehicle: TGVehicleSnapshot, _ units: TGUnitPrefs) -> TelemetryGridTile {
        let value: String
        if vehicle.isCharging {
            let kw = vehicle.chargerPowerKw.map { TGFormat.fmtInt($0, units) } ?? TGUnits.emptyDisplay
            value = TelemetryGridStrings.format("telemetryGrid.chargerPower", "%@ kW", kw)
        } else {
            value = TelemetryGridStrings.string("telemetryGrid.notCharging", "Not charging")
        }
        var sub: String?
        if vehicle.isCharging, let hours = vehicle.timeToFullChargeHours {
            sub = TelemetryGridStrings.format("telemetryGrid.fullIn", "Full in %@h", TGFormat.fmtNumber(hours, units))
        }
        return TelemetryGridTile(
            id: "charger",
            iconSystemName: "battery.100.bolt",
            label: TelemetryGridStrings.string("common.charger", "Charger"),
            value: value,
            valueTone: vehicle.isCharging ? .success : .muted,
            sub: sub
        )
    }

    /// Web sentry tile: `sentry_mode ? Active : Off`, rose when armed else muted.
    private static func sentryTile(_ vehicle: TGVehicleSnapshot) -> TelemetryGridTile {
        let value = vehicle.sentryMode
            ? TelemetryGridStrings.string("common.active", "Active")
            : TelemetryGridStrings.string("common.off", "Off")
        return TelemetryGridTile(
            id: "sentry",
            iconSystemName: "eye.fill",
            label: TelemetryGridStrings.string("common.sentry", "Sentry"),
            value: value,
            valueTone: vehicle.sentryMode ? .danger : .muted
        )
    }
}

// MARK: - Relative time (web freshness age label)

/// Relative-time helper for the freshness chip. The strings resolve through the P1/S10
/// facade so the native surface holds no hardcoded English.
public enum TGRelativeTime {
    /// Freshness `formatAge(age)` — the stale-chip / freshness-chip age label.
    public static func formatAge(_ date: Date?, now: Date = Date()) -> String {
        guard let date else {
            return TelemetryGridStrings.string("telemetryGrid.age.unknown", "—")
        }
        let age = Int(max(0, now.timeIntervalSince(date)))
        if age < 10 {
            return TelemetryGridStrings.string("telemetryGrid.age.justNow", "just now")
        }
        if age < 60 {
            return TelemetryGridStrings.format("telemetryGrid.age.seconds", "%ds ago", age)
        }
        if age < 3600 {
            return TelemetryGridStrings.format("telemetryGrid.age.minutes", "%dm ago", age / 60)
        }
        return TelemetryGridStrings.format("telemetryGrid.age.hours", "%dh ago", age / 3600)
    }
}
