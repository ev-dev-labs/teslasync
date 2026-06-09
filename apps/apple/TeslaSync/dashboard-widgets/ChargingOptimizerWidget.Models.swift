//
//  ChargingOptimizerWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0022 · ChargingOptimizerWidget (Apple)
//
//  Domain value types ported from the web source
//  (features/dashboard/widgets/ChargingOptimizerWidget.tsx + types/charging.ts):
//  the cached optimizer DTOs the state-holder seam delivers, the display
//  formatting context (locale + currency symbol), the badge tone the schedule /
//  recommendation maps to, the per-hour rate-timeline slot, the recommendation
//  tip, and the merged projection the view renders. No SwiftUI / transport here —
//  this is the deterministic core iOS, iPadOS, macOS, and the web all agree on.
//
//  Every type is prefixed `ChargingOptimizer*` so it links cleanly in the single
//  flat app module alongside the other dashboard-widget surfaces.
//

import Foundation

// MARK: - Cached DTO inputs (web `ChargingOptimizerData` → `types/charging.ts`)

/// The recurring-charge schedule summary, faithful to the web `OptimizerSchedule`
/// (`current_schedule`). Only the two fields the widget reads are modeled, both
/// `nil`-safe so the adapter can reproduce the web defensive reads
/// (`most_common_start_hour ?? 0`, `avg_charge_to_pct ?? 0`).
public struct ChargingOptimizerScheduleInput: Sendable, Equatable {
    /// Hour-of-day (0…23) the vehicle most often starts charging (web
    /// `most_common_start_hour`).
    public var mostCommonStartHour: Int?
    /// Average state-of-charge target percentage (web `avg_charge_to_pct`).
    public var avgChargeToPct: Double?

    public init(mostCommonStartHour: Int? = nil, avgChargeToPct: Double? = nil) {
        self.mostCommonStartHour = mostCommonStartHour
        self.avgChargeToPct = avgChargeToPct
    }
}

/// The time-of-use cost analysis, faithful to the web `OptimizerCostAnalysis`
/// (`cost_analysis`). The widget reads the potential monthly savings, the share
/// of sessions during peak hours, and the peak / off-peak hour lists that drive
/// the 24-hour rate timeline.
public struct ChargingOptimizerCostInput: Sendable, Equatable {
    /// Estimated monthly savings from shifting to off-peak (web
    /// `potential_monthly_savings`).
    public var potentialMonthlySavings: Double?
    /// Percentage of charge sessions that occurred during peak hours (web
    /// `sessions_during_peak_pct`).
    public var sessionsDuringPeakPct: Double?
    /// Peak hours-of-day, 0…23 (web `peak_hours`).
    public var peakHours: [Int]
    /// Off-peak hours-of-day, 0…23 (web `offpeak_hours`).
    public var offpeakHours: [Int]

    public init(
        potentialMonthlySavings: Double? = nil,
        sessionsDuringPeakPct: Double? = nil,
        peakHours: [Int] = [],
        offpeakHours: [Int] = []
    ) {
        self.potentialMonthlySavings = potentialMonthlySavings
        self.sessionsDuringPeakPct = sessionsDuringPeakPct
        self.peakHours = peakHours
        self.offpeakHours = offpeakHours
    }
}

/// One smart-charging recommendation, faithful to the web
/// `OptimizerRecommendation` (`title`, `detail`, `priority`). `id` is a stable
/// key for the SwiftUI list; every display field is `nil`-safe so the adapter can
/// reproduce the web `?? '—'` fallbacks.
public struct ChargingOptimizerRecommendationInput: Sendable, Equatable, Identifiable {
    public let id: Int
    /// Recommendation headline (web `rec.title`).
    public var title: String?
    /// Recommendation body (web `rec.detail`).
    public var detail: String?
    /// Severity slug — `high` / `medium` / `low` (web `rec.priority`).
    public var priority: String?

    public init(id: Int, title: String? = nil, detail: String? = nil, priority: String? = nil) {
        self.id = id
        self.title = title
        self.detail = detail
        self.priority = priority
    }
}

/// The merged optimizer payload the state-holder seam delivers — the native
/// counterpart of the web `ChargingOptimizerData`. Modeled as an optional at the
/// `ChargingOptimizerWidgetUpdate` level so a `nil` payload reproduces the web `!data`
/// top-level empty state, while an empty-but-present payload still renders the
/// content body (with zeroed values), exactly like the web.
public struct ChargingOptimizerInput: Sendable, Equatable {
    /// The recurring-charge schedule (web `current_schedule`).
    public var schedule: ChargingOptimizerScheduleInput?
    /// The time-of-use cost analysis (web `cost_analysis`).
    public var cost: ChargingOptimizerCostInput?
    /// The smart-charging recommendations (web `recommendations`).
    public var recommendations: [ChargingOptimizerRecommendationInput]

