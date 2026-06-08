//
//  OptimizerSection.Projection.swift
//  TeslaSync — P4 feature view · 0104 · OptimizerSection (Apple)
//
//  The cost-heatmap matrix + color ramp (port of the web `CostHeatmap`) and the
//  VoiceOver summary builders for the optimizer section, split out of the adapter to
//  keep each file focused. Pure + Foundation-only so the heatmap math and the spoken
//  content stay unit-testable without a store or a rendered view.
//

import Foundation

// MARK: - Cost-heatmap matrix + color (port of the web `CostHeatmap`)

/// The labeled days of the week, in the web's fixed Sun→Sat order. The labels are
/// resolved through the i18n facade by the view (keys `charging.optimizer.day0…6`);
/// the indices here are the wire `day` values.
public enum OptimizerHeatmapAxis {
    /// The 7 day indices (web rows `['Sun'…'Sat']` → `dayIdx 0…6`).
    public static let dayIndices: [Int] = Array(0 ... 6)
    /// The 24 hour indices (web columns `0…23`).
    public static let hourIndices: [Int] = Array(0 ... 23)
    /// The hour-axis labels (web shows `${i}` only when `i % 3 === 0`).
    public static func hourTick(_ hour: Int) -> String {
        hour % 3 == 0 ? "\(hour)" : ""
    }
}

/// One resolved heatmap cell (a `day × hour` bucket). `isPopulated` mirrors the web
/// `sessions > 0` gate that decides whether the cell is colored or left near-blank.
public struct OptimizerHeatmapCell: Equatable, Sendable {
    public var day: Int
    public var hour: Int
    public var sessions: Double
    public var cost: Double

    public init(day: Int, hour: Int, sessions: Double, cost: Double) {
        self.day = day
        self.hour = hour
        self.sessions = sessions
        self.cost = cost
    }

    /// Whether the bucket has any sessions (web `sessions > 0`).
    public var isPopulated: Bool {
        sessions > 0
    }
}

/// An sRGB color in `0…1` channels — the native carrier for the web inline `rgba()`
/// the heatmap computes per cell. Kept POD + `Sendable` so the math is testable and
/// the view just maps it to a SwiftUI `Color`.
public struct OptimizerHeatColor: Equatable, Sendable {
    public var red: Double
    public var green: Double
    public var blue: Double
    public var opacity: Double

    public init(red: Double, green: Double, blue: Double, opacity: Double) {
        self.red = red
        self.green = green
        self.blue = blue
        self.opacity = opacity
    }
}

/// The cost-heatmap projection — the parity of the web `CostHeatmap` math: the
/// `maxCost` reference (`peakCostPerKwh || 0.30`), the per-cell `intensity`
/// (`min(1, cost / maxCost)`), the per-cell `rgba` ramp (warm = expensive, cool =
/// cheap, alpha grows with sessions), and the legend swatch ramp. All pure + tested.
public enum OptimizerHeatmap {
    /// The cost used as the "expensive" reference (web `peakCostPerKwh || 0.30` — a
    /// `0` / non-finite peak cost folds to the `0.30` default).
    public static func maxCost(peakCostPerKwh: Double) -> Double {
        let peak = OptimizerNumeric.safe(peakCostPerKwh)
        return peak > 0 ? peak : 0.30
    }

    /// The `0…1` cost intensity for a cell (web `maxCost > 0 ? min(1, cost / maxCost)
    /// : 0`).
    public static func intensity(cost: Double, maxCost: Double) -> Double {
        let reference = OptimizerNumeric.safe(maxCost)
        guard reference > 0 else { return 0 }
        return Swift.min(1, OptimizerNumeric.safe(cost) / reference)
    }

    /// Resolves the `day × hour` cell from the sparse entries (web `heatmap.find(e =>
    /// e.day === dayIdx && e.hour === hourIdx)`), zero-filling a missing bucket.
    public static func cell(day: Int, hour: Int, entries: [OptimizerHeatmapEntry]) -> OptimizerHeatmapCell {
        let match = entries.first { $0.day == day && $0.hour == hour }
        return OptimizerHeatmapCell(
            day: day,
            hour: hour,
            sessions: OptimizerNumeric.safe(match?.sessions),
            cost: OptimizerNumeric.safe(match?.avgCostPerKwh)
        )
    }

