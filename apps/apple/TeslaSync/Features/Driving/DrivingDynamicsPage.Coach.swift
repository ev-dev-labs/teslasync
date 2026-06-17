//
//  DrivingDynamicsPage.Coach.swift
//  TeslaSync — P4-APPLE P7 · page:driving/DrivingDynamics (Apple) — Driving coach (1/2)
//
//  The driving-coach section (web `DrivingCoachSection`): the overall-score gauge
//  with the drives-analyzed caption, the style-breakdown stacked bar with its
//  legend, the average / best efficiency cards, and the weekly score-trend chart.
//  The pattern bars, recommendations, and per-drive table live in the sibling
//  `…Coach.Detail` file. Every panel renders its own empty state (web `EmptyState`)
//  rather than hiding when the coach summary is absent.
//

import SwiftUI

// MARK: - Driving coach section (web `DrivingCoachSection`)

struct DDynCoachSection: View {
    let coach: DDynCoachData?

    private let topColumns = [GridItem(.adaptive(minimum: 260), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSFadeIn(delay: 0.42) {
                DrivingSectionTitle(DDynStrings.text("dynamics.coach.title", "Driving Coach"))
            }
            TSFadeIn(delay: 0.43) {
                LazyVGrid(columns: topColumns, spacing: TSSpacing.md) {
                    DDynCoachScoreCard(coach: coach)
                    DDynCoachStyleCard(coach: coach)
                    DDynCoachEfficiencyCard(coach: coach)
                }
            }
            TSFadeIn(delay: 0.46) { DDynCoachTrendCard(coach: coach) }
            TSFadeIn(delay: 0.47) { DDynCoachPatternsCard(coach: coach) }
            TSFadeIn(delay: 0.48) { DDynCoachRecommendationsCard(coach: coach) }
            TSFadeIn(delay: 0.49) { DDynCoachTableCard(coach: coach) }
        }
    }
}

// MARK: - Score gauge (web score panel)

struct DDynCoachScoreCard: View {
    let coach: DDynCoachData?

    private var score: Double { coach?.overallScore ?? 0 }

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.md) {
                DrivingValueGauge(
                    value: score,
                    maxValue: 100,
                    valueText: DDynFormat.number(score, fractionDigits: 0),
                    unit: "",
                    label: DDynStrings.text("dynamics.coach.overallScore", "Driving Score"),
                    color: DDynCoachStyle.scoreColor(score),
                    size: 150
                )
                Text(verbatim: DDynStrings.drivesAnalyzed(coach?.totalDrivesAnalyzed ?? 0))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Style breakdown (web style panel)

struct DDynCoachStyleCard: View {
    let coach: DDynCoachData?

    private var total: Int { coach?.totalDrivesAnalyzed ?? 0 }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingPanelHeading(text: DDynStrings.text("dynamics.coach.styleBreakdown", "Style Breakdown"))
                if let coach, total > 0 {
                    DDynStyleBar(coach: coach)
                    ForEach(DDynCoachStyle.allChips, id: \.style) { chip in
                        styleRow(chip, count: coach.styleCount(chip.style))
                    }
                } else {
                    TSEmptyState(
                        title: "common.noData",
                        message: DDynStrings.key("dynamics.coach.noData"),
                        systemImage: "chart.pie"
                    )
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func styleRow(_ chip: DDynCoachStyle.Chip, count: Int) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Circle().fill(chip.tone.color).frame(width: 8, height: 8)
            Text(verbatim: DDynStrings.styleLabel(chip.style))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer()
            Text(verbatim: "\(count)")
                .font(Font.TS.caption)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(chip.tone.color)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The proportional efficient/moderate/aggressive bar (web rounded stacked bar).
struct DDynStyleBar: View {
    let coach: DDynCoachData

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 0) {
                ForEach(DDynCoachStyle.allChips, id: \.style) { chip in
                    let fraction = total > 0 ? Double(coach.styleCount(chip.style)) / Double(total) : 0
                    chip.tone.color.frame(width: geo.size.width * fraction)
                }
            }
        }
        .frame(height: 16)
        .clipShape(Capsule())
        .accessibilityHidden(true)
    }

    private var total: Int { coach.totalDrivesAnalyzed }
}

// MARK: - Efficiency cards (web efficiency panel)

struct DDynCoachEfficiencyCard: View {
    let coach: DDynCoachData?

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSStatCard(
                    title: DDynStrings.key("dynamics.coach.avgEfficiency"),
                    value: "\(DDynFormat.number(coach?.efficiencyWhKm ?? 0, fractionDigits: 1)) Wh/km",
                    systemImage: "bolt.fill"
                )
                TSStatCard(
                    title: DDynStrings.key("dynamics.coach.bestEfficiency"),
                    value: "\(DDynFormat.number(coach?.bestEfficiencyWhKm ?? 0, fractionDigits: 1)) Wh/km",
                    systemImage: "checkmark.seal.fill"
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Weekly trend (web weekly-trend panel)

struct DDynCoachTrendCard: View {
    let coach: DDynCoachData?

    private var trend: [CoachWeeklyTrend] { coach?.weeklyTrend ?? [] }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingPanelHeading(text: DDynStrings.text("dynamics.coach.weeklyTrend", "Weekly Score Trend"))
                if trend.count > 1 {
                    TSLineChart(series: [trendSeries])
                        .frame(height: 200)
                } else {
                    TSEmptyState(
                        title: "common.noData",
                        message: DDynStrings.key("dynamics.coach.needWeeks"),
                        systemImage: "calendar"
                    )
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var trendSeries: TSChartSeries {
        let points = trend.enumerated().map { index, week in
            TSChartPoint(x: Double(index), y: week.score, id: week.week)
        }
        return TSChartSeries(
            id: "score",
            name: DDynStrings.key("dynamics.coach.weeklyTrend"),
            nameText: DDynStrings.text("dynamics.coach.weeklyTrend", "Weekly Score Trend"),
            points: points,
            colorIndex: 2
        )
    }
}

// MARK: - Shared coach color/tone helpers

enum DDynCoachStyle {
    struct Chip {
        let style: CoachStyle
        let tone: TSTone
    }

    static let allChips: [Chip] = [
        Chip(style: .efficient, tone: .success),
        Chip(style: .moderate, tone: .warning),
        Chip(style: .aggressive, tone: .danger)
    ]

    /// Web score color: ≥75 green, ≥50 amber, else red.
    static func scoreColor(_ score: Double) -> Color {
        if score >= 75 { return Color.TS.statusSuccess }
        if score >= 50 { return Color.TS.statusWarning }
        return Color.TS.statusDanger
    }

    /// Web per-drive score badge tone (≥75 success, ≥50 warning, else danger).
    static func scoreTone(_ score: Double) -> TSTone {
        if score >= 75 { return .success }
        if score >= 50 { return .warning }
        return .danger
    }

    /// Web style badge tone (efficient success, moderate warning, aggressive danger).
    static func tone(for style: CoachStyle) -> TSTone {
        switch style {
        case .efficient: .success
        case .moderate: .warning
        case .aggressive: .danger
        }
    }
}
