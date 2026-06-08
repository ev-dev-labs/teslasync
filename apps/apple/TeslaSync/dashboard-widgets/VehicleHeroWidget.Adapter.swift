//
//  VehicleHeroWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0108 · VehicleHeroWidget (Apple)
//
//  The testable projection core: the SI→display unit converters (1:1 with the web
//  `convertDistanceFromSI` / `convertSpeedFromSI` / `convertTempFromSI`), the
//  locale-aware number formatters (web `fmtNumber` / `fmtInt`), the firmware
//  resolver (web `live.version || … || '—'`), the vehicle-state → badge catalog
//  (web `StatusBadge` + `VEHICLE_STATE_LABELS`), the brand color palette (web hex),
//  and the VoiceOver summary builders. All pure + dependency-free so the adapter is
//  unit-testable without a store, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Brand palette (web hex — gauge colors + status dots + stat tints)

/// The exact web hex colors the hero reproduces. These are dynamic, semantic
/// chart/status colors (not static theme tokens), so per ADR-009 they are
/// expressed as explicit `Color` values for cross-platform visual parity.
public enum VehicleHeroPalette {
    public static let green = rgb(0x10B981) // #10b981 battery>50 / charging / regen
    public static let amber = rgb(0xF59E0B) // #f59e0b battery<=50 / discharging
    public static let cyan = rgb(0x00F0FF) // #00f0ff range / ideal range
    public static let purple = rgb(0xA855F7) // #a855f7 speed / asleep dot
    public static let orange = rgb(0xF97316) // #f97316 inside temp
    public static let blue = rgb(0x3B82F6) // #3b82f6 outside temp / driving dot
    public static let slate = rgb(0x374151) // #374151 power == 0
    public static let indigo = rgb(0x6366F1) // #6366f1 firmware / updating dot
    public static let yellow = rgb(0xFACC15) // #facc15 charging dot
    public static let teal = rgb(0x06B6D4) // #06b6d4 parked dot
    public static let red = rgb(0xEF4444) // #ef4444 sentry active

