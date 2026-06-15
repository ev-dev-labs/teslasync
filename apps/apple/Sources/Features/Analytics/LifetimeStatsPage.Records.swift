import SwiftUI

// The Personal-Records, Activity-Summary, and Achievement-Gallery panels for the Lifetime Stats
// surface (web `LifetimeStatsPage.tsx` GlassPanel9/10/11). Each value formats from raw SI via
// `LifetimeStatsFormat`; each panel renders its own empty state (never a blank region), exactly as
// the web page's `stats ? … : <EmptyState>` / `achievements.length > 0 ? … : <EmptyState>` branches.

// MARK: - Personal Records (web GlassPanel9)

/// The Personal Records panel (web `GlassPanel`): longest drive, highest speed, and biggest charge
/// record cards, or the no-data empty.
struct LifetimeRecordsSection: View {
    let stats: LifetimeStats?
    let units: UnitPreferences
    let isCompact: Bool

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                LifetimeSectionHeader(systemImage: "trophy.fill", tone: .warning, title: "lifetime.personalRecords")
                if let stats {
                    let columns = LifetimeGrid.columns(isCompact ? 1 : 3)
                    LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                        LifetimeRecordCard(
                            systemImage: "car.fill",
                            tone: .accent,
                            title: "lifetime.longestDrive",
                            value: LifetimeStatsFormat.distance(stats.longestDriveRecord.valueSI, units, decimals: 1),
                            date: LifetimeStatsFormat.date(stats.longestDriveRecord.date)
                        )
                        LifetimeRecordCard(
                            systemImage: "gauge.with.dots.needle.bottom.50percent",
                            tone: .danger,
                            title: "lifetime.highestSpeed",
                            value: LifetimeStatsFormat.speed(stats.highestSpeedRecord.valueSI, units, decimals: 0),
                            date: LifetimeStatsFormat.date(stats.highestSpeedRecord.date)
                        )
                        LifetimeRecordCard(
                            systemImage: "bolt.batteryblock.fill",
                            tone: .success,
                            title: "lifetime.biggestCharge",
                            value: LifetimeStatsFormat.energyKWh(stats.maxChargeRecord.valueSI, decimals: 1),
                            date: LifetimeStatsFormat.date(stats.maxChargeRecord.date)
                        )
                    }
                } else {
                    TSEmptyState(title: "lifetime.noData", systemImage: "chart.bar")
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One record (web `RecordCard`): a tinted glyph, the record title, its value, and the date it was
/// set (hidden when unknown, web `date && …`).
struct LifetimeRecordCard: View {
    let systemImage: String
    let tone: TSTone
    let title: LocalizedStringKey
    let value: String
    let date: String?

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: systemImage)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(title)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(verbatim: value)
                    .font(Font.TS.panel)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                if let date {
                    Text(verbatim: date)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Activity Summary (web GlassPanel10)

/// The Activity Summary panel (web `GlassPanel`): most-active day, peak hour, days on road, and
/// average efficiency mini-stats, or the no-data empty.
struct LifetimeActivitySection: View {
    let stats: LifetimeStats?
    let units: UnitPreferences
    let isCompact: Bool

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                LifetimeSectionHeader(systemImage: "clock.fill", tone: .info, title: "lifetime.activitySummary")
                if let stats {
                    LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                        LifetimeMiniStat(
                            label: "lifetime.mostActiveDay",
                            value: LifetimeStatsFormat.dayOfWeek(stats.mostActiveDayOfWeek)
                        )
                        LifetimeMiniStat(
                            label: "lifetime.mostActiveHour",
                            value: LifetimeStatsFormat.hourOfDay(stats.mostActiveHour)
                        )
                        LifetimeMiniStat(
                            label: "lifetime.daysOnRoad",
                            value: LifetimeStatsFormat.number(stats.daysOnRoad, decimals: 1)
                        )
                        LifetimeMiniStat(
                            label: "lifetime.avgEfficiency",
                            value: LifetimeStatsFormat.efficiency(stats.avgEfficiencyWhKm)
                        )
                    }
                } else {
                    TSEmptyState(title: "lifetime.noData", systemImage: "chart.bar")
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One activity mini-stat (web `MiniStat`): a centered caption label over its value.
struct LifetimeMiniStat: View {
    let label: LocalizedStringKey
    let value: String

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Achievement Gallery (web GlassPanel11)

/// The Achievement Gallery panel (web `GlassPanel`): a header with the unlocked count, then the
/// badge grid, or the no-achievements empty.
struct LifetimeAchievementsSection: View {
    let achievements: [LifetimeAchievement]
    let unlockedCount: Int

    private let columns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack {
                    LifetimeSectionHeader(systemImage: "trophy.fill", tone: .warning, title: "lifetime.achievements")
                    Spacer(minLength: TSSpacing.sm)
                    HStack(spacing: TSSpacing.xs) {
                        Text(verbatim: "\(unlockedCount)/\(achievements.count)")
                            .monospacedDigit()
                        Text("lifetime.unlocked")
                    }
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                }
                if achievements.isEmpty {
                    TSEmptyState(title: "lifetime.noAchievements", systemImage: "trophy")
                        .frame(maxWidth: .infinity)
                } else {
                    LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                        ForEach(achievements) { achievement in
                            LifetimeAchievementBadge(achievement: achievement)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One achievement badge (web `AchievementBadge`): a progress ring behind a (grayscaled-when-locked)
/// emoji, the name, the description, and either the "✓ Unlocked" status or the completion percent.
struct LifetimeAchievementBadge: View {
    let achievement: LifetimeAchievement

    private var ringColorIndex: Int {
        achievement.isNearComplete ? 3 : 7
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ZStack {
                if !achievement.unlocked {
                    TSProgressRing(
                        progress: achievement.progress,
                        lineWidth: 4,
                        colorIndex: ringColorIndex
                    )
                    .frame(width: 64, height: 64)
                }
                Text(verbatim: achievement.icon)
                    .font(.system(size: 30))
                    .grayscale(achievement.unlocked ? 0 : 1)
                    .opacity(achievement.unlocked ? 1 : 0.5)
                    .frame(width: 64, height: 64)
                    .accessibilityHidden(true)
            }
            Text(verbatim: achievement.name)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .multilineTextAlignment(.center)
                .foregroundStyle(achievement.unlocked ? Color.TS.statusWarning : Color.TS.textSecondary)
            Text(verbatim: achievement.description)
                .font(Font.TS.caption)
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            if achievement.unlocked {
                Text("lifetime.unlocked")
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.statusWarning)
            } else {
                Text(verbatim: "\(achievement.progressPercent)%")
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.md)
        .background(badgeBackground)
        .overlay(badgeBorder)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: achievement.name))
    }

    private var badgeBackground: some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(achievement.unlocked ? Color.TS.statusWarning.opacity(0.08) : Color.TS.surfaceGlass)
    }

    private var badgeBorder: some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .strokeBorder(
                achievement.unlocked ? Color.TS.statusWarning.opacity(0.3) : Color.TS.border,
                lineWidth: 1
            )
    }
}
