//
//  OptimizerSection.Adapter.swift
//  TeslaSync — P4 feature view · 0104 · OptimizerSection (Apple)
//
//  The testable projection core for the charging-optimizer section: the decoded
//  domain models (parity with the web `ChargingOptimizerData` slice), the `safe()`
//  numeric guard (port of the web `safeNumber` from `@/lib/numberFormat`), the
//  battery-friendly score tier (web `>= 75 / >= 50` thresholds), the optimizer
//  projection predicates (savings banner `> 5`, peak-session elevation `> 30`,
//  per-recommendation savings chip, heatmap visibility, the `peak/off-peak hours`
//  label), the cost-heatmap matrix + color math (web `CostHeatmap` rgba ramp), and
//  the VoiceOver summary builders. Everything here is pure + dependency-free
//  (Foundation only) so it can be unit-tested without a store or a rendered view.
//

import Foundation

// MARK: - Numeric guard (port of the web `safeNumber`)

/// Numeric helpers shared by the projection. `safe` is the native port of the web
/// `safeNumber = (v) => typeof v === 'number' && isFinite(v) ? v : 0`, used wherever
/// a metric feeds arithmetic / a label so a `NaN` / `Infinity` never reaches a bar
/// width, a gauge fraction, a heatmap channel, or a formatted string.
public enum OptimizerNumeric {
    /// Returns the value when it is finite, else `0` (web `safeNumber`).
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }

    /// Clamps a value into `0...upper` (web `Math.max(0, Math.min(value, max))`).
    public static func clamp(_ value: Double, upper: Double) -> Double {
        let safeValue = safe(value)
        let safeUpper = safe(upper)
        return Swift.min(Swift.max(safeValue, 0), Swift.max(safeUpper, 0))
    }
}

// MARK: - Domain models (port of `ChargingOptimizerData`)

/// The current charging schedule (web `current_schedule`). The section reads each
/// field for the "Charging Habits" panel.
public struct OptimizerSchedule: Equatable, Sendable {
    public var mostCommonStartHour: Int
    public var mostCommonDay: String
    public var avgSessionsPerWeek: Double
    public var homeChargingPct: Double
    public var avgChargeToPct: Double

    public init(
        mostCommonStartHour: Int = 0,
        mostCommonDay: String = "",
        avgSessionsPerWeek: Double = 0,
        homeChargingPct: Double = 0,
        avgChargeToPct: Double = 0
    ) {
        self.mostCommonStartHour = mostCommonStartHour
        self.mostCommonDay = mostCommonDay
        self.avgSessionsPerWeek = avgSessionsPerWeek
        self.homeChargingPct = homeChargingPct
        self.avgChargeToPct = avgChargeToPct
    }
}

/// The time-of-use cost analysis (web `cost_analysis`). Backs the "Cost Analysis"
/// panel and the savings banner.
public struct OptimizerCostAnalysis: Equatable, Sendable {
    public var peakHours: [Int]
    public var offpeakHours: [Int]
    public var peakCostPerKwh: Double
    public var offpeakCostPerKwh: Double
    public var sessionsDuringPeakPct: Double
    public var potentialMonthlySavings: Double

    public init(
        peakHours: [Int] = [],
        offpeakHours: [Int] = [],
        peakCostPerKwh: Double = 0,
        offpeakCostPerKwh: Double = 0,
        sessionsDuringPeakPct: Double = 0,
        potentialMonthlySavings: Double = 0
    ) {
        self.peakHours = peakHours
        self.offpeakHours = offpeakHours
        self.peakCostPerKwh = peakCostPerKwh
        self.offpeakCostPerKwh = offpeakCostPerKwh
        self.sessionsDuringPeakPct = sessionsDuringPeakPct
        self.potentialMonthlySavings = potentialMonthlySavings
    }
}

/// A recommendation priority (web union `'high' | 'medium' | 'low'`). An unknown
/// server value folds to `.low` so styling never crashes on a new tier.
public enum OptimizerPriority: String, Equatable, Sendable, CaseIterable {
    case high
    case medium
    case low

    /// Parses a raw server string, defaulting unknown values to `.low` (the web's
    /// neutral fallback styling for any non-high/medium priority).
    public init(raw: String) {
        self = OptimizerPriority(rawValue: raw.lowercased()) ?? .low
    }
}

/// One optimization recommendation (web `recommendations[i]`). `id` is the source
/// index (web `key={i}`); `estimatedSavings` is optional (web `estimated_savings?`).
public struct OptimizerRecommendation: Identifiable, Equatable, Sendable {
    public var id: Int
    public var type: String
    public var priority: OptimizerPriority
    public var title: String
    public var detail: String
    public var estimatedSavings: Double?

    public init(
        id: Int,
        type: String = "",
        priority: OptimizerPriority = .low,
        title: String = "",
        detail: String = "",
        estimatedSavings: Double? = nil
    ) {
        self.id = id
        self.type = type
        self.priority = priority
        self.title = title
        self.detail = detail
        self.estimatedSavings = estimatedSavings
    }
}

