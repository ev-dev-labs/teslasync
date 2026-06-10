//
//  VehicleCommandCenter.Adapter.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  The testable projection core for the Vehicle Command Center — the SwiftUI parity of
//  features/system/components/VehicleCommandCenter.tsx. Reproduces the web source's
//  numeric + status pipeline VERBATIM so the native surface shows the same values:
//    • the header telemetry stats (battery %, rated range, inside temperature) with the
//      exact `fmtNumber` + `convertDistanceFromSI` / `convertTempFromSI` math,
//    • the per-command last-status line (web `cmdStatus` → `timeAgo`),
//    • the live-state freshness age label (web `useIsStale` → `formatAge`),
//    • the client-side command search filter (web `filteredCommands` memo),
//    • the input/select/confirm dialog param assembly (web `buildParams` / `transform`).
//
//  Deliberately free of SwiftUI (Foundation only) so the formatting + projection +
//  param assembly compile and run on a plain host and are pinned by unit tests; the
//  SwiftUI chrome layers on top in the other VehicleCommandCenter.* files.
//

import Foundation

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtNumber`)

/// Locale-aware decimal formatting mirroring the web `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), rounding half
/// away from zero to match `Intl.NumberFormat`'s default `halfExpand`.
public enum VCCFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, half-up.
    public static func number(_ value: Double, decimals: Int = 0, localeIdentifier: String = "en_US") -> String {
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
}

// MARK: - SI conversion (ported from web lib/unitConversion.ts)

/// SI→display conversions matching the web `convertDistanceFromSI` / `convertTempFromSI`
/// the header uses (`convertDistanceFromSI(rated_range, distance)`,
/// `convertTempFromSI(inside_temp, temperature)`).
public enum VCCConvert {
    static let metersPerKm = 1000.0
    static let metersPerMile = 1609.344
    static let metersPerFoot = 0.3048

    /// `convertDistanceFromSI(meters, to)` — unit label `km` / `mi` / `ft`.
    public static func distanceFromSI(_ meters: Double, to unit: String) -> Double {
        switch unit {
        case "mi": meters / metersPerMile
        case "ft": meters / metersPerFoot
        default: meters / metersPerKm
        }
    }

    /// `convertTempFromSI(celsius, to)` — unit label `°C` / `°F`.
    public static func temperatureFromSI(_ celsius: Double, to unit: String) -> Double {
        unit == "°F" ? (celsius * 9 / 5 + 32) : celsius
    }
}

// MARK: - Relative time (web `timeAgo` + freshness `formatAge`)

/// Relative-time helpers. The strings resolve through the P1/S10 facade so the native
/// surface holds no hardcoded English (the web `timeAgo` / `formatAge` use literals).
public enum VCCRelativeTime {
    /// Web `timeAgo(dateStr)` for the per-command status line.
    public static func timeAgo(_ date: Date, now: Date = Date()) -> String {
        let mins = Int(max(0, now.timeIntervalSince(date)) / 60)
        if mins < 1 {
            return VehicleCommandCenterStrings.string("commands.timeAgo.justNow", "just now")
        }
        if mins < 60 {
            return VehicleCommandCenterStrings.format("commands.timeAgo.minutes", "%dm ago", mins)
        }
        let hrs = mins / 60
        if hrs < 24 {
            return VehicleCommandCenterStrings.format("commands.timeAgo.hours", "%dh ago", hrs)
        }
        return VehicleCommandCenterStrings.format("commands.timeAgo.days", "%dd ago", hrs / 24)
    }

    /// Web freshness `formatAge(age)` — the stale-banner / freshness-chip age label.
    public static func formatAge(_ date: Date?, now: Date = Date()) -> String {
        guard let date else {
            return VehicleCommandCenterStrings.string("commands.age.unknown", "—")
        }
        let age = Int(max(0, now.timeIntervalSince(date)))
        if age < 10 {
            return VehicleCommandCenterStrings.string("commands.age.justNow", "just now")
        }
        if age < 60 {
            return VehicleCommandCenterStrings.format("commands.age.seconds", "%ds ago", age)
        }
        if age < 3600 {
            return VehicleCommandCenterStrings.format("commands.age.minutes", "%dm ago", age / 60)
        }
        return VehicleCommandCenterStrings.format("commands.age.hours", "%dh ago", age / 3600)
    }
}

// MARK: - Telemetry stat (web header `<Battery>`/`<Wifi>`/`<Thermometer>` row)

