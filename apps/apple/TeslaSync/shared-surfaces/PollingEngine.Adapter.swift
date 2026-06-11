//
//  PollingEngine.Adapter.swift
//  TeslaSync — P4 shared surface · 0098 · PollingEngine (Apple)
//
//  The testable, dependency-light core for the adaptive-polling panel — the SwiftUI parity of
//  `web/src/components/data-display/PollingEngine.tsx`. Everything here is pure (Foundation only):
//  the decoded data snapshot (the native peer of the `@/api/polling` types), the activity / profile
//  vocabularies (the verbatim ports of the web `activityIcon` / `profileLabel` / `activityColor`
//  switch tables, with colour expressed as the semantic `PollingTone` so the view binds it to the
//  P1/S9 tokens), the duration decomposition (the structural port of `formatDuration` /
//  `formatTimeUntil`, kept string-free so it is asserted without a bundle), the savings-breakdown
//  segment math (the port of the stacked-bar reduction), the surface metadata (diagnostics slug),
//  the numeric formatter, and the VoiceOver label builders. No store, no bundle, no rendered view,
//  so each piece is unit tested in isolation.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core carries no bundle dependency.
public typealias PollingResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the header chip
/// + banner. `live` hides the banner; `stale` / `offline` show it. The web component refetches on a
/// fixed interval; the native surface layers this freshness axis over the same data (ADR-013).
public enum PollingConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Semantic tone (web `activityColor` / segment colours → P1/S9 tokens)

/// The semantic colour role for an activity chip, savings metric, or breakdown segment. The web
/// source uses raw hexes (`activityColor`, `bg-blue-500`, …); the native surface maps each to a
/// P1/S9 design token in the view layer so light / dark / high-contrast all keep working.
public enum PollingTone: String, Sendable, Equatable, CaseIterable {
    case success
    case info
    case warning
    case muted
    case primary
    case prediction
}

// MARK: - Activity (web `activityIcon` + `activityColor` switch tables)

/// The vehicle activity level — the native peer of the free-form `activity` string the polling
/// engine reports. The known cases reproduce the web `activityIcon` / `activityColor` switch tables
/// exactly; `unknown` preserves an unrecognised server value so it can still be displayed.
public enum PollingActivity: Sendable, Equatable {
    case active
    case critical
    case moderate
    case low
    case idle
    case sleeping
    case unknown(String)

    /// Parse from the raw server string (case-insensitive), matching the web `switch (activity)`.
    public init(raw: String) {
        switch raw.lowercased() {
        case "active": self = .active
        case "critical": self = .critical
        case "moderate": self = .moderate
        case "low": self = .low
        case "idle": self = .idle
        case "sleeping": self = .sleeping
        default: self = .unknown(raw)
        }
    }

    /// The original-cased token for display (web prints `status.activity` verbatim in the chip).
    public var raw: String {
        switch self {
        case .active: "active"
        case .critical: "critical"
        case .moderate: "moderate"
        case .low: "low"
        case .idle: "idle"
        case .sleeping: "sleeping"
        case let .unknown(value): value
        }
    }

    /// The localisation key for the known activity words; `nil` for `unknown` (rendered verbatim).
    public var labelKey: String? {
        switch self {
        case .active: "polling.activity.active"
        case .critical: "polling.activity.critical"
        case .moderate: "polling.activity.moderate"
        case .low: "polling.activity.low"
        case .idle: "polling.activity.idle"
        case .sleeping: "polling.activity.sleeping"
        case .unknown: nil
        }
    }

    /// The semantic tint — the verbatim port of `activityColor` (GOOD / blue / WARN / MUTED / dark).
    public var tone: PollingTone {
        switch self {
        case .active, .critical: .success
        case .moderate: .info
        case .low: .warning
        case .idle, .sleeping, .unknown: .muted
        }
    }

    /// The SF Symbol — the native peer of `activityIcon` (Zap / BatteryCharging / Activity / Moon /
    /// Gauge). `idle` and `sleeping` both read the moon, matching the web mapping.
    public var symbolName: String {
        switch self {
        case .active, .critical: "bolt.fill"
        case .moderate: "battery.100.bolt"
        case .low: "waveform.path.ecg"
        case .idle, .sleeping: "moon.fill"
        case .unknown: "gauge.medium"
        }
    }

    /// Whether the icon pulses — the web animates `scale` only when `activity === 'active'`.
    public var pulses: Bool {
        self == .active
    }
}

