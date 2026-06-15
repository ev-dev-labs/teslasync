import Foundation
import SwiftUI

// The core scoring + aggregation engine for the Drive Score surface (web `scoreDrive`, `avgScores`,
// `trendChartData`, `categoryBarData`, `histogramData`, `bestDrive`/`worstDrive`, `weakestCategory`,
// `buildAchievements`, `buildTips`). Everything is a deterministic function of SI inputs. The
// weekly/monthly calendar buckets (web `periodStats`) live in `DriveScoreEngine.Periods.swift`.

/// One score-distribution bucket definition (web `histogramData` range row).
private struct DriveScoreHistogramRange {
    let label: String
    let lower: Int
    let upper: Int
    let colorIndex: Int
}

/// The stateless drive-score engine (web scoring + aggregation helpers).
public enum DriveScoreEngine {
    /// Miles-per-hour per meter-per-second (web `2.2369362920544`).
    static let mphPerMps = 2.2369362920544

    // MARK: Scoring (web `scoreDrive`)

    /// Scores one drive (web `scoreDrive`): a 40-point efficiency component from derived Wh/km, a
    /// 30-point smoothness component from average power, and a 30-point speed-discipline component
    /// penalizing sustained speed above 90 mph. Missing inputs fall back to the web defaults.
    public static func score(_ drive: DriveScoreDrive) -> DriveScoreBreakdown {
        let battUsed = (drive.startBatteryPct ?? 50) - (drive.endBatteryPct ?? 45)
        let energyKwh = drive.energyUsedWh.map { $0 / 1000 } ?? (battUsed / 100) * 75
        let distanceKm = drive.distanceM / 1000
        let whPerKm = distanceKm > 0 ? (energyKwh * 1000) / distanceKm : 200

        let effScore = clamp(40 - (whPerKm - 130) / 3, lower: 0, upper: 40)
        let avgPowerKw = drive.avgPowerW.map { $0 / 1000 } ?? 30
        let smoothScore = clamp(30 - avgPowerKw / 3, lower: 0, upper: 30)
        let maxSpeedMph = drive.maxSpeedMps.map { $0 * mphPerMps } ?? 80
        let speedScore = clamp(30 - max(0, maxSpeedMph - 90) / 2, lower: 0, upper: 30)

        let total = Int((effScore + smoothScore + speedScore).rounded())
        return DriveScoreBreakdown(
            total: total,
            efficiency: Int(effScore.rounded()),
            smoothness: Int(smoothScore.rounded()),
            speed: Int(speedScore.rounded()),
            grade: DriveGrade.from(score: total),
            whPerKm: whPerKm.rounded()
        )
    }

    /// Scores + pairs a list of drives (web `scoredDrives`).
    public static func scoredDrives(_ drives: [DriveScoreDrive]) -> [ScoredDrive] {
        drives.map { ScoredDrive(drive: $0, score: score($0)) }
    }

    // MARK: Averages (web `avgScores`)

    /// The rounded mean of each category across the scored drives (web `avgScores`); zero when empty.
    public static func averages(_ scored: [ScoredDrive]) -> DriveScoreAverages {
        guard !scored.isEmpty else { return .zero }
        let count = Double(scored.count)
        let total = scored.reduce(0) { $0 + $1.score.total }
        let efficiency = scored.reduce(0) { $0 + $1.score.efficiency }
        let smoothness = scored.reduce(0) { $0 + $1.score.smoothness }
        let speed = scored.reduce(0) { $0 + $1.score.speed }
        return DriveScoreAverages(
            total: Int((Double(total) / count).rounded()),
            efficiency: Int((Double(efficiency) / count).rounded()),
            smoothness: Int((Double(smoothness) / count).rounded()),
            speed: Int((Double(speed) / count).rounded())
        )
    }

    // MARK: Trend (web `trendChartData`)