/// One heatmap observation (web `weekly_heatmap[i]`): a `day` (0 = Sunday) × `hour`
/// (0...23) bucket with a session count and an average cost per kWh.
public struct OptimizerHeatmapEntry: Equatable, Sendable {
    public var day: Int
    public var hour: Int
    public var sessions: Double
    public var avgCostPerKwh: Double

    public init(day: Int, hour: Int, sessions: Double, avgCostPerKwh: Double) {
        self.day = day
        self.hour = hour
        self.sessions = sessions
        self.avgCostPerKwh = avgCostPerKwh
    }
}

/// The full `ChargingOptimizerData` slice the section renders. `isEmpty` mirrors the
/// section-level "no signal yet" disposition (no recommendations, no heatmap, and a
/// zeroed schedule / cost analysis) so the model can show the loaded layout with the
/// recommendations empty state instead of a blank surface.
public struct ChargingOptimizer: Equatable, Sendable {
    public var schedule: OptimizerSchedule
    public var costAnalysis: OptimizerCostAnalysis
    public var batteryHealthScore: Double
    public var recommendations: [OptimizerRecommendation]
    public var weeklyHeatmap: [OptimizerHeatmapEntry]

    public init(
        schedule: OptimizerSchedule = OptimizerSchedule(),
        costAnalysis: OptimizerCostAnalysis = OptimizerCostAnalysis(),
        batteryHealthScore: Double = 0,
        recommendations: [OptimizerRecommendation] = [],
        weeklyHeatmap: [OptimizerHeatmapEntry] = []
    ) {
        self.schedule = schedule
        self.costAnalysis = costAnalysis
        self.batteryHealthScore = batteryHealthScore
        self.recommendations = recommendations
        self.weeklyHeatmap = weeklyHeatmap
    }

    /// Whether the slice carries no meaningful optimizer signal yet.
    public var isEmpty: Bool {
        recommendations.isEmpty
            && weeklyHeatmap.isEmpty
            && OptimizerNumeric.safe(batteryHealthScore) == 0
            && OptimizerNumeric.safe(costAnalysis.peakCostPerKwh) == 0
            && OptimizerNumeric.safe(costAnalysis.offpeakCostPerKwh) == 0
            && OptimizerNumeric.safe(schedule.avgSessionsPerWeek) == 0
            && schedule.mostCommonDay.isEmpty
    }
}

// MARK: - Battery-friendly score tier (web `>= 75 / >= 50` thresholds)

/// The battery-friendly score band (web color + caption thresholds). `.good` at
/// `>= 75`, `.fair` at `>= 50`, else `.poor`. The view maps the tier to a token
/// color + a caption key; the thresholds are isolated here so they are testable.
public enum BatteryScoreTier: Equatable, Sendable {
    case good
    case fair
    case poor

    /// Resolves the tier from a raw score (web `score >= 75 ? … : score >= 50 ? …`).
    public static func resolve(_ score: Double) -> BatteryScoreTier {
        let value = OptimizerNumeric.safe(score)
        if value >= 75 { return .good }
        if value >= 50 { return .fair }
        return .poor
    }
}

// MARK: - Optimizer projection (ports of the web conditionals)

/// The pure predicates / label builders the section branches on. Each mirrors a web
/// expression exactly so the native render tree matches the web's conditionals.
public enum OptimizerProjection {
    /// Whether the savings banner shows (web `potential_monthly_savings > 5`).
    public static func savingsBannerVisible(_ savings: Double) -> Bool {
        OptimizerNumeric.safe(savings) > 5
    }

    /// Whether "sessions during peak" is highlighted as elevated (web `> 30`).
    public static func peakSessionsElevated(_ pct: Double) -> Bool {
        OptimizerNumeric.safe(pct) > 30
    }

    /// Whether a recommendation shows its savings chip (web `estimated_savings != null
    /// && estimated_savings > 0`).
    public static func recommendationSavingsVisible(_ recommendation: OptimizerRecommendation) -> Bool {
        guard let savings = recommendation.estimatedSavings else { return false }
        return OptimizerNumeric.safe(savings) > 0
    }

    /// Whether the heatmap panel renders (web `(weekly_heatmap ?? []).length > 0`).
    public static func heatmapVisible(_ entries: [OptimizerHeatmapEntry]) -> Bool {
        !entries.isEmpty
    }

    /// The peak / off-peak hours label (web `(hours ?? []).map(h => `${h}:00`)
    /// .join(', ') || '—'`): an em dash when there are no hours.
    public static func hoursLabel(_ hours: [Int]) -> String {
        guard !hours.isEmpty else { return "—" }
        return hours.map { "\($0):00" }.joined(separator: ", ")
    }

    /// The "common start hour" label (web `${most_common_start_hour}:00`).
    public static func startHourLabel(_ hour: Int) -> String {
        "\(hour):00"
    }
}
