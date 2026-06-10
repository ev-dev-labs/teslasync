//
//  SignalCompareControls.Core.swift
//  TeslaSync — P4 feature view · 0267 · SignalCompareControls (Apple)
//
//  Pure, dependency-free support types ported verbatim from the web source
//  (features/telemetry/components/SignalCompareControls.tsx): the 8 signal
//  category prefixes (`CATEGORY_PREFIXES`), the 5 datetime presets (`DIFF_PRESETS`
//  + `DiffPresetId`), the controlled selection the parent owns (web `atA` / `atB`
//  / `search` / `category`), the render phase / freshness enums, the diagnostics
//  surface slug, and the local-datetime ⇄ ISO helpers (`toLocalDatetimeInput` /
//  `isoOrEmpty`). Foundation only, so the whole adapter is unit-testable without a
//  rendered view or a bundle.
//

import Foundation

// MARK: - Category prefixes (web `CATEGORY_PREFIXES`)

/// One signal category prefix (web `CATEGORY_PREFIXES[n]`): a stable id, the i18n
/// key + English fallback for its chip, and the case-insensitive name predicate the
/// pages reuse to drive the server-side filter string.
public struct SignalDiffCategory: Sendable, Equatable, Identifiable {
    public let id: String
    public let labelKey: String
    public let defaultLabel: String
    /// The regular-expression source (web literal `/…/i`), matched case-insensitively.
    public let pattern: String

    public init(id: String, labelKey: String, defaultLabel: String, pattern: String) {
        self.id = id
        self.labelKey = labelKey
        self.defaultLabel = defaultLabel
        self.pattern = pattern
    }

    /// Web `matches(name)`: whether a signal name belongs to this category.
    public func matches(_ name: String) -> Bool {
        name.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// The 8 prefixes in the web display order (battery → safety).
    public static let all: [SignalDiffCategory] = [
        SignalDiffCategory(
            id: "battery", labelKey: "signalDiff.cat.battery", defaultLabel: "Battery",
            pattern: "battery|charge|soc|range|kwh"
        ),
        SignalDiffCategory(
            id: "drive", labelKey: "signalDiff.cat.drive", defaultLabel: "Drive",
            pattern: "speed|odometer|gear|drive|brake|throttle|steering"
        ),
        SignalDiffCategory(
            id: "climate", labelKey: "signalDiff.cat.climate", defaultLabel: "Climate",
            pattern: "climate|hvac|cabin|seat|temp"
        ),
        SignalDiffCategory(
            id: "security", labelKey: "signalDiff.cat.security", defaultLabel: "Security",
            pattern: "lock|sentry|alarm|valet|guard"
        ),
        SignalDiffCategory(
            id: "motor", labelKey: "signalDiff.cat.motor", defaultLabel: "Motor",
            pattern: "motor|inverter|torque|rpm"
        ),
        SignalDiffCategory(
            id: "tire", labelKey: "signalDiff.cat.tire", defaultLabel: "Tire",
            pattern: "tpms|tire|pressure"
        ),
        SignalDiffCategory(
            id: "media", labelKey: "signalDiff.cat.media", defaultLabel: "Media",
            pattern: "media|audio|volume|playback"
        ),
        SignalDiffCategory(
            id: "safety", labelKey: "signalDiff.cat.safety", defaultLabel: "Safety",
            pattern: "airbag|seatbelt|fcw|aeb|safety"
        )
    ]

    /// Looks a category up by id (web `CATEGORY_PREFIXES.find`).
    public static func category(id: String?) -> SignalDiffCategory? {
        guard let id else { return nil }
        return all.first { $0.id == id }
    }
}

// MARK: - Datetime presets (web `DiffPresetId` / `DIFF_PRESETS`)

/// The 5 quick-preset identifiers (web `DiffPresetId`), declared in the web display
/// order so `allCases` drives the button row.
public enum SignalDiffPresetID: String, Sendable, CaseIterable, Identifiable {
    case nowVs1h = "now-vs-1h"
    case nowVs1d = "now-vs-1d"
    case beforeAfterCharge = "before-after-charge"
    case lastDrive = "last-drive"
    case todayVsYesterday = "today-vs-yesterday"

    public var id: String {
        rawValue
    }
}

/// One datetime preset (web `DIFF_PRESETS[n]`): the id, its i18n key + English
/// fallback, and the two offsets (seconds before "now") it computes its window from.
public struct SignalDiffPreset: Sendable, Equatable, Identifiable {
    public let id: SignalDiffPresetID
    public let labelKey: String
    public let defaultLabel: String
    /// Seconds subtracted from "now" for window A (web `atA`).
    public let secondsBeforeA: TimeInterval
    /// Seconds subtracted from "now" for window B (web `atB`; 0 = now).
    public let secondsBeforeB: TimeInterval

    public init(
        id: SignalDiffPresetID,
        labelKey: String,
        defaultLabel: String,
        secondsBeforeA: TimeInterval,
        secondsBeforeB: TimeInterval
    ) {
        self.id = id
        self.labelKey = labelKey
        self.defaultLabel = defaultLabel
        self.secondsBeforeA = secondsBeforeA
        self.secondsBeforeB = secondsBeforeB
    }