    static func rgb(_ hex: Int) -> Color {
        Color(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

// MARK: - SI → display conversion (web `convert*FromSI`)

/// Pure SI→display converters, 1:1 with the web `unitConversion.ts` math (no
/// "guess the input unit" branching — every input is SI). Unknown unit labels
/// fall back to the metric branch, matching the web default prefs.
public enum VehicleHeroConvert {
    static let metersPerMile = 1609.344
    static let metersPerKm = 1000.0
    static let metersPerFoot = 0.3048
    static let secondsPerHour = 3600.0

    /// Meters → display distance (web `convertDistanceFromSI`).
    public static func distance(_ meters: Double, _ unit: String) -> Double {
        switch unit {
        case "mi": meters / metersPerMile
        case "ft": meters / metersPerFoot
        default: meters / metersPerKm
        }
    }

    /// Meters/second → display speed (web `convertSpeedFromSI`).
    public static func speed(_ mps: Double, _ unit: String) -> Double {
        switch unit {
        case "mph": (mps * secondsPerHour) / metersPerMile
        default: (mps * secondsPerHour) / metersPerKm
        }
    }

    /// Celsius → display temperature (web `convertTempFromSI`).
    public static func temperature(_ celsius: Double, _ unit: String) -> Double {
        switch unit {
        case "°F": (celsius * 9) / 5 + 32
        default: celsius
        }
    }
}

// MARK: - Number formatting (web `fmtNumber` / `fmtInt`)

/// Locale-aware decimal formatting, parity with the web `fmtNumber` (global
/// precision, grouping separators, `safeNumber` guard so NaN/±Inf render as 0).
public enum VehicleHeroWidgetFormat {
    /// Web `fmtNumber(value, decimals, locale)`.
    public static func number(_ value: Double, decimals: Int, locale: String? = nil) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.roundingMode = .halfUp
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.locale = locale.map { Locale(identifier: $0) } ?? Locale.current
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// Web `fmtInt(value)` == `fmtNumber(value, 0)`.
    public static func int(_ value: Double, locale: String? = nil) -> String {
        number(value, decimals: 0, locale: locale)
    }
}

// MARK: - Firmware resolution (web `live.version || … || '—'`)

/// Resolves the firmware string with the web precedence:
/// `live.version || live.swUpdateVersion || state.software_version || '—'`.
public enum VehicleHeroFirmware {
    public static let dash = "—"

    public static func resolve(_ update: VehicleHeroWidgetUpdate) -> String {
        resolve(
            liveVersion: update.liveVersion,
            liveSwUpdateVersion: update.liveSwUpdateVersion,
            softwareVersion: update.state?.softwareVersion
        )
    }

    public static func resolve(
        liveVersion: String?,
        liveSwUpdateVersion: String?,
        softwareVersion: String?
    ) -> String {
        for candidate in [liveVersion, liveSwUpdateVersion, softwareVersion] {
            if let value = candidate?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
                return value
            }
        }
        return dash
    }
}

// MARK: - Status catalog (web `StatusBadge` + `VEHICLE_STATE_LABELS`)

/// The badge presentation for a vehicle state — the native port of the web
/// `StatusBadge` (neutral pill + colored dot) keyed off `getStateDefinition`. The
/// dot colors reproduce the web `badgeDot` overrides exactly.
public struct VehicleHeroStatusVisual: Equatable {
    public let rawStatus: String
    public let label: String
    public let tone: TSTone
    public let dotColor: Color
}

/// Maps a vehicle `state` string to its badge visual, with a neutral fallback so
/// an unknown backend state renders with the capitalized raw value (never crashes
/// or shows `undefined`). Mirrors web `VEHICLE_STATES` + their `badgeDot` colors.
public enum VehicleHeroStatusCatalog {
    public static let knownStates = [
        "online", "driving", "charging", "parked", "updating", "asleep", "offline"
    ]

    public static func visual(
        for status: String,
        localize: (String, String) -> String
    ) -> VehicleHeroStatusVisual {
        let palette = colorDescriptor(for: status)
        let label = labelDescriptor(for: status)
        return VehicleHeroStatusVisual(
            rawStatus: status,
            label: localize(label.key, label.fallback),
            tone: palette.tone,
            dotColor: palette.color
        )
    }

    private static func colorDescriptor(for status: String) -> (tone: TSTone, color: Color) {
        switch status {
        case "online": (.success, Color.TS.statusSuccess)
        case "driving": (.info, VehicleHeroPalette.blue)
        case "charging": (.warning, VehicleHeroPalette.yellow)
        case "parked": (.info, VehicleHeroPalette.teal)
        case "updating": (.info, VehicleHeroPalette.indigo)
        case "asleep": (.neutral, VehicleHeroPalette.purple)
        case "offline": (.danger, Color.TS.statusDanger)
        default: (.neutral, Color.TS.textMuted)
        }
    }

    private static func labelDescriptor(for status: String) -> (key: String, fallback: String) {
        switch status {
        case "online": ("hero.state.online", "Online")
        case "driving": ("hero.state.driving", "Driving")
        case "charging": ("hero.state.charging", "Charging")
        case "parked": ("hero.state.parked", "Parked")
        case "updating": ("hero.state.updating", "Updating")
        case "asleep": ("hero.state.asleep", "Asleep")
        case "offline": ("hero.state.offline", "Offline")
        default: ("hero.state.\(status)", capitalize(status))
        }
    }

    static func capitalize(_ raw: String) -> String {
        guard let first = raw.first else { return "—" }
        return first.uppercased() + raw.dropFirst()
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the header + gauges. Pure + public so the
/// spoken content can be unit-tested without rendering the view.
public enum VehicleHeroWidgetAccessibility {
    /// Header value: "<name>. <state>. <battery> <percentWord>".
    public static func headerSummary(
        name: String,
        stateLabel: String,
        batteryText: String,
        percentWord: String
    ) -> String {
        [name, stateLabel, "\(batteryText) \(percentWord)"].joined(separator: ". ")
    }

    /// Gauge value: "<label>, <value> <unit>" (unit omitted when empty).
    public static func gaugeValue(label: String, valueText: String, unit: String) -> String {
        let trimmedUnit = unit.trimmingCharacters(in: .whitespaces)
        return trimmedUnit.isEmpty ? "\(label), \(valueText)" : "\(label), \(valueText) \(trimmedUnit)"
    }
}