    public init(
        schedule: ChargingOptimizerScheduleInput? = nil,
        cost: ChargingOptimizerCostInput? = nil,
        recommendations: [ChargingOptimizerRecommendationInput] = []
    ) {
        self.schedule = schedule
        self.cost = cost
        self.recommendations = recommendations
    }
}

// MARK: - Display-formatting context (web useFormatting + numberFormat globals)

/// The locale + currency context the projection bakes into its already-formatted
/// strings, mirroring the web `fmtNumber` / `fmtInt` global locale and the `$`
/// currency prefix. The production source fills this from the shared settings
/// store; previews / tests pass it explicitly so the adapter is deterministic.
public struct ChargingOptimizerFormatting: Sendable, Equatable {
    /// BCP-47 locale identifier for number rendering (web settings locale).
    public var localeIdentifier: String
    /// Currency symbol prefix for the savings figures (web literal `$`).
    public var currencySymbol: String

    public init(localeIdentifier: String = "en_US", currencySymbol: String = "$") {
        self.localeIdentifier = localeIdentifier
        self.currencySymbol = currencySymbol
    }

    /// US-English / `$` default used by previews and the empty model state.
    public static let `default` = ChargingOptimizerFormatting()

    /// The resolved `Locale` for the number formatters.
    public var locale: Locale {
        Locale(identifier: localeIdentifier)
    }
}

// MARK: - Badge tone (web `<Badge variant>` + `impactBadgeMap`)

/// Semantic tone a schedule-match or recommendation-impact chip maps to, unifying
/// the web schedule badge (`success` / `warning`) and the tip impact map
/// (`high`→success, `medium`→warning, `low`→neutral). Kept SwiftUI-free here; the
/// view maps it to a `TSTone` at render time.
public enum ChargingOptimizerTone: Sendable, Equatable {
    case success
    case warning
    case neutral
}

// MARK: - Rate-timeline slot (web wide-mode 24h bar segment)

/// The rate classification for a single hour in the 24-hour timeline, faithful to
/// the web per-cell `isPeak` / `isOffpeak` / neither branch (peak wins when an
/// hour appears in both lists, matching the web `title` ternary).
public enum ChargingOptimizerSlotKind: Sendable, Equatable {
    case peak
    case offpeak
    case standard
}

/// One hour cell of the wide-mode 24-hour rate timeline (web `Array.from({length:
/// 24})` map). Carries the pre-resolved hour label + rate-kind label so the view
/// performs no formatting or localization.
public struct ChargingOptimizerHourSlot: Sendable, Equatable, Identifiable {
    /// Hour-of-day, 0…23 — also the stable SwiftUI key.
    public let id: Int
    /// The rate classification driving the cell tint (web bg class).
    public var kind: ChargingOptimizerSlotKind
    /// Whether this hour is the optimal charge start (web `Zap` overlay).
    public var isOptimalStart: Bool
    /// `formatHour(h)` label for the cell's accessibility / tooltip text.
    public var hourText: String
    /// Localized rate-kind label (web `Peak` / `Off-peak` / `Standard`).
    public var kindLabel: String

    public init(
        id: Int,
        kind: ChargingOptimizerSlotKind,
        isOptimalStart: Bool,
        hourText: String,
        kindLabel: String
    ) {
        self.id = id
        self.kind = kind
        self.isOptimalStart = isOptimalStart
        self.hourText = hourText
        self.kindLabel = kindLabel
    }
}

// MARK: - Recommendation tip (web `TipItem`)

/// A fully-formatted recommendation card, faithful to the web `TipItem` mapped
/// from each recommendation (`title`, `description`, the optional `impact` tone +
/// localized `impactLabel`). Every string is display-ready.
public struct ChargingOptimizerTip: Sendable, Equatable, Identifiable {
    /// Stable list key (web `id: i`, the recommendation index).
    public let id: Int
    /// Card headline (web `rec.title ?? '—'`).
    public var title: String
    /// Card body (web `rec.detail ?? '—'`).
    public var detail: String
    /// Impact tone — `nil` when the priority is unknown (web `?? undefined`), in
    /// which case no impact chip renders.
    public var impact: ChargingOptimizerTone?
    /// Localized impact chip label (web
    /// `t('widget.chargingOptimizer.priority.{priority}', priority)`).
    public var impactLabel: String?

