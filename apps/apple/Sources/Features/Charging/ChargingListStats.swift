import Foundation

// Aggregate value types for the Charging Sessions list (web `ChargingPeriodStats`,
// `ScoreGradeInfo`, `ChargingTrendPoint`, the optimizer payload, and the page phase). Split
// out of `ChargingListModels` to keep each file focused; energy / power stay SI-canonical
// (Wh / W) and convert only at the display boundary.

// MARK: - Battery-friendly grade (web `numericToGrade` / `ScoreGradeInfo`)

/// A graded battery-friendly score (web `ScoreGradeInfo`): a letter label + a semantic tone
/// resolved from the shared design palette (the web hex map → design tokens, ADR-005 — no
/// inline colours). Not `Sendable` (the design `TSTone` is view-layer, main-actor state); it
/// is only ever produced + read on the main actor via `ChargingPeriodStats` computed access.
public struct BatteryGrade: Equatable {
    public let label: String
    public let tone: TSTone

    public init(label: String, tone: TSTone) {
        self.label = label
        self.tone = tone
    }

    /// The "no data" sentinel (web `'—'`). A computed static (not a stored `let`) so the
    /// non-`Sendable` `BatteryGrade` carries no shared mutable global state.
    public static var none: BatteryGrade {
        BatteryGrade(label: "—", tone: .neutral)
    }

    /// Web `numericToGrade(score)` with `DEFAULT_SCORE_THRESHOLDS` — highest band first.
    public static func from(_ score: Double?) -> BatteryGrade {
        guard let score, score.isFinite else { return .none }
        switch score {
        case 90...: return BatteryGrade(label: "A+", tone: .success)
        case 80...: return BatteryGrade(label: "A", tone: .success)
        case 65...: return BatteryGrade(label: "B", tone: .info)
        case 50...: return BatteryGrade(label: "C", tone: .warning)
        case 35...: return BatteryGrade(label: "D", tone: .danger)
        default: return BatteryGrade(label: "F", tone: .danger)
        }
    }
}

// MARK: - Period stats (web `ChargingPeriodStats`)

/// Aggregate stats for a window of sessions (web `ChargingPeriodStats`). Energy/power stay
/// SI (Wh / W); the cards convert to kWh / kW at render time.
public struct ChargingPeriodStats: Equatable, Sendable {
    public let sessionCount: Int
    public let totalEnergyWh: Double
    public let totalCost: Double
    public let totalDurationMin: Double
    public let avgRateKw: Double?
    public let avgDurationMin: Double?
    public let avgPowerW: Double?
    public let mostCommonStartHour: Int?
    public let homeCount: Int
    public let superchargerCount: Int
    public let dcCount: Int
    public let freeCount: Int
    public let batteryFriendlyScore: Double?

    public init(
        sessionCount: Int,
        totalEnergyWh: Double,
        totalCost: Double,
        totalDurationMin: Double,
        avgRateKw: Double?,
        avgDurationMin: Double?,
        avgPowerW: Double?,
        mostCommonStartHour: Int?,
        homeCount: Int,
        superchargerCount: Int,
        dcCount: Int,
        freeCount: Int,
        batteryFriendlyScore: Double?
    ) {
        self.sessionCount = sessionCount
        self.totalEnergyWh = totalEnergyWh
        self.totalCost = totalCost
        self.totalDurationMin = totalDurationMin
        self.avgRateKw = avgRateKw
        self.avgDurationMin = avgDurationMin
        self.avgPowerW = avgPowerW
        self.mostCommonStartHour = mostCommonStartHour
        self.homeCount = homeCount
        self.superchargerCount = superchargerCount
        self.dcCount = dcCount
        self.freeCount = freeCount
        self.batteryFriendlyScore = batteryFriendlyScore
    }

    /// The empty window (web `count === 0`) — gates the overview cards vs. the no-data panel.
    public static let empty = ChargingPeriodStats(
        sessionCount: 0, totalEnergyWh: 0, totalCost: 0, totalDurationMin: 0,
        avgRateKw: nil, avgDurationMin: nil, avgPowerW: nil, mostCommonStartHour: nil,
        homeCount: 0, superchargerCount: 0, dcCount: 0, freeCount: 0, batteryFriendlyScore: nil
    )

    /// Web `currentStats.count > 0` — gates the overview cards vs. the no-stats GlassPanel.
    public var hasData: Bool {
        sessionCount > 0
    }

    /// Web `batteryFriendlyGrade` — the graded score for the secondary / sticky labels.
    public var batteryFriendlyGrade: BatteryGrade {
        BatteryGrade.from(batteryFriendlyScore)
    }
}

// MARK: - Trend point (web `ChargingTrendPoint`)

/// One daily bucket of a charging metric (web `ChargingTrendPoint`).
public struct ChargingTrendPoint: Identifiable, Equatable, Sendable {
    /// `YYYY-MM-DD`.
    public let date: String
    public let value: Double

    public var id: String { date }

    public init(date: String, value: Double) {
        self.date = date
        self.value = value
    }
}

// MARK: - Optimizer (web `useChargingOptimizer` → `GET /analytics/charging-optimizer`)

/// The cost-optimizer recommendation (web `useChargingOptimizer`), surfaced once the window
/// has enough sessions for pattern recognition (web `THRESHOLD_OPTIMIZER`).
public struct ChargingListOptimizer: Equatable, Sendable {
    public let bestWindowLabel: String
    public let estimatedMonthlySavings: Double
    public let currentAvgCostPerKwh: Double
    public let optimalAvgCostPerKwh: Double

    public init(
        bestWindowLabel: String,
        estimatedMonthlySavings: Double,
        currentAvgCostPerKwh: Double,
        optimalAvgCostPerKwh: Double
    ) {
        self.bestWindowLabel = bestWindowLabel
        self.estimatedMonthlySavings = estimatedMonthlySavings
        self.currentAvgCostPerKwh = currentAvgCostPerKwh
        self.optimalAvgCostPerKwh = optimalAvgCostPerKwh
    }
}

// MARK: - Date range (web `from` / `to` URL state)

/// An inclusive `YYYY-MM-DD` day-key window (web `from` / `to`).
public struct ChargingDateRange: Equatable, Sendable {
    public let start: String
    public let end: String

    public init(start: String, end: String) {
        self.start = start
        self.end = end
    }
}

// MARK: - Page phase (web `isLoading ? Skeleton : error ? errorRegion : body`)

/// The page's terminal phase, driven by the sessions query. `.empty` is a successful load
/// with no sessions at all (web `!sessions?.length`); `.error` is a retryable failure (web
/// `QueryError`); `.ready` carries the window the rest of the page derives from.
public enum ChargingListPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}
