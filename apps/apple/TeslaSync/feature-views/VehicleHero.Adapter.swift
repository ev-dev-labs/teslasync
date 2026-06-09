//
//  VehicleHero.Adapter.swift
//  TeslaSync — P4 feature view · 0133 · VehicleHero (Apple)
//
//  The testable primitives for the dashboard vehicle hero — the SwiftUI parity of
//  features/dashboard/components/VehicleHero.tsx plus the web helpers it leans on:
//  `fmtNumber` / `fmtInt` (lib/numberFormat.ts) and the `toDistanceDisplay` /
//  `toSpeedDisplay` / `toTemperatureDisplay` converters the dashboard page threads in
//  from `useUnits`. Everything here is pure + dependency-free (no store, no bundle, no
//  SwiftUI) so the unit math, the locale formatting, the status parsing, and the
//  freshness age are unit tested in isolation. The view-state builders live in the
//  sibling `VehicleHero.Gauges.swift` / `VehicleHero.Stats.swift`.
//
//  SI note: the dashboard's live state is read SI from the API (Phase-42). This core
//  carries meters / m·s⁻¹ / °C and converts to the user's unit — the native mirror of
//  the web converters — so the rendered numbers match the web exactly. Power is carried
//  in kW and time-to-full in hours, matching the web prop contract.
//

import Foundation

// MARK: - Display-unit system (web `useUnits` distance/speed/temp preference)

/// The user's measurement system for the hero's distance / speed / temperature values
/// — the native mirror of the web `toDistanceDisplay` / `toSpeedDisplay` /
/// `toTemperatureDisplay` converters plus their unit labels.
public enum VehicleHeroPanelUnitSystem: String, Sendable, Equatable, CaseIterable {
    case metric
    case imperial

    /// Whether temperatures render in Fahrenheit (web `isFahrenheit`).
    public var isFahrenheit: Bool {
        self == .imperial
    }

    /// Distance unit symbol (web `distanceUnit`).
    public var distanceUnit: String {
        self == .imperial ? "mi" : "km"
    }

    /// Speed unit symbol (web `speedUnit`).
    public var speedUnit: String {
        self == .imperial ? "mph" : "km/h"
    }

    /// Temperature unit symbol (web `tempUnit`).
    public var temperatureUnit: String {
        self == .imperial ? "°F" : "°C"
    }
}

/// Pure SI → display conversions, the native equivalent of the web `useUnits`
/// converters. Distances arrive in meters, speeds in m·s⁻¹, temperatures in °C.
public enum VehicleHeroPanelUnits {
    static let metersPerMile = 1609.344
    static let mphPerMps = 2.2369362920544
    static let kmhPerMps = 3.6

    /// Meters → km (metric) or miles (imperial) — web `toDistanceDisplay`.
    public static func distance(_ meters: Double, _ system: VehicleHeroPanelUnitSystem) -> Double {
        guard meters.isFinite else { return 0 }
        return system == .imperial ? meters / metersPerMile : meters / 1000
    }

    /// m·s⁻¹ → km·h⁻¹ (metric) or mph (imperial) — web `toSpeedDisplay`.
    public static func speed(_ mps: Double, _ system: VehicleHeroPanelUnitSystem) -> Double {
        guard mps.isFinite else { return 0 }
        return system == .imperial ? mps * mphPerMps : mps * kmhPerMps
    }

    /// °C → °C (metric) or °F (imperial) — web `toTemperatureDisplay`.
    public static func temperature(_ celsius: Double, _ system: VehicleHeroPanelUnitSystem) -> Double {
        guard celsius.isFinite else { return 0 }
        return system == .imperial ? celsius * 9 / 5 + 32 : celsius
    }
}

// MARK: - Number formatting (port of numberFormat.ts fmtNumber / fmtInt)

/// Pure number formatting ported from the web helpers so the rounding, the grouping
/// separators, and the precision match the source exactly. The web global precision is
/// 2 and `safeNumber` coerces non-finite input to 0; both are reproduced here.
public enum VehicleHeroPanelFormat {
    /// The em-dash sentinel the web renders for a missing / non-applicable value.
    public static let dash = "—"

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction digits,
    /// half-away rounding (web `toLocaleString` default), `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int = 2, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `fmtInt(v)` — zero-fraction-digit locale format.
    public static func int(_ value: Double, locale: Locale = .current) -> String {
        number(value, decimals: 0, locale: locale)
    }