// MARK: - Profile (web `profileLabel` switch table)

/// The polling profile — the native peer of the `profile` string. Known cases carry a localisation
/// key (the web `profileLabel` map); `other` preserves an unrecognised value rendered verbatim.
public enum PollingProfile: Sendable, Equatable {
    case driving
    case charging
    case idle
    case sleeping
    case other(String)

    /// Parse from the raw server string (case-insensitive), matching the web `switch (profile)`.
    public init(raw: String) {
        switch raw.lowercased() {
        case "driving": self = .driving
        case "charging": self = .charging
        case "idle": self = .idle
        case "sleeping": self = .sleeping
        default: self = .other(raw)
        }
    }

    /// The localisation key for the known profiles; `nil` for `other` (the web `default` returns the
    /// raw profile string unchanged).
    public var labelKey: String? {
        switch self {
        case .driving: "polling.profile.driving"
        case .charging: "polling.profile.charging"
        case .idle: "polling.profile.idle"
        case .sleeping: "polling.profile.sleeping"
        case .other: nil
        }
    }

    /// The English fallback (web `profileLabel` return value, or the raw value for `other`).
    public var fallback: String {
        switch self {
        case .driving: "Driving"
        case .charging: "Charging"
        case .idle: "Idle"
        case .sleeping: "Sleeping"
        case let .other(value): value
        }
    }
}

// MARK: - Duration (web `formatDuration` / `formatTimeUntil`, kept string-free)

/// The structural decomposition of a duration — the string-free core of `formatDuration`. The
/// projection localises each case (`now` / `Ns` / `Nm` / `Nh Mm`) so the rounding is asserted in
/// isolation while word order stays translator-controlled.
public enum PollingDurationParts: Sendable, Equatable {
    case now
    case seconds(Int)
    case minutes(Int)
    case hoursMinutes(Int, Int)
}

/// Pure duration decomposition — the verbatim port of the web `formatDuration` / `formatTimeUntil`
/// arithmetic (floor seconds, then minutes, then hours + remainder), with the `<= 0 → now` guard.
public enum PollingDuration {
    /// Decompose a millisecond span. Non-finite or non-positive spans collapse to `.now` (web
    /// `if (ms <= 0) return 'now'`).
    public static func decompose(milliseconds: Double) -> PollingDurationParts {
        guard milliseconds.isFinite, milliseconds > 0 else { return .now }
        let totalSeconds = Int(milliseconds / 1000)
        if totalSeconds < 60 { return .seconds(totalSeconds) }
        let totalMinutes = totalSeconds / 60
        if totalMinutes < 60 { return .minutes(totalMinutes) }
        let hours = totalMinutes / 60
        return .hoursMinutes(hours, totalMinutes % 60)
    }

    /// Decompose the span from `now` until `target` — the port of `formatTimeUntil`. A nil target
    /// (an unparseable timestamp) and any past target both collapse to `.now`.
    public static func untilParts(target: Date?, now: Date) -> PollingDurationParts {
        guard let target else { return .now }
        let milliseconds = target.timeIntervalSince(now) * 1000
        return decompose(milliseconds: milliseconds)
    }
}

// MARK: - Savings breakdown (web stacked-bar reduction)

/// One savings-breakdown category — the four keys the web stacked bar + legend render
/// (`fleet_telemetry` / `idle_detection` / `prediction` / `sleep_detection`), each with its API key,
/// localisation, and semantic tint (web `bg-blue-500` / `bg-amber-500` / `bg-purple-500` /
/// `bg-gray-500`).
public enum PollingBreakdownCategory: String, Sendable, Equatable, CaseIterable {
    case fleetTelemetry
    case idleDetection
    case prediction
    case sleepDetection

    /// The snake_case key in the `savings_breakdown` map (web `breakdown.fleet_telemetry`, …).
    public var apiKey: String {
        switch self {
        case .fleetTelemetry: "fleet_telemetry"
        case .idleDetection: "idle_detection"
        case .prediction: "prediction"
        case .sleepDetection: "sleep_detection"
        }
    }

    public var labelKey: String {
        switch self {
        case .fleetTelemetry: "polling.fleetTelemetry"
        case .idleDetection: "polling.idleDetection"
        case .prediction: "polling.prediction"
        case .sleepDetection: "polling.sleep"
        }
    }

    public var fallback: String {
        switch self {
        case .fleetTelemetry: "Fleet Telemetry"
        case .idleDetection: "Idle Detection"
        case .prediction: "Prediction"
        case .sleepDetection: "Sleep"
        }
    }

