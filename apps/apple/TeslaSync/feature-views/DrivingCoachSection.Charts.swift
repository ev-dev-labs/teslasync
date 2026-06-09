//
//  DrivingCoachSection.Charts.swift
//  TeslaSync — P4 feature view · 0167 · DrivingCoachSection (Apple)
//
//  The weekly-score-trend Swift Chart that is the native parity of the web Recharts `LineChart` (mapped
//  through the P3 `@/components/charts` layer): a 0-100 score line across the ISO-week buckets, with point
//  markers, a tap-to-reveal tooltip (web `ChartTooltip`), and its own inner empty state when there is not
//  yet more than one week of data (web `weekly_trend.length > 1 ? <LineChart/> : <EmptyState/>`). Chrome is
//  token-driven (P1/S9); copy resolves through the P1/S10 facade. No networking lives here.
//

import Charts
import SwiftUI

/// The "Weekly Score Trend" panel: the 0-100 score line chart over the weekly buckets, or the friendly
/// inner empty state when fewer than two weeks have been recorded.
struct DrivingCoachWeeklyTrendPanel: View {
    let points: [DrivingCoachTrendPoint]

    @State private var selectedWeek: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let chartHeight: CGFloat = 220

    /// Web `weekly_trend.length > 1` — at least two weeks are needed to draw a trend.
    private var hasTrend: Bool {
        points.count > 1
    }

    private var selectedPoint: DrivingCoachTrendPoint? {
        guard let selectedWeek else { return nil }
        return points.first { $0.week == selectedWeek }
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingCoachPanelHeading(key: "dynamics.coach.weeklyTrend", fallback: "Weekly Score Trend")
                if hasTrend {
                    chart
                        .frame(height: chartHeight)
                        .accessibilityLabel(DrivingCoachSectionStrings.text(
                            "dynamics.coach.weeklyTrend.aria",
                            "Weekly driving-score trend line chart"
                        ))
                        .accessibilityValue(Text(verbatim: accessibilitySummary))
                } else {
                    DrivingCoachInnerEmpty(
                        key: "dynamics.coach.needWeeks",
                        fallback: "Need at least 2 weeks of data for trend analysis."
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                LineMark(
                    x: .value("week", point.week),
                    y: .value("score", point.score)
                )
                .interpolationMethod(.monotone)
                .foregroundStyle(Color.TS.statusSuccess)

                PointMark(
                    x: .value("week", point.week),
                    y: .value("score", point.score)
                )
                .symbolSize(36)
                .foregroundStyle(Color.TS.statusSuccess)
            }
            if let selectedPoint {
                RuleMark(x: .value("week", selectedPoint.week))
                    .foregroundStyle(Color.TS.border)
                    .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        DrivingCoachWeeklyTrendTooltip(point: selectedPoint)
                    }
            }
        }
        .chartXScale(domain: points.map(\.week))
        .chartYScale(domain: 0 ... 100)
        .chartXSelection(value: $selectedWeek)
        .chartXAxis { weekAxis }
        .chartYAxis { scoreAxis }
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: points)
    }

    private var weekAxis: some AxisContent {
        AxisMarks { value in
            AxisValueLabel {
                if let week = value.as(String.self) {
                    Text(verbatim: week)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private var scoreAxis: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let score = value.as(Double.self) {
                    Text(verbatim: DrivingCoachFormat.integer(score))
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private var accessibilitySummary: String {
        let weeks = DrivingCoachSectionStrings.string("dynamics.coach.weeks", "weeks")
        return "\(points.count) \(weeks)"
    }
}

/// The weekly-trend selection tooltip: the week label over its score.
struct DrivingCoachWeeklyTrendTooltip: View {
    let point: DrivingCoachTrendPoint

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: point.week)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle().fill(Color.TS.statusSuccess).frame(width: 7, height: 7)
                DrivingCoachSectionStrings.text("dynamics.coach.col.score", "Score")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: DrivingCoachFormat.scoreLabel(point.score))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(minWidth: 132, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