/// One header telemetry stat — the native parity of the web header's battery / range /
/// inside-temperature chips. Foundation-only; the view maps `tone` + `systemImage`.
public struct VCCStat: Identifiable, Equatable, Sendable {
    /// The semantic tone (web `text-emerald-300` vs `text-amber-300` for battery; the
    /// range / temperature chips are secondary).
    public enum Tone: String, Sendable, Equatable {
        case success
        case warning
        case secondary
    }

    public let id: String
    public let systemImage: String
    public let value: String
    public let tone: Tone
    public let accessibilityKey: String
    public let accessibilityFallback: String

    public init(
        id: String,
        systemImage: String,
        value: String,
        tone: Tone,
        accessibilityKey: String,
        accessibilityFallback: String
    ) {
        self.id = id
        self.systemImage = systemImage
        self.value = value
        self.tone = tone
        self.accessibilityKey = accessibilityKey
        self.accessibilityFallback = accessibilityFallback
    }

    /// The localized accessibility name (e.g. "Battery").
    public var accessibilityName: String {
        VehicleCommandCenterStrings.string(accessibilityKey, accessibilityFallback)
    }

    /// The full spoken phrase (e.g. "Battery 82%").
    public var spoken: String {
        "\(accessibilityName) \(value)"
    }
}

// MARK: - Projection

/// The fully-projected, view-ready surface state derived from one `VCCUpdate`. Carries
/// the header fields, the telemetry stat row, the per-command status lines and the
/// toggle on/off states. The model layers the UI state (search / favorites / dialog /
/// last result) on top.
public struct VehicleCommandCenterProjection: Equatable, Sendable {
    public let vehicleName: String
    public let stateLabel: String
    public let modelLine: String
    public let isAsleep: Bool
    public let ageLabel: String
    public let stats: [VCCStat]
    public let statusByCommand: [String: String]
    public let toggleStates: [String: Bool]

    public init(
        vehicleName: String,
        stateLabel: String,
        modelLine: String,
        isAsleep: Bool,
        ageLabel: String,
        stats: [VCCStat],
        statusByCommand: [String: String],
        toggleStates: [String: Bool]
    ) {
        self.vehicleName = vehicleName
        self.stateLabel = stateLabel
        self.modelLine = modelLine
        self.isAsleep = isAsleep
        self.ageLabel = ageLabel
        self.stats = stats
        self.statusByCommand = statusByCommand
        self.toggleStates = toggleStates
    }
}

/// Pure projector: `VCCUpdate` → `VehicleCommandCenterProjection`. Every value is
/// computed with the same arithmetic + formatting as the web component so the surfaces
/// show identical numbers side by side.
public enum VehicleCommandProjector {
    public static func project(update: VCCUpdate, now: Date = Date()) -> VehicleCommandCenterProjection {
        let vehicle = update.vehicle
        return VehicleCommandCenterProjection(
            vehicleName: vehicle.name,
            stateLabel: vehicle.state,
            modelLine: "\(vehicle.model) · \(vehicle.vin)",
            isAsleep: vehicle.isAsleep,
            ageLabel: VCCRelativeTime.formatAge(vehicle.updatedAt, now: now),
            stats: stats(state: update.state, units: update.units),
            statusByCommand: statusMap(update.latestCommands, now: now),
            toggleStates: toggleStates(update.state)
        )
    }

    /// The header telemetry stats (web `{state && …}` battery / range / temp row). Only
    /// rendered when a live state snapshot is present; the temperature chip only when
    /// `inside_temp != null` (web guard).
    static func stats(state: VCCVehicleState?, units: VCCUnitPrefs) -> [VCCStat] {
        guard let state else { return [] }
        var result: [VCCStat] = []

        let level = state.batteryLevel ?? 0
        result.append(
            VCCStat(
                id: "battery",
                systemImage: "battery.100",
                value: "\(level)%",
                tone: level > 50 ? .success : .warning,
                accessibilityKey: "commands.header.battery",
                accessibilityFallback: "Battery"
            )
        )

        let rangeValue = VCCFormat.number(
            VCCConvert.distanceFromSI(state.ratedRangeMeters ?? 0, to: units.distance),
            decimals: 0,
            localeIdentifier: units.localeIdentifier
        )
        result.append(
            VCCStat(
                id: "range",
                systemImage: "road.lanes",
                value: "\(rangeValue) \(units.distance)",
                tone: .secondary,
                accessibilityKey: "commands.header.range",
                accessibilityFallback: "Rated range"
            )
        )

        if let temp = state.insideTempCelsius {
            let tempValue = VCCFormat.number(
                VCCConvert.temperatureFromSI(temp, to: units.temperature),
                decimals: 0,
                localeIdentifier: units.localeIdentifier
            )
            result.append(
                VCCStat(
                    id: "temp",
                    systemImage: "thermometer.medium",
                    value: "\(tempValue)\(units.temperature)",
                    tone: .secondary,
                    accessibilityKey: "commands.header.insideTemp",
                    accessibilityFallback: "Inside temperature"
                )
            )
        }

        return result
    }

