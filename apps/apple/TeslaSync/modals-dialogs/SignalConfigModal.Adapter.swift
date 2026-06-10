//
//  SignalConfigModal.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0016 · SignalConfigModal (Apple)
//
//  The dependency-free domain layer for the Fleet Telemetry signal-configuration modal — the
//  faithful port of components/ui/SignalConfigModal.tsx. The web source is a pure presentational
//  dialog: it receives the available-signal catalog (`categories`), an initial selection, and a
//  default interval, lets the operator pick which signals to stream and at what cadence (per signal,
//  per category, or globally via 8 presets + a master interval), then hands the chosen
//  `{ name, interval }[]` to `onSubmit`. Everything here is pure Foundation so the interval catalog,
//  the 8 presets' apply logic, the editable row model, and the load/freshness/phase enums are all
//  unit-testable without a bundle or a rendered view. The pure projection (grouping, filtering,
//  counts, phase, summary, submit payload, category icon) lives in SignalConfigModal.Projection.swift.
//
//  Web parity notes:
//    • `INTERVAL_OPTIONS` (10 cadences, 500 ms … 24 h) → `SignalConfigInterval` catalog.
//    • `PRESETS` (8 category-keyed presets) → `SignalConfigPreset` (enum + `apply(to:)`).
//    • `CATEGORY_ICONS` (lucide map) → `SignalConfigProjection.iconSystemName(for:)` (SF Symbols).
//    • `SignalConfig { name, category, selected, interval }` → `SignalConfigRow`.
//    • the presentational dialog is widened with loading / empty / error / freshness envelopes so no
//      state is ever a blank box (engineering guideline #6), matching the prior modals-dialogs tier.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so
/// the projection's unit tests can reach it.
public enum SignalConfigSurface {
    public static let slug = "SignalConfigModal"
}

// MARK: - Interval catalog (web `INTERVAL_OPTIONS`)

/// The semantic cadence band an interval falls into (web `INTERVAL_OPTIONS[i].color`). Kept as data
/// so the pure layer stays free of `Color`; the view maps each band to a token tint.
public enum SignalConfigIntervalTone: String, Sendable, Equatable, CaseIterable {
    case realtime
    case fast
    case medium
    case standard
    case slow
    case rare
}

/// One streaming-cadence option (web `INTERVAL_OPTIONS` entry): the interval in seconds, the short
/// unit label rendered verbatim (`500ms` … `24h`), the localized descriptor key/fallback, and the
/// semantic tone band. `value == 0` is the 500 ms real-time cadence (web `0 → '500ms'`).
public struct SignalConfigInterval: Sendable, Equatable, Identifiable {
    public let value: Int
    public let label: String
    public let descKey: String
    public let descFallback: String
    public let tone: SignalConfigIntervalTone

    public var id: Int {
        value
    }

    public init(
        value: Int,
        label: String,
        descKey: String,
        descFallback: String,
        tone: SignalConfigIntervalTone
    ) {
        self.value = value
        self.label = label
        self.descKey = descKey
        self.descFallback = descFallback
        self.tone = tone
    }
}

/// The catalog of streaming cadences + the default selection, ported verbatim from the web
/// `INTERVAL_OPTIONS` (index 3 = 10 s is the web default).
public enum SignalConfigCatalog {
    public static let intervals: [SignalConfigInterval] = [
        SignalConfigInterval(value: 0, label: "500ms", descKey: descKey(0), descFallback: "Real-time", tone: .realtime),
        SignalConfigInterval(value: 1, label: "1s", descKey: descKey(1), descFallback: "Fast", tone: .fast),
        SignalConfigInterval(value: 5, label: "5s", descKey: descKey(5), descFallback: "Medium", tone: .medium),
        SignalConfigInterval(value: 10, label: "10s", descKey: descKey(10), descFallback: "Default", tone: .standard),
        SignalConfigInterval(value: 30, label: "30s", descKey: descKey(30), descFallback: "Slow", tone: .slow),
        SignalConfigInterval(value: 60, label: "60s", descKey: descKey(60), descFallback: "1 min", tone: .slow),
        SignalConfigInterval(value: 300, label: "5m", descKey: descKey(300), descFallback: "Rare", tone: .rare),
        SignalConfigInterval(value: 900, label: "15m", descKey: descKey(900), descFallback: "15 min", tone: .rare),
        SignalConfigInterval(value: 3600, label: "1h", descKey: descKey(3600), descFallback: "1 hour", tone: .rare),
        SignalConfigInterval(value: 86400, label: "24h", descKey: descKey(86400), descFallback: "Daily", tone: .rare)
    ]

    /// The web default cadence (`INTERVAL_OPTIONS[3]` = 10 s) used when a row's interval is unknown.
    public static let defaultIntervalValue = 10

    /// The real-time cadence value (500 ms) the footer counts (web `interval === 0`).
    public static let realtimeIntervalValue = 0