    /// The last 20 scored drives, oldest-first, as trend points (web `trendChartData`).
    public static func trendPoints(_ scored: [ScoredDrive]) -> [DriveScoreTrendPoint] {
        let recent = scored
            .sorted { $0.drive.startTs < $1.drive.startTs }
            .suffix(20)
        return recent.enumerated().map { index, item in
            DriveScoreTrendPoint(
                index: index,
                date: item.drive.startTs,
                score: item.score.total,
                efficiency: item.score.efficiency,
                smoothness: item.score.smoothness,
                speed: item.score.speed
            )
        }
    }

    // MARK: Category bars (web `categoryBarData`)

    /// The three category bars, using the backend score when present else the local average
    /// (web `categoryBarData`).
    public static func categoryBars(
        summary: DriveScoreSummary?,
        averages: DriveScoreAverages
    ) -> [DriveScoreCategoryBar] {
        DriveScoreCategory.allCases.map { category in
            DriveScoreCategoryBar(
                category: category,
                value: summary?.score(for: category) ?? averages.score(for: category),
                maxValue: category.maxPoints
            )
        }
    }

    // MARK: Histogram (web `histogramData`)

    /// The five score-distribution buckets with per-bucket counts + palette colors (web
    /// `histogramData`). Upper bound is exclusive except the final bucket (web `max: 101`).
    public static func histogram(_ scored: [ScoredDrive]) -> [DriveScoreHistogramBin] {
        let ranges = [
            DriveScoreHistogramRange(label: "0–20", lower: 0, upper: 20, colorIndex: 5),
            DriveScoreHistogramRange(label: "20–40", lower: 20, upper: 40, colorIndex: 1),
            DriveScoreHistogramRange(label: "40–60", lower: 40, upper: 60, colorIndex: 3),
            DriveScoreHistogramRange(label: "60–80", lower: 60, upper: 80, colorIndex: 4),
            DriveScoreHistogramRange(label: "80–100", lower: 80, upper: 101, colorIndex: 2)
        ]
        return ranges.map { range in
            let count = scored.count(where: { $0.score.total >= range.lower && $0.score.total < range.upper })
            return DriveScoreHistogramBin(rangeLabel: range.label, driveCount: count, colorIndex: range.colorIndex)
        }
    }

    // MARK: Best / worst (web `bestDrive` / `worstDrive`)

    /// The highest-scoring drive (web `bestDrive`), or nil when there are none.
    public static func bestDrive(_ scored: [ScoredDrive]) -> ScoredDrive? {
        scored.max { $0.score.total < $1.score.total }
    }

    /// The lowest-scoring drive (web `worstDrive`), or nil when there are none.
    public static func worstDrive(_ scored: [ScoredDrive]) -> ScoredDrive? {
        scored.min { $0.score.total < $1.score.total }
    }

    /// Web best-drive insight key, by the strongest component.
    public static func bestDriveTipKey(_ breakdown: DriveScoreBreakdown) -> LocalizedStringKey {
        if breakdown.efficiency >= 35 { return "driveScore.tipBestEff" }
        if breakdown.smoothness >= 25 { return "driveScore.tipBestSmooth" }
        return "driveScore.tipBestSpeed"
    }

    /// Web worst-drive insight key, by the weakest component.
    public static func worstDriveTipKey(_ breakdown: DriveScoreBreakdown) -> LocalizedStringKey {
        if breakdown.efficiency < 15 { return "driveScore.tipWorstEff" }
        if breakdown.smoothness < 10 { return "driveScore.tipWorstSmooth" }
        return "driveScore.tipWorstSpeed"
    }

    // MARK: Weakest category + tips (web `weakestCategory` / `buildTips`)

    /// The weakest category by normalized score (web `weakestCategory`), preferring efficiency then
    /// smoothness on ties (matching the web comparison order).
    public static func weakestCategory(
        summary: DriveScoreSummary?,
        averages: DriveScoreAverages
    ) -> DriveScoreCategory {
        let eff = Double(summary?.efficiency ?? averages.efficiency) / 40
        let smooth = Double(summary?.smoothness ?? averages.smoothness) / 30
        let speed = Double(summary?.speedDiscipline ?? averages.speed) / 30
        if eff <= smooth, eff <= speed { return .efficiency }
        if smooth <= speed { return .smoothness }
        return .speed
    }