    /// The cell fill (web inline `backgroundColor`): a warm→cool `rgba` whose alpha
    /// grows with session volume when populated, else a near-transparent white
    /// (web `rgba(255,255,255,0.02)`).
    public static func color(for cell: OptimizerHeatmapCell, maxCost: Double) -> OptimizerHeatColor {
        guard cell.isPopulated else {
            return OptimizerHeatColor(red: 1, green: 1, blue: 1, opacity: 0.02)
        }
        let level = intensity(cost: cell.cost, maxCost: maxCost)
        let alpha = Swift.min(0.9, 0.15 + cell.sessions * 0.12)
        return ramp(intensity: level, opacity: alpha)
    }

    /// The legend swatch ramp (web `[0.15,0.3,0.5,0.7,0.9].map(o => rgba(…, 0.6))`).
    public static let legendStops: [Double] = [0.15, 0.3, 0.5, 0.7, 0.9]

    /// A legend swatch color for a fixed intensity (web legend `rgba(…, 0.6)`).
    public static func legendColor(intensity level: Double) -> OptimizerHeatColor {
        ramp(intensity: level, opacity: 0.6)
    }

    /// The shared warm→cool ramp (web `rgba(round(i*239), round((1-i)*187),
    /// round((1-i)*100), a)`), normalized to `0…1` channels.
    private static func ramp(intensity level: Double, opacity: Double) -> OptimizerHeatColor {
        let clampedLevel = Swift.min(Swift.max(level, 0), 1)
        let red = (clampedLevel * 239).rounded() / 255
        let green = ((1 - clampedLevel) * 187).rounded() / 255
        let blue = ((1 - clampedLevel) * 100).rounded() / 255
        return OptimizerHeatColor(red: red, green: green, blue: blue, opacity: opacity)
    }

    /// The busiest populated bucket (most sessions; ties broken by the earliest
    /// day then hour) used for the heatmap's spoken overview. `nil` when no bucket
    /// has any sessions.
    public static func busiest(_ entries: [OptimizerHeatmapEntry]) -> OptimizerHeatmapCell? {
        let populated = entries
            .map { OptimizerHeatmapCell(
                day: $0.day,
                hour: $0.hour,
                sessions: OptimizerNumeric.safe($0.sessions),
                cost: OptimizerNumeric.safe($0.avgCostPerKwh)
            ) }
            .filter(\.isPopulated)
        return populated.max { lhs, rhs in
            if lhs.sessions != rhs.sessions { return lhs.sessions < rhs.sessions }
            if lhs.day != rhs.day { return lhs.day > rhs.day }
            return lhs.hour > rhs.hour
        }
    }
}

// MARK: - Accessibility summaries (testable seam)

/// The five habit labels, bundled so the summary stays a small function (and avoids
/// a wide tuple). All values are pre-localized by the caller.
public struct HabitLabels: Equatable, Sendable {
    public var sessionsWeek: String
    public var homePct: String
    public var avgTarget: String
    public var commonHour: String
    public var commonDay: String

    public init(
        sessionsWeek: String,
        homePct: String,
        avgTarget: String,
        commonHour: String,
        commonDay: String
    ) {
        self.sessionsWeek = sessionsWeek
        self.homePct = homePct
        self.avgTarget = avgTarget
        self.commonHour = commonHour
        self.commonDay = commonDay
    }
}

/// The cost-analysis labels, bundled for the same reason as `HabitLabels`.
public struct CostAnalysisLabels: Equatable, Sendable {
    public var peakRate: String
    public var offpeakRate: String
    public var peakSessions: String

    public init(peakRate: String, offpeakRate: String, peakSessions: String) {
        self.peakRate = peakRate
        self.offpeakRate = offpeakRate
        self.peakSessions = peakSessions
    }
}