    /// Resolves the catalog entry for an interval value, falling back to the 10 s default (web
    /// `INTERVAL_OPTIONS.find(...) || INTERVAL_OPTIONS[3]`).
    public static func interval(for value: Int) -> SignalConfigInterval {
        intervals.first { $0.value == value } ?? intervals[3]
    }

    private static func descKey(_ value: Int) -> String {
        "signals.config.interval.\(value).desc"
    }
}

// MARK: - Input catalog (web `CategoryDef`)

/// One available-signal category and its field identifiers — the native parity of the web
/// `CategoryDef { category, fields }`. The category name + field names are Tesla-domain data
/// (rendered verbatim, never translated).
public struct SignalConfigCategoryCatalog: Sendable, Equatable, Identifiable {
    public let category: String
    public let fields: [String]

    public var id: String {
        category
    }

    public init(category: String, fields: [String]) {
        self.category = category
        self.fields = fields
    }
}

// MARK: - Editable row (web `SignalConfig`)

/// One editable signal row — the native parity of the web `SignalConfig { name, category, selected,
/// interval }`. The draft list of these is the modal's working state; `submit` projects the selected
/// rows into the `{ name, interval }` payload.
public struct SignalConfigRow: Sendable, Equatable, Identifiable {
    public let name: String
    public let category: String
    public var selected: Bool
    public var interval: Int

    public var id: String {
        name
    }

    public init(name: String, category: String, selected: Bool, interval: Int) {
        self.name = name
        self.category = category
        self.selected = selected
        self.interval = interval
    }
}

// MARK: - Load status / freshness / phase / selection

/// The bound source's load status for the available-signal catalog (web parent's `useSignals`
/// query). The web modal receives a resolved catalog as a prop; the native surface models the load
/// lifecycle so every state renders.
public enum SignalConfigLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so the
/// surface clearly labels when the catalog came from a cached read rather than a live fetch.
public enum SignalConfigConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the dialog body renders at the top level. The web only ever shows the populated config form;
/// the loading / empty / error envelopes are added so a first-load (no cached catalog) is never a
/// blank box (engineering guideline #6).
public enum SignalConfigPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case populated
}

/// A category header's tri-state selection (web `allCatSelected` / `someCatSelected`): every field
/// on, some fields on, or none.
public enum SignalConfigCategoryState: Sendable, Equatable {
    case none
    case some
    case all
}

// MARK: - Grouped output + footer summary + submit payload

/// One category group of rows (web `grouped` `Map<string, SignalConfig[]>` entry), preserving the
/// catalog's category order.
public struct SignalConfigGroup: Sendable, Equatable, Identifiable {
    public let category: String
    public let rows: [SignalConfigRow]

    public var id: String {
        category
    }

    public init(category: String, rows: [SignalConfigRow]) {
        self.category = category
        self.rows = rows
    }
}

/// The footer summary counts (web footer line): total selected, how many stream at 500 ms, and how
/// many at the 10 s default.
public struct SignalConfigSummary: Sendable, Equatable {
    public let selected: Int
    public let realtime: Int
    public let standard: Int

    public init(selected: Int, realtime: Int, standard: Int) {
        self.selected = selected
        self.realtime = realtime
        self.standard = standard
    }
}

/// One entry of the submit payload (web `onSubmit({ name, interval }[])`).
public struct SignalConfigSubscription: Sendable, Equatable, Identifiable {
    public let name: String
    public let interval: Int

    public var id: String {
        name
    }

    public init(name: String, interval: Int) {
        self.name = name
        self.interval = interval
    }
}

// MARK: - Presets (web `PRESETS`)

/// The 8 one-tap configuration presets (web `PRESETS`). Each is a category-keyed rule that sets a
/// row's `selected` + `interval`; `apply(to:)` is the faithful port of the web `apply` closures.
/// Modeled as an enum (not stored closures) so it is `Sendable`, `CaseIterable`, and unit-testable.
public enum SignalConfigPreset: String, Sendable, Equatable, CaseIterable, Identifiable {
    case realtimeDriving
    case balanced
    case lowPower
    case trackMode
    case costSaver
    case sleepWatch
    case diagnostics
    case tripLogger

    public var id: String {
        rawValue
    }

    /// The localized preset-name key (the view pairs it with `iconSystemName`).
    public var nameKey: String {
        "signals.config.preset.\(rawValue).name"
    }

    /// The web preset name (sans the leading emoji, which the view renders as an SF Symbol).
    public var nameFallback: String {
        switch self {
        case .realtimeDriving: "Real-time Driving"
        case .balanced: "Balanced"
        case .lowPower: "Low Power"
        case .trackMode: "Track Mode"
        case .costSaver: "Cost Saver"
        case .sleepWatch: "Sleep Watch"
        case .diagnostics: "Diagnostics"
        case .tripLogger: "Trip Logger"
        }
    }