    /// The per-command status lines (web `cmdMap` + `cmdStatus`): the latest entry per
    /// command token → `✓ 2m ago` / `✗ 2m ago`.
    static func statusMap(_ entries: [VCCCommandLogEntry], now: Date = Date()) -> [String: String] {
        var map: [String: String] = [:]
        for entry in entries where map[entry.command] == nil {
            let marker = entry.isSuccess ? "✓" : "✗"
            map[entry.command] = "\(marker) \(VCCRelativeTime.timeAgo(entry.createdAt, now: now))"
        }
        return map
    }

    /// The bound toggle states (web `state[stateField]`) for the toggle tiles.
    static func toggleStates(_ state: VCCVehicleState?) -> [String: Bool] {
        guard let state else { return [:] }
        var map: [String: Bool] = [:]
        for field in ["is_locked", "is_charging", "is_climate_on", "sentry_mode"] {
            if let value = state.toggleState(field: field) {
                map[field] = value
            }
        }
        return map
    }
}

// MARK: - Search filter (web `filteredCommands` memo)

/// The client-side command search filter — a verbatim port of the web
/// `COMMANDS.filter(...)`: a command matches when its localized label, its category
/// token, or its raw command token contains the lower-cased query.
public enum VehicleCommandFilter {
    public static func match(query: String, in commands: [VehicleCommand]) -> [VehicleCommand] {
        let needle = query.lowercased()
        guard !needle.isEmpty else { return commands }
        return commands.filter { command in
            let label = VehicleCommandCenterStrings.string(command.labelKey, command.labelFallback).lowercased()
            return label.contains(needle)
                || command.category.rawValue.lowercased().contains(needle)
                || command.command.lowercased().contains(needle)
        }
    }
}

// MARK: - Param assembly (web `buildParams` / `transform`)

/// Assembles the final command params from a command's plan + the entered dialog
/// values — the host-testable parity of the web `inputConfig.buildParams` /
/// `transform` / `paramName` logic.
public enum VehicleCommandParamAssembler {
    public static func assemble(command: VehicleCommand, values: [String: String]) -> VCCParams {
        var params = VCCParams(command.plan.base)
        switch command.plan.builder {
        case .none:
            break
        case let .single(field, param, transform):
            params.values[param] = apply(transform, to: values[field] ?? defaultValue(command, field))
        case let .duplicate(field, into):
            let raw = values[field] ?? defaultValue(command, field)
            for param in into {
                params.values[param] = .string(raw)
            }
        case let .latLon(parseFloat):
            let lat = values["lat"] ?? ""
            let lon = values["lon"] ?? ""
            if parseFloat {
                params.values["lat"] = .double(Double(lat) ?? 0)
                params.values["lon"] = .double(Double(lon) ?? 0)
                params.values["order"] = .int(0)
            } else {
                params.values["lat"] = .string(lat)
                params.values["lon"] = .string(lon)
            }
        case let .navAddress(field):
            let address = values[field] ?? ""
            params.values["type"] = .string("share_ext_content_raw")
            params.values["value"] = .object(["android.intent.extra.TEXT": .string(address)])
            params.values["locale"] = .string("en-US")
        case let .vehicleName(field):
            let trimmed = (values[field] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            params.values["vehicle_name"] = .string(trimmed)
        }
        return params
    }

    /// The dialog default for a field (web `inputConfig.defaultValue`), so an
    /// unedited field assembles like the web does.
    private static func defaultValue(_ command: VehicleCommand, _ field: String) -> String {
        guard case let .input(config) = command.dialog else { return "" }
        if config.paramName == field, let value = config.defaultValue {
            return value
        }
        return ""
    }

    private static func apply(_ transform: VCCParamTransform, to raw: String) -> VCCParamValue {
        switch transform {
        case .raw:
            .string(raw)
        case .intParse:
            .int(Int(raw) ?? 0)
        case .minutesToSeconds:
            .string(String((Int(raw) ?? 0) * 60))
        case .trim:
            .string(raw.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }
}