    /// Web `compute()`: the (A, B) instant pair relative to `now`.
    public func window(now: Date) -> (atA: Date, atB: Date) {
        (now.addingTimeInterval(-secondsBeforeA), now.addingTimeInterval(-secondsBeforeB))
    }

    /// The 5 presets with the web offsets (1h / 1d / last charge / last drive / yesterday).
    public static let all: [SignalDiffPreset] = [
        SignalDiffPreset(
            id: .nowVs1h, labelKey: "signalDiff.preset.nowVs1h", defaultLabel: "Now vs 1h ago",
            secondsBeforeA: 3600, secondsBeforeB: 0
        ),
        SignalDiffPreset(
            id: .nowVs1d, labelKey: "signalDiff.preset.nowVs1d", defaultLabel: "Now vs 1 day ago",
            secondsBeforeA: 86400, secondsBeforeB: 0
        ),
        SignalDiffPreset(
            id: .beforeAfterCharge, labelKey: "signalDiff.preset.beforeAfterCharge",
            defaultLabel: "Before vs after last charge",
            secondsBeforeA: 4 * 3600, secondsBeforeB: 0
        ),
        SignalDiffPreset(
            id: .lastDrive, labelKey: "signalDiff.preset.lastDrive",
            defaultLabel: "Last drive start vs end",
            secondsBeforeA: 90 * 60, secondsBeforeB: 5 * 60
        ),
        SignalDiffPreset(
            id: .todayVsYesterday, labelKey: "signalDiff.preset.todayVsYesterday",
            defaultLabel: "Today vs yesterday (same time)",
            secondsBeforeA: 86400, secondsBeforeB: 0
        )
    ]

    /// Looks a preset up by id (web `DIFF_PRESETS.find`).
    public static func preset(id: SignalDiffPresetID) -> SignalDiffPreset? {
        all.first { $0.id == id }
    }
}

// MARK: - Controlled selection (web parent-owned props)

/// The controlled state the host owns and the bar edits (web `atA` / `atB` / `search`
/// / `category`). `atA` / `atB` are `datetime-local` strings (web `toLocalDatetimeInput`
/// format); `category` is the selected prefix id or `nil`.
public struct SignalCompareSelection: Sendable, Equatable {
    public var atA: String
    public var atB: String
    public var search: String
    public var category: String?

    public init(atA: String = "", atB: String = "", search: String = "", category: String? = nil) {
        self.atA = atA
        self.atB = atB
        self.search = search
        self.category = category
    }
}

// MARK: - Render phase / load status / freshness

/// What the surface renders at the top level. With a resolved selection it shows the
/// controls (`.content`); loading / failed without a cached selection map to the
/// skeleton / retry chrome; a resolved-but-no-comparable-signals source maps to the
/// friendly empty.
public enum SignalComparePhase: Sendable, Equatable {
    case loading
    case error(String)
    case empty
    case content
}

/// The bound source's load status for the compare context (web parent `isLoading` /
/// resolved / failure).
public enum SignalCompareLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner.
/// Snapshots fall back to `signal_log` when the live layer is stale / offline, so a
/// cached window is clearly labeled (web `HelpTooltip` snapshot note).
public enum SignalCompareConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (P1/S11), in the
/// dependency-free core so the projection tests can reach it.
public enum SignalCompareSurface {
    public static let slug = "SignalCompareControls"
}

// MARK: - Datetime helpers (web `toLocalDatetimeInput` / `isoOrEmpty`)

/// The `datetime-local` ⇄ `Date` ⇄ ISO conversions ported from the web source. Pure +
/// bundle-free, with an injectable calendar / time zone so the round-trips are testable
/// independent of the runner's locale (the web uses the browser's local zone).
public enum SignalCompareDateFormat {
    /// The `datetime-local` field format (web `yyyy-MM-ddTHH:mm`, local components).
    public static let localPattern = "yyyy-MM-dd'T'HH:mm"

    /// The `Date.toISOString()` shape (UTC, millisecond precision) web `isoOrEmpty` emits.
    public static let isoPattern = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"

    private static func formatter(_ pattern: String, timeZone: TimeZone) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        formatter.dateFormat = pattern
        return formatter
    }

    /// Web `toLocalDatetimeInput(date)`: the local `yyyy-MM-ddTHH:mm` field value.
    public static func toLocalDatetimeInput(_ date: Date, timeZone: TimeZone = .current) -> String {
        formatter(localPattern, timeZone: timeZone).string(from: date)
    }

    /// Parses a `datetime-local` field value back to an instant (web `new Date(local)`).
    public static func parseLocalDatetimeInput(_ value: String, timeZone: TimeZone = .current) -> Date? {
        guard !value.isEmpty else { return nil }
        return formatter(localPattern, timeZone: timeZone).date(from: value)
    }

    /// Web `isoOrEmpty(localValue)`: the UTC ISO string for a field value, or `""` when
    /// the value is empty / unparseable.
    public static func isoOrEmpty(_ localValue: String, timeZone: TimeZone = .current) -> String {
        guard let date = parseLocalDatetimeInput(localValue, timeZone: timeZone) else { return "" }
        return formatter(isoPattern, timeZone: TimeZone(identifier: "UTC") ?? .current).string(from: date)
    }
}