    public init(
        id: Int,
        title: String,
        detail: String,
        impact: ChargingOptimizerTone? = nil,
        impactLabel: String? = nil
    ) {
        self.id = id
        self.title = title
        self.detail = detail
        self.impact = impact
        self.impactLabel = impactLabel
    }
}

// MARK: - Projection (the merged view-model the view switches over)

/// The fully-projected widget content — the single value the view renders. Mirror
/// of the web `ChargingOptimizerWidget` body: the three key metrics, the
/// schedule-match chip, the wide-mode 24-hour timeline, and the recommendation
/// tips. `hasData` mirrors the web `!data` gate (the payload resolved at all).
public struct ChargingOptimizerProjection: Sendable, Equatable {
    /// Whether the optimizer payload resolved (web `data != null`).
    public var hasData: Bool
    /// Optimal charge-start hour, 0…23 (web `most_common_start_hour ?? 0`).
    public var optimalStartHour: Int
    /// `formatHour(optimalStartHour)` headline (web compact + stat tile).
    public var optimalStartText: String
    /// Target-SOC stat-tile value `"{pct}%"` (web `${fmtInt(targetSoc)}%`).
    public var targetSocText: String
    /// Compact target-SOC line `"SOC {pct}%"` (web `targetSocShort`).
    public var targetSocShortText: String
    /// Savings stat-tile value `"${amount}"` (web `${fmtNumber(savings, 0)}`).
    public var savingsText: String
    /// Compact savings chip `"${amount}/mo"` — `nil` when savings ≤ 0, matching
    /// the web `monthlySavings > 0 &&` guard.
    public var savingsShortText: String?
    /// Raw monthly savings, retained for the compact badge gate + accessibility.
    public var monthlySavings: Double
    /// Peak-usage line `"Peak charging: {pct}%"` (web `peakUsage`).
    public var peakUsageText: String
    /// Whether the schedule is already optimal (web `peakPct < 30`).
    public var scheduleMatchesOptimal: Bool
    /// Schedule chip label (web `Optimized` / `Can improve`).
    public var scheduleBadgeText: String
    /// Schedule chip tone (web `success` / `warning`).
    public var scheduleBadgeTone: ChargingOptimizerTone
    /// The 24 hour cells of the wide-mode rate timeline.
    public var timeline: [ChargingOptimizerHourSlot]
    /// The five evenly-spaced axis labels under the timeline (web `12 AM … 12 AM`).
    public var timelineAxisLabels: [String]
    /// The recommendation tips (web `tips`).
    public var tips: [ChargingOptimizerTip]

    public init(
        hasData: Bool,
        optimalStartHour: Int,
        optimalStartText: String,
        targetSocText: String,
        targetSocShortText: String,
        savingsText: String,
        savingsShortText: String?,
        monthlySavings: Double,
        peakUsageText: String,
        scheduleMatchesOptimal: Bool,
        scheduleBadgeText: String,
        scheduleBadgeTone: ChargingOptimizerTone,
        timeline: [ChargingOptimizerHourSlot],
        timelineAxisLabels: [String],
        tips: [ChargingOptimizerTip]
    ) {
        self.hasData = hasData
        self.optimalStartHour = optimalStartHour
        self.optimalStartText = optimalStartText
        self.targetSocText = targetSocText
        self.targetSocShortText = targetSocShortText
        self.savingsText = savingsText
        self.savingsShortText = savingsShortText
        self.monthlySavings = monthlySavings
        self.peakUsageText = peakUsageText
        self.scheduleMatchesOptimal = scheduleMatchesOptimal
        self.scheduleBadgeText = scheduleBadgeText
        self.scheduleBadgeTone = scheduleBadgeTone
        self.timeline = timeline
        self.timelineAxisLabels = timelineAxisLabels
        self.tips = tips
    }

    /// Whether any recommendations resolved (web `tips.length > 0`).
    public var hasTips: Bool {
        !tips.isEmpty
    }

    /// The resolved-but-absent projection (web `!data` → "No optimizer data").
    public static let empty = ChargingOptimizerProjection(
        hasData: false,
        optimalStartHour: 0,
        optimalStartText: "",
        targetSocText: "",
        targetSocShortText: "",
        savingsText: "",
        savingsShortText: nil,
        monthlySavings: 0,
        peakUsageText: "",
        scheduleMatchesOptimal: false,
        scheduleBadgeText: "",
        scheduleBadgeTone: .warning,
        timeline: [],
        timelineAxisLabels: [],
        tips: []
    )
}
