import SwiftUI

// The metric-card grids + KVLists for the Drive Score surface (web Section 8 summary stats, Section 9
// weekly/monthly period stats, Section 10 achievements, and the two breakdown KVLists). Each value
// formats from raw SI via `DriveScoreFormat` at this display boundary; the period grid renders its own
// empty state (web `noPeriodStats`).

// MARK: - Summary stat cards (web Section 8 — Avg-Score / Best-Score / Total-Drives / Avg-Efficiency)

/// The four summary stat cards (web Avg-Score, Best-Score, Total-Drives, Avg-Efficiency). The
/// averaged total carries the trend delta (web `StatCard.trend`).
struct DriveScoreSummaryStatsSection: View {
    let model: DriveScorePageModel
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            TSStatCard(
                title: "driveScore.avgScore",
                value: "\(model.averages.total)/100",
                systemImage: "target",
                delta: trendDelta,
                deltaFormatted: model.overallTrend.labelText
            )
            TSStatCard(title: "driveScore.bestScore", value: "\(model.bestScore)/100", systemImage: "trophy.fill")
            TSStatCard(
                title: "driveScore.totalDrivesLabel",
                value: "\(model.scoredDrives.count)",
                systemImage: "car.fill"
            )
            TSStatCard(
                title: "driveScore.avgEffLabel",
                value: DriveScoreFormat.efficiency(model.avgWhPerKm, units),
                systemImage: "bolt.fill"
            )
        }
    }

    /// Web `trend.positive` direction encoded for the shared `TSDelta` arrow tint.
    private var trendDelta: Double {
        switch model.overallTrend {
        case .up: 1
        case .down: -1
        case .flat: 0
        }
    }
}

// MARK: - Period stats (web Section 9 — GlassPanel20…25, or noPeriodStats GlassPanel26)

