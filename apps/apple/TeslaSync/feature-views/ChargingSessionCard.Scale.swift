//
//  ChargingSessionCard.Scale.swift
//  TeslaSync — P4 feature view · 0107 · ChargingSessionCard (Apple)
//
//  The session math + scales: the per-session helpers (web `durationMinutes`,
//  `avgPowerW`, `costPerKwh`, `distanceAddedM`, and the inline `sessionScore`
//  memo), the A–F grade scale (web `numericToGrade` / `scoreScale.ts` defaults),
//  and the battery-delta display (web `BatteryDelta` compact variant). Pure +
//  Foundation-only so every rule is unit-tested without rendering.
//

import Foundation

// MARK: - Per-session helpers (port of `@/lib/chargingAggregation`)

/// Pure session math, each function a faithful port of its web counterpart.
public enum ChargingSessionMetrics {
    /// Duration in minutes between `startedAt` and `endedAt` (web `durationMinutes`).
    /// Returns `0` for in-progress sessions, missing timestamps, or `end <= start`.
    public static func durationMinutes(_ session: ChargingSessionSummary) -> Double {
        guard let start = session.startedAt, let end = session.endedAt else { return 0 }
        let seconds = end.timeIntervalSince(start)
        guard seconds.isFinite, seconds > 0 else { return 0 }
        return seconds / 60
    }

    /// Average power in watts (web `avgPowerW`): total energy (Wh) over elapsed
    /// hours, falling back to the API-provided `avg_power_w`, else `0`.
    public static func avgPowerW(_ session: ChargingSessionSummary) -> Double {
        let minutes = durationMinutes(session)
        if minutes > 0, session.totalEnergyAddedWh > 0 {
            return session.totalEnergyAddedWh / (minutes / 60)
        }
        return ChargingSessionNumeric.safe(session.avgPowerW)
    }

    /// Cost per kWh for a single session (web `costPerKwh`). `nil` when free /
    /// unknown / zero-energy.
    public static func costPerKwh(_ session: ChargingSessionSummary) -> Double? {
        guard session.totalEnergyAddedWh > 0 else { return nil }
        guard let cost = session.costDecimal, cost > 0 else { return nil }
        return cost / (session.totalEnergyAddedWh / 1000)
    }

    /// Metres of range/odometer added across the session (web `distanceAddedM`).
    /// `nil` when either odometer reading is missing or the delta is not positive.
    public static func distanceAddedM(_ session: ChargingSessionSummary) -> Double? {
        guard let start = session.odometerStartM, let end = session.odometerEndM else { return nil }
        let delta = end - start
        return delta > 0 ? delta : nil
    }

    /// The inline per-session battery-friendly score (web `sessionScore` memo):
    /// rewards starting low (≤ 30 %) and stopping in the 30→80 % sweet spot,
    /// penalises high-start and 100 % charges. `nil` when either SoC is missing.
    /// Clamped to `0…100`.
    public static func batteryFriendlyScore(startPct: Double?, endPct: Double?) -> Double? {
        guard let start = startPct, let end = endPct else { return nil }
        var score = 50.0
        switch start {
        case ...30: score += 30
        case ...50: score += 15
        case ...70: break
        default: score -= 10
        }
        switch end {
        case ...80: score += 20
        case ...90: break
        case ..<100: score -= 10
        default: score -= 25
        }
        return Swift.max(0, Swift.min(100, score))
    }
}

// MARK: - A–F grade scale (port of `scoreScale.ts` defaults)

/// The letter grade for a 0–100 score (web `ScoreGrade`). The card derives this
/// from the inline `sessionScore` for the leading badge.
public enum ChargingScoreGrade: Equatable, Sendable {
    case gradeAPlus
    case gradeA
    case gradeB
    case gradeC
    case gradeD
    case gradeF
    case gradeNone

    /// The displayed label (web `ScoreGradeInfo.label`).
    public var label: String {
        switch self {
        case .gradeAPlus: "A+"
        case .gradeA: "A"
        case .gradeB: "B"
        case .gradeC: "C"
        case .gradeD: "D"
        case .gradeF: "F"
        case .gradeNone: "—"
        }
    }

    /// The badge tone, mapping the web `GRADE_PALETTE` hexes to semantic tokens so
    /// the badge stays theme-aware (emerald→success, cyan→info, amber→warning,
    /// red→danger, dark-red→critical, grey→neutral).
    public var tone: ChargingSessionCardTone {
        switch self {
        case .gradeAPlus, .gradeA: .success
        case .gradeB: .info
        case .gradeC: .warning
        case .gradeD: .danger
        case .gradeF: .critical
        case .gradeNone: .neutral
        }
    }

    /// Maps a 0–100 score to a grade using the web `DEFAULT_SCORE_THRESHOLDS`
    /// (≥90 A+, ≥80 A, ≥65 B, ≥50 C, ≥35 D, else F). A `nil` / non-finite score is
    /// the `—` sentinel.
    public static func grade(forScore score: Double?) -> ChargingScoreGrade {
        guard let score, score.isFinite else { return .gradeNone }
        switch score {
        case 90...: return .gradeAPlus
        case 80 ..< 90: return .gradeA
        case 65 ..< 80: return .gradeB
        case 50 ..< 65: return .gradeC
        case 35 ..< 50: return .gradeD
        default: return .gradeF
        }
    }
}

// MARK: - Battery delta (port of the web `BatteryDelta` compact variant)

/// The resolved battery state-of-charge change shown on the metrics line (web
/// `BatteryDelta` default `compact` variant). Pure + `Equatable` so the
/// sign/tone/label rules are unit-tested without rendering.
public struct ChargingBatteryDeltaDisplay: Equatable, Sendable {
    /// Whether both SoC endpoints are present + finite (web `hasData`).
    public let hasData: Bool
    /// Emerald on a rise (charging), amber on a drop, muted on zero / missing.
    public let tone: ChargingSessionCardTone
    /// The visible compact label — "+60%", "−1%", or "—".
    public let label: String
    /// The integer start percent for the accessibility label (`nil` when missing).
    public let fromPercent: Int?
    /// The integer end percent for the accessibility label (`nil` when missing).
    public let toPercent: Int?

    public init(hasData: Bool, tone: ChargingSessionCardTone, label: String, fromPercent: Int?, toPercent: Int?) {
        self.hasData = hasData
        self.tone = tone
        self.label = label
        self.fromPercent = fromPercent
        self.toPercent = toPercent
    }

    private static let dash = "—"

    /// Resolves the delta exactly like the web component: muted "—" when either
    /// endpoint is missing/non-finite or the delta is zero, "+N%" emerald on a
    /// rise, "−N%" amber on a drop. Percents are rounded to whole numbers.
    public static func make(startPct: Double?, endPct: Double?) -> ChargingBatteryDeltaDisplay {
        guard let start = startPct, let end = endPct, start.isFinite, end.isFinite else {
            return ChargingBatteryDeltaDisplay(
                hasData: false,
                tone: .neutral,
                label: dash,
                fromPercent: nil,
                toPercent: nil
            )
        }
        let delta = end - start
        let magnitude = Int(abs(delta).rounded())
        let tone: ChargingSessionCardTone = delta > 0 ? .success : (delta < 0 ? .warning : .neutral)
        let label = delta == 0 ? dash : "\(delta > 0 ? "+" : "\u{2212}")\(magnitude)%"
        return ChargingBatteryDeltaDisplay(
            hasData: true,
            tone: tone,
            label: label,
            fromPercent: Int(start.rounded()),
            toPercent: Int(end.rounded())
        )
    }
}