    /// All nine improvement tips (web `buildTips`).
    public static func allTips() -> [DriveScoreTip] {
        [
            DriveScoreTip(id: "preCondition", textKey: "driveScore.tips.preCondition", category: .efficiency),
            DriveScoreTip(id: "coastMore", textKey: "driveScore.tips.coastMore", category: .efficiency),
            DriveScoreTip(id: "tirePressure", textKey: "driveScore.tips.tirePressure", category: .efficiency),
            DriveScoreTip(id: "smoothAccel", textKey: "driveScore.tips.smoothAccel", category: .smoothness),
            DriveScoreTip(id: "regenBraking", textKey: "driveScore.tips.regenBraking", category: .smoothness),
            DriveScoreTip(id: "followDistance", textKey: "driveScore.tips.followDistance", category: .smoothness),
            DriveScoreTip(id: "speedLimit", textKey: "driveScore.tips.speedLimit", category: .speed),
            DriveScoreTip(id: "cruiseControl", textKey: "driveScore.tips.cruiseControl", category: .speed),
            DriveScoreTip(id: "routePlanning", textKey: "driveScore.tips.routePlanning", category: .speed)
        ]
    }

    /// The tips relevant to the weakest category (web `relevantTips`).
    public static func tips(for category: DriveScoreCategory) -> [DriveScoreTip] {
        allTips().filter { $0.category == category }
    }

    // MARK: Achievements (web `buildAchievements` + `unlockedAchievements`)

    /// Every achievement with its unlocked flag evaluated against the scored drives (web
    /// `unlockedAchievements`).
    public static func achievements(scored: [ScoredDrive], driveCount: Int) -> [DriveScoreAchievement] {
        let scores = scored.map(\.score)
        return [
            achievement("first-drive", "firstDrive", "car.fill", driveCount >= 1),
            achievement("ten-drives", "tenDrives", "star.fill", driveCount >= 10),
            achievement("fifty-drives", "fiftyDrives", "trophy.fill", driveCount >= 50),
            achievement("perfect-score", "perfectScore", "rosette", scores.contains { $0.total >= 100 }),
            achievement("a-plus-streak", "aPlusStreak", "flame.fill", hasAPlusStreak(scores, length: 5)),
            achievement("efficiency-master", "efficiencyMaster", "bolt.fill", atLeast(scores, \.efficiency, 38) >= 3),
            achievement(
                "smooth-operator",
                "smoothOperator",
                "checkmark.shield.fill",
                atLeast(scores, \.smoothness, 28) >= 3
            ),
            achievement("speed-saint", "speedSaint", "target", atLeast(scores, \.speed, 28) >= 5)
        ]
    }

    // MARK: - Private helpers

    static func clamp(_ value: Double, lower: Double, upper: Double) -> Double {
        max(lower, min(upper, value))
    }

    private static func atLeast(
        _ scores: [DriveScoreBreakdown],
        _ keyPath: KeyPath<DriveScoreBreakdown, Int>,
        _ threshold: Int
    ) -> Int {
        scores.count(where: { $0[keyPath: keyPath] >= threshold })
    }

    private static func hasAPlusStreak(_ scores: [DriveScoreBreakdown], length: Int) -> Bool {
        var streak = 0
        for entry in scores {
            if entry.grade == .aPlus {
                streak += 1
                if streak >= length { return true }
            } else {
                streak = 0
            }
        }
        return false
    }

    private static func achievement(
        _ id: String,
        _ key: String,
        _ systemImage: String,
        _ unlocked: Bool
    ) -> DriveScoreAchievement {
        DriveScoreAchievement(
            id: id,
            titleKey: LocalizedStringKey("driveScore.achievements.\(key)"),
            descriptionKey: LocalizedStringKey("driveScore.achievements.\(key)Desc"),
            systemImage: systemImage,
            unlocked: unlocked
        )
    }
}