/// Builds the VoiceOver strings for the section's data so the spoken content can be
/// unit-tested without rendering a view. Each builder takes pre-resolved labels +
/// formatters, so no literal is hardcoded.
public enum OptimizerAccessibility {
    /// The habits panel spoken as one combined element: each label paired with its
    /// formatted value.
    public static func habitsSummary(
        schedule: OptimizerSchedule,
        labels: HabitLabels,
        formatNumber: (Double, Int) -> String
    ) -> String {
        let parts = [
            "\(labels.sessionsWeek) \(formatNumber(OptimizerNumeric.safe(schedule.avgSessionsPerWeek), 1))",
            "\(labels.homePct) \(formatNumber(OptimizerNumeric.safe(schedule.homeChargingPct), 0))%",
            "\(labels.avgTarget) \(formatNumber(OptimizerNumeric.safe(schedule.avgChargeToPct), 0))%",
            "\(labels.commonHour) \(OptimizerProjection.startHourLabel(schedule.mostCommonStartHour))",
            "\(labels.commonDay) \(schedule.mostCommonDay)"
        ]
        return parts.joined(separator: ", ")
    }

    /// The battery score spoken as "Battery-Friendly Score, 82 of 100. <caption>".
    public static func scoreSummary(
        score: Double,
        label: String,
        caption: String,
        formatNumber: (Double, Int) -> String
    ) -> String {
        let value = OptimizerNumeric.clamp(score, upper: 100)
        return "\(label), \(formatNumber(value, 0)) / 100. \(caption)"
    }

    /// The cost-analysis panel spoken as one combined element (rates + peak share).
    public static func costSummary(
        analysis: OptimizerCostAnalysis,
        labels: CostAnalysisLabels,
        formatCurrency: (Double, Int) -> String,
        formatNumber: (Double, Int) -> String
    ) -> String {
        let parts = [
            "\(labels.peakRate) \(formatCurrency(OptimizerNumeric.safe(analysis.peakCostPerKwh), 3))/kWh",
            "\(labels.offpeakRate) \(formatCurrency(OptimizerNumeric.safe(analysis.offpeakCostPerKwh), 3))/kWh",
            "\(labels.peakSessions) \(formatNumber(OptimizerNumeric.safe(analysis.sessionsDuringPeakPct), 0))%"
        ]
        return parts.joined(separator: ", ")
    }

    /// One recommendation spoken as "<title>, <priority>, ~$12/mo. <detail>". The
    /// savings clause is dropped when the chip is hidden (web `estimated_savings`).
    public static func recommendationSummary(
        _ recommendation: OptimizerRecommendation,
        perMonthSuffix: String,
        formatNumber: (Double, Int) -> String
    ) -> String {
        var parts = [recommendation.title, recommendation.priority.rawValue]
        if OptimizerProjection.recommendationSavingsVisible(recommendation) {
            let amount = formatNumber(OptimizerNumeric.safe(recommendation.estimatedSavings), 0)
            parts.append("~$\(amount)\(perMonthSuffix)")
        }
        let head = parts.joined(separator: ", ")
        return recommendation.detail.isEmpty ? head : "\(head). \(recommendation.detail)"
    }

    /// One heatmap cell spoken like the web `title` tooltip: populated cells read
    /// "<day> <hour>:00 — <n> sessions, $0.123/kWh"; empty cells read "<day> <hour>:00".
    public static func heatCellSummary(
        dayLabel: String,
        cell: OptimizerHeatmapCell,
        sessionsWord: String,
        formatNumber: (Double, Int) -> String,
        formatCurrency: (Double, Int) -> String
    ) -> String {
        let stamp = "\(dayLabel) \(cell.hour):00"
        guard cell.isPopulated else { return stamp }
        let sessions = formatNumber(cell.sessions, 0)
        let cost = formatCurrency(OptimizerNumeric.safe(cell.cost), 3)
        return "\(stamp) — \(sessions) \(sessionsWord), \(cost)/kWh"
    }

    /// The heatmap spoken as one overview element: the panel title plus, when a
    /// busiest bucket exists, its day/hour and session count. `dayLabel` resolves the
    /// busiest cell's day index; pass `nil` when no bucket has sessions.
    public static func heatmapOverview(
        title: String,
        busiest: OptimizerHeatmapCell?,
        busiestDayLabel: String?,
        sessionsWord: String,
        formatNumber: (Double, Int) -> String
    ) -> String {
        guard let busiest, let dayLabel = busiestDayLabel else { return title }
        let sessions = formatNumber(busiest.sessions, 0)
        return "\(title). \(dayLabel) \(busiest.hour):00, \(sessions) \(sessionsWord)."
    }
}