    public var tone: PollingTone {
        switch self {
        case .fleetTelemetry: .info
        case .idleDetection: .warning
        case .prediction: .prediction
        case .sleepDetection: .muted
        }
    }
}

/// One rendered segment of the breakdown bar — a category, its raw value, and its fraction of the
/// total (the web inline `width: (value / total) * 100%`).
public struct PollingBreakdownSegment: Sendable, Equatable, Identifiable {
    public let id: String
    public let category: PollingBreakdownCategory
    public let value: Double
    public let fraction: Double

    public init(category: PollingBreakdownCategory, value: Double, fraction: Double) {
        id = category.rawValue
        self.category = category
        self.value = value
        self.fraction = fraction
    }
}

/// Pure breakdown reduction — the port of the web `total = Object.values(breakdown).reduce(+)` plus
/// the per-category `value > 0` filter. The total sums *every* key (matching the web denominator),
/// while only the four known categories with a positive value become rendered segments.
public enum PollingBreakdown {
    /// The sum of all breakdown values — the web stacked-bar denominator (`total`).
    public static func total(of breakdown: [String: Double]) -> Double {
        breakdown.values.reduce(0, +)
    }

    /// The rendered segments in canonical order, each fraction relative to the full total. Empty
    /// when the total is not positive (web `total > 0 &&` guard).
    public static func segments(from breakdown: [String: Double]) -> [PollingBreakdownSegment] {
        let total = total(of: breakdown)
        guard total > 0 else { return [] }
        return PollingBreakdownCategory.allCases.compactMap { category in
            let value = breakdown[category.apiKey] ?? 0
            guard value > 0 else { return nil }
            return PollingBreakdownSegment(category: category, value: value, fraction: value / total)
        }
    }
}

// MARK: - Numeric formatting (web `${number}` / `Math.round`)

/// Locale-independent numeric helpers matching the web display (`toFixed`, `${number}`,
/// `Math.round`). Kept deterministic (C-locale digits) so the projection's formatted output is
/// asserted exactly.
public enum PollingNumber {
    /// A whole or minimally-decimal rendering of a value — the peer of JS `${value}` (e.g. battery
    /// level, breakdown counts). Integers render without a decimal point; fractions trim trailing
    /// zeros.
    public static func plain(_ value: Double) -> String {
        guard value.isFinite else { return "0" }
        if value == value.rounded(.towardZero), abs(value) < 1e15 {
            return String(format: "%.0f", value)
        }
        var text = String(format: "%.6f", value)
        while text.hasSuffix("0") {
            text.removeLast()
        }
        if text.hasSuffix(".") { text.removeLast() }
        return text
    }

    /// Fixed-decimal rendering — the peer of `value.toFixed(decimals)` (locale-independent point).
    public static func fixed(_ value: Double, decimals: Int) -> String {
        String(format: "%.\(max(0, decimals))f", value.isFinite ? value : 0)
    }

    /// Rounded integer percent — the peer of `Math.round(confidence * 100)`.
    public static func roundedPercent(_ fraction: Double) -> Int {
        guard fraction.isFinite else { return 0 }
        return Int((fraction * 100).rounded())
    }

    /// Convert a Go-`time.Duration` nanosecond span to milliseconds — the web `estimated_in / 1e6`.
    public static func nanosToMillis(_ nanos: Double) -> Double {
        nanos / 1_000_000
    }
}

// MARK: - VIN

/// VIN display helper — the web `vin.slice(-8)` (the trailing 8 characters, or the whole VIN when
/// shorter).
public enum PollingVIN {
    public static func short(_ vin: String) -> String {
        String(vin.suffix(8))
    }
}

// MARK: - Surface metadata (diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum PollingEngineMeta {
    public static let surfaceSlug = "PollingEngine"
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken content is
/// asserted without rendering the view.
public enum PollingEngineAccessibility {
    /// A savings metric read as "{label}: {value}" (e.g. "Polls Saved: 42.5%").
    public static func metricLabel(label: String, value: String) -> String {
        "\(label): \(value)"
    }

    /// A vehicle row read as "{vin}, {activity}, {profile}, next poll {next}".
    public static func vehicleLabel(vin: String, activity: String, profile: String, next: String) -> String {
        "\(vin), \(activity), \(profile), \(next)"
    }

    /// A freshness state read as its localised word (Live / Stale / Offline).
    public static func freshnessLabel(_ word: String) -> String {
        word
    }
}