    /// The web gauge precision rule: an integer value renders with no fraction digits,
    /// otherwise the global precision (2). Mirrors `Number.isInteger(c) ? 0 : prec`.
    public static func gauge(_ value: Double, locale: Locale = .current) -> String {
        let isWhole = safe(value).rounded() == safe(value)
        return number(value, decimals: isWhole ? 0 : 2, locale: locale)
    }

    /// A measurement value + spaced unit; `decimals == nil` formats as a grouped int.
    public static func measurement(_ value: Double, _ decimals: Int?, _ unit: String, _ locale: Locale) -> String {
        let text = decimals.map { number(value, decimals: $0, locale: locale) } ?? int(value, locale: locale)
        return text + " " + unit
    }
}

// MARK: - Semantic accent roles (web per-item hex → P1/S9 token, resolved in the view)

/// The semantic colour role for a gauge or stat card — the native mirror of the web
/// per-item hex colours, mapped to the design tokens by the view (ADR-006: semantic,
/// not literal). Kept colour-free here so the projection core stays SwiftUI-free.
public enum VehicleHeroPanelAccent: String, Sendable, Equatable {
    case battery
    case batteryLow
    case range
    case speed
    case chargePower
    case tempInside
    case tempOutside
    case power
    case powerRegen
    case powerIdle
    case odometer
    case idealRange
    case chargeRate
    case timeToFull
    case locked
    case unlocked
    case sentryOn
    case sentryOff
    case firmware
}

// MARK: - Vehicle status (web `state.state`, the FSM operational state)

/// The vehicle's operational state — the seven canonical FSM states (web
/// `types/fsm/vehicle.ts`). Drives the status badge tone (resolved in the view) and a
/// localized label. Unknown / absent state falls back to `offline` (web
/// `state?.state ?? 'offline'`).
public enum VehicleHeroPanelStatus: String, Sendable, Equatable, CaseIterable {
    case online
    case driving
    case charging
    case parked
    case updating
    case asleep
    case offline

    public init(raw: String?) {
        self = VehicleHeroPanelStatus(rawValue: (raw ?? "").lowercased()) ?? .offline
    }

    /// i18n key for the state label (web `vehicle.state.${state}`).
    public var labelKey: String {
        "vehicle.state.\(rawValue)"
    }

    /// English fallback label (web `VEHICLE_STATE_LABELS`).
    public var labelFallback: String {
        switch self {
        case .online: "Online"
        case .driving: "Driving"
        case .charging: "Charging"
        case .parked: "Parked"
        case .updating: "Updating"
        case .asleep: "Asleep"
        case .offline: "Offline"
        }
    }
}

// MARK: - Freshness (web `FreshnessIndicator` timestamp age)

/// The relative-age label + stale flag for the header freshness chip — the native
/// mirror of the web `FreshnessIndicator` fed `lastFetchedAt || vehicle.updated_at`.
public enum VehicleHeroPanelFreshness {
    /// Values older than two minutes read as stale (the cross-pod live-state rule).
    public static let staleAfter: TimeInterval = 120

    /// A compact age token ("now" / "5m" / "2h" / "3d") plus whether it is stale.
    public static func describe(updatedAt: Date?, now: Date) -> (token: String, isStale: Bool) {
        guard let updatedAt else { return ("—", true) }
        let age = max(0, now.timeIntervalSince(updatedAt))
        return (token(for: age), age > staleAfter)
    }

    static func token(for age: TimeInterval) -> String {
        if age < 45 { return "now" }
        if age < 3600 { return "\(Int((age / 60).rounded()))m" }
        if age < 86400 { return "\(Int((age / 3600).rounded()))h" }
        return "\(Int((age / 86400).rounded()))d"
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds VoiceOver strings from already-localised parts so the spoken content is
/// asserted without rendering the view.
public enum VehicleHeroPanelAccessibility {
    /// Header label: "{title}, {status}".
    public static func headerLabel(title: String, status: String) -> String {
        "\(title), \(status)"
    }

    /// Gauge label: "{label}, {value} {unit}" (the unit omitted when empty).
    public static func gaugeLabel(label: String, value: String, unit: String) -> String {
        unit.isEmpty ? "\(label), \(value)" : "\(label), \(value) \(unit)"
    }

    /// Stat-card label: "{label}, {value}".
    public static func statLabel(label: String, value: String) -> String {
        "\(label), \(value)"
    }
}