    /// The localized preset-description key (web `desc`, shown as the control's help/VoiceOver hint).
    public var descKey: String {
        "signals.config.preset.\(rawValue).desc"
    }

    /// The web preset description (the `title` tooltip).
    public var descFallback: String {
        switch self {
        case .realtimeDriving: "Driving signals at 1s, battery at 10s, config at 24h"
        case .balanced: "All signals at 10s — good balance of data and battery"
        case .lowPower: "All signals at 60s — minimal battery impact"
        case .trackMode: "Driving & powertrain at 1s, everything else at 30s"
        case .costSaver: "Essential signals only at 5–15min, non-essentials off"
        case .sleepWatch: "Security & location at 60s, charging at 1min, rest off"
        case .diagnostics: "Powertrain/tires/climate at 5s, driving at 10s"
        case .tripLogger: "Location at 1s, driving at 5s — optimized for routes"
        }
    }

    /// The SF Symbol the view renders in place of the web emoji prefix.
    public var iconSystemName: String {
        switch self {
        case .realtimeDriving: "bolt.fill"
        case .balanced: "scalemass.fill"
        case .lowPower: "battery.25percent"
        case .trackMode: "flag.checkered"
        case .costSaver: "dollarsign.circle.fill"
        case .sleepWatch: "moon.zzz.fill"
        case .diagnostics: "wrench.and.screwdriver.fill"
        case .tripLogger: "map.fill"
        }
    }

    /// Applies the preset to a draft list (web `PRESETS[i].apply(fields)`), returning a new list.
    public func apply(to rows: [SignalConfigRow]) -> [SignalConfigRow] {
        rows.map { row in
            var next = row
            next.selected = selects(category: row.category)
            next.interval = interval(for: row.category)
            return next
        }
    }

    /// Whether the preset selects a row in the given category (web `selected:` arms).
    private func selects(category: String) -> Bool {
        switch self {
        case .realtimeDriving, .balanced, .lowPower, .trackMode, .diagnostics:
            true
        case .costSaver:
            ["Location", "Charging", "Vehicle State", "Safety"].contains(category)
        case .sleepWatch:
            ["Safety", "Vehicle State", "Location", "Charging", "Climate"].contains(category)
        case .tripLogger:
            !["Media", "User Preference", "Vehicle Config"].contains(category)
        }
    }

    /// The interval the preset assigns to a row in the given category (web `interval:` arms),
    /// resolved by the first matching rule, else the preset's default cadence.
    private func interval(for category: String) -> Int {
        for rule in intervalRules where rule.categories.contains(category) {
            return rule.interval
        }
        return defaultInterval
    }

    /// One category-keyed interval rule (web `interval:` ternary arm).
    private struct IntervalRule {
        let categories: Set<String>
        let interval: Int
    }

    /// The preset's ordered interval rules — the first whose category set matches a row wins.
    private var intervalRules: [IntervalRule] {
        switch self {
        case .realtimeDriving:
            [
                IntervalRule(categories: ["Driving", "Powertrain", "Location"], interval: 1),
                IntervalRule(categories: ["Charging", "Climate", "Tires & Service"], interval: 10),
                IntervalRule(categories: ["Vehicle Config", "User Preference"], interval: 86400)
            ]
        case .balanced, .lowPower:
            []
        case .trackMode:
            [
                IntervalRule(categories: ["Driving", "Powertrain", "Location"], interval: 1),
                IntervalRule(categories: ["Vehicle Config", "User Preference"], interval: 3600)
            ]
        case .costSaver:
            [IntervalRule(categories: ["Vehicle State"], interval: 900)]
        case .sleepWatch:
            [IntervalRule(categories: ["Safety", "Vehicle State", "Charging"], interval: 60)]
        case .diagnostics:
            [
                IntervalRule(categories: ["Powertrain", "Tires & Service", "Climate"], interval: 5),
                IntervalRule(
                    categories: ["Driving", "Charging", "Vehicle State", "Safety", "Location"], interval: 10
                ),
                IntervalRule(categories: ["Media"], interval: 60)
            ]
        case .tripLogger:
            [
                IntervalRule(categories: ["Location"], interval: 1),
                IntervalRule(categories: ["Driving"], interval: 5),
                IntervalRule(categories: ["Powertrain", "Charging"], interval: 30),
                IntervalRule(categories: ["Climate", "Vehicle State", "Safety"], interval: 60)
            ]
        }
    }

    /// The preset's fallback cadence when no interval rule matches (web final `: N` arm).
    private var defaultInterval: Int {
        switch self {
        case .realtimeDriving, .balanced: 10
        case .lowPower: 60
        case .trackMode: 30
        case .costSaver, .sleepWatch, .tripLogger: 300
        case .diagnostics: 3600
        }
    }
}