/// The weekly / monthly roll-up grid (web GlassPanel20–25): This Week, This Month, Best Week, Best
/// Month, Total Drives, and Rated A+/A — or the `noPeriodStats` empty panel (web GlassPanel26).
struct DriveScorePeriodStatsSection: View {
    let stats: DriveScorePeriodStats?

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        if let stats {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                DriveScorePeriodCard(
                    label: "driveScore.thisWeek",
                    valueText: averageText(stats.thisWeekAvg),
                    valueTone: DriveScoreStyle.scoreTone(stats.thisWeekAvg),
                    captionText: vsText("driveScore.vsLastWeek", stats.lastWeekAvg),
                    delta: delta(stats.thisWeekAvg, stats.lastWeekAvg)
                )
                DriveScorePeriodCard(
                    label: "driveScore.thisMonth",
                    valueText: averageText(stats.thisMonthAvg),
                    valueTone: DriveScoreStyle.scoreTone(stats.thisMonthAvg),
                    captionText: vsText("driveScore.vsLastMonth", stats.lastMonthAvg),
                    delta: delta(stats.thisMonthAvg, stats.lastMonthAvg)
                )
                DriveScorePeriodCard(
                    label: "driveScore.bestWeek",
                    valueText: bestText(stats.bestWeek.average),
                    valueTone: DriveScoreStyle.scoreTone(positiveOrNil(stats.bestWeek.average)),
                    captionText: stats.bestWeek.label,
                    delta: nil
                )
                DriveScorePeriodCard(
                    label: "driveScore.bestMonth",
                    valueText: bestText(stats.bestMonth.average),
                    valueTone: DriveScoreStyle.scoreTone(positiveOrNil(stats.bestMonth.average)),
                    captionText: stats.bestMonth.label,
                    delta: nil
                )
                DriveScorePeriodCard(
                    label: "driveScore.totalDrivesLabel",
                    valueText: "\(stats.totalDrives)",
                    valueTone: .neutral,
                    captionText: String(localized: "driveScore.drivesScored"),
                    delta: nil
                )
                DriveScorePeriodCard(
                    label: "driveScore.ratedAPlus",
                    valueText: "\(stats.aOrBetter)",
                    valueTone: .success,
                    captionText: aPlusCaption(stats),
                    delta: nil
                )
            }
        } else {
            TSGlassPanel {
                TSEmptyState(title: "driveScore.noPeriodStats", systemImage: "calendar.badge.clock")
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func averageText(_ value: Int?) -> String {
        value.map { "\($0)" } ?? DriveScoreFormat.emptyValue
    }

    private func bestText(_ value: Int) -> String {
        value > 0 ? "\(value)" : DriveScoreFormat.emptyValue
    }

    private func positiveOrNil(_ value: Int) -> Int? {
        value > 0 ? value : nil
    }

    private func vsText(_ key: String.LocalizationValue, _ value: Int?) -> String {
        let formatted = value.map { "\($0)" } ?? DriveScoreFormat.emptyValue
        return String(format: String(localized: key), formatted)
    }

    private func delta(_ current: Int?, _ previous: Int?) -> DriveScorePeriodDelta? {
        guard let current, let previous else { return nil }
        return DriveScorePeriodDelta(magnitude: abs(current - previous), positive: current >= previous)
    }

    private func aPlusCaption(_ stats: DriveScorePeriodStats) -> String {
        guard let share = stats.aOrBetterShare else { return String(localized: "driveScore.noDrives") }
        return "\(DriveScoreFormat.integer(share))% \(String(localized: "driveScore.ofDrives"))"
    }
}

/// A signed magnitude shown beside a period average (web week/month delta chip).
struct DriveScorePeriodDelta: Equatable {
    let magnitude: Int
    let positive: Bool
}

/// One weekly/monthly period card (web GlassPanel20–25): an uppercase label, the big tinted value
/// (with an optional delta), and a sub-caption.
struct DriveScorePeriodCard: View {
    let label: LocalizedStringKey
    let valueText: String
    let valueTone: TSTone
    let captionText: String
    let delta: DriveScorePeriodDelta?

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSLabel(label)
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    Text(verbatim: valueText)
                        .font(Font.TS.title)
                        .fontWeight(.bold)
                        .monospacedDigit()
                        .foregroundStyle(valueTone == .neutral ? Color.TS.textPrimary : valueTone.color)
                    if let delta {
                        TSDelta(value: delta.positive ? 1 : -1, formatted: "\(delta.magnitude)")
                    }
                }
                Text(verbatim: captionText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Achievements (web Section 10 — GlassPanel27)

/// The achievements panel (web GlassPanel27): a title and a grid of achievement badges, each
/// highlighted when unlocked and dimmed otherwise.
struct DriveScoreAchievementsSection: View {
    let achievements: [DriveScoreAchievement]
    let isCompact: Bool

    private var columns: [GridItem] {
        let count = isCompact ? 2 : 4
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: count)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("driveScore.achievements.title")
                LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                    ForEach(achievements) { achievement in
                        DriveScoreAchievementBadge(achievement: achievement)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One achievement badge (web Section 10 tile): an icon medallion, the title, the description, and an
/// "Unlocked" badge when earned. Locked badges are dimmed (web `opacity-40`).
struct DriveScoreAchievementBadge: View {
    let achievement: DriveScoreAchievement

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: achievement.systemImage)
                .font(.system(size: 18))
                .foregroundStyle(achievement.unlocked ? Color.TS.statusWarning : Color.TS.textMuted)
                .frame(width: 40, height: 40)
                .background(
                    Circle().fill(
                        achievement.unlocked ? Color.TS.statusWarning.opacity(0.18) : Color.TS.surfaceGlass
                    )
                )
                .accessibilityHidden(true)
            Text(achievement.titleKey)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(achievement.unlocked ? Color.TS.textPrimary : Color.TS.textMuted)
                .multilineTextAlignment(.center)
            Text(achievement.descriptionKey)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
            if achievement.unlocked {
                TSBadge("driveScore.achievements.unlocked", tone: .success)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .fill(achievement.unlocked ? Color.TS.statusWarning.opacity(0.06) : Color.TS.surfaceGlass.opacity(0.4))
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(
                    achievement.unlocked ? Color.TS.statusWarning.opacity(0.3) : Color.TS.border,
                    lineWidth: 1
                )
        )
        .opacity(achievement.unlocked ? 1 : 0.55)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Breakdown KVLists (web — Card28 Score Breakdown + Card29 Period Statistics)

/// The two breakdown KVLists (web Card28 Score Breakdown + Card29 Period Statistics): the per-category
/// score lines and the period totals/averages, each a `TSCard` + `TSKVList`.
struct DriveScoreBreakdownDetailSection: View {
    let model: DriveScorePageModel
    let units: UnitPreferences
    let isCompact: Bool

    private var columns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: 2)
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            TSCard {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSCardHeader("driveScore.breakdown")
                    TSKVList(rows: breakdownRows)
                }
            }
            TSCard {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSCardHeader("driveScore.periodStats")
                    TSKVList(rows: periodRows)
                }
            }
        }
    }

    /// Web Card28 rows: efficiency / smoothness / speed / total scores.
    private var breakdownRows: [TSKVRow] {
        [
            TSKVRow(
                id: "efficiency",
                key: "driveScore.efficiencyLabel",
                value: "\(model.categoryScore(.efficiency))/40"
            ),
            TSKVRow(
                id: "smoothness",
                key: "driveScore.smoothnessLabel",
                value: "\(model.categoryScore(.smoothness))/30"
            ),
            TSKVRow(id: "speed", key: "driveScore.speedLabel", value: "\(model.categoryScore(.speed))/30"),
            TSKVRow(id: "total", key: "driveScore.totalLabel", value: "\(model.overallScore)/100")
        ]
    }

    /// Web Card29 rows: total/avg distance + duration, highest speed, and the A+ drive count.
    private var periodRows: [TSKVRow] {
        [
            TSKVRow(
                id: "totalDistance",
                key: "driveScore.totalDistance",
                value: DriveScoreFormat.distance(model.totalDistanceM, units)
            ),
            TSKVRow(
                id: "totalDuration",
                key: "driveScore.totalDuration",
                value: DriveScoreFormat.durationSeconds(model.totalDurationS)
            ),
            TSKVRow(
                id: "avgDistance",
                key: "driveScore.avgDistance",
                value: DriveScoreFormat.distance(model.avgDistanceM, units)
            ),
            TSKVRow(
                id: "avgDuration",
                key: "driveScore.avgDuration",
                value: DriveScoreFormat.durationSeconds(model.avgDurationS)
            ),
            TSKVRow(
                id: "highestSpeed",
                key: "driveScore.highestSpeed",
                value: DriveScoreFormat.speed(model.highestMaxSpeedMps, units)
            ),
            TSKVRow(
                id: "aPlusCount",
                key: "driveScore.aPlusCount",
                value: DriveScoreFormat.integer(Double(model.aPlusCount))
            )
        ]
    }
}
