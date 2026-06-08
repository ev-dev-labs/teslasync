//
//  DrivingSection.Chart.swift
//  TeslaSync — P4 feature view · 0075 · DrivingSection (Apple)
//
//  The Swift Charts daily-distance bar chart (web Recharts `BarChart` → native `Chart { BarMark }`)
//  with its selection tooltip (web `ChartTooltip`), the titled nested panel, and the chart's empty
//  state. Chrome is token-driven (P1/S9); copy resolves through the P1/S10 facade. No networking
//  lives here.
//

import Charts
import SwiftUI

// MARK: - Daily-distance chart panel (web Recharts `BarChart`)

/// The "Daily Distance (km)" panel: the titled nested `GlassPanel` wrapping either the bar chart or,
/// when there is no data, the web `EmptyState`.
struct DrivingDailyDistancePanel: View {
    let bars: [DrivingDistanceBar]
    let chartAccessibilityLabel: String

    var body: some View {
        DrivingGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivingSectionStrings.text("analytics.weeklyDigest.dailyDistance", "Daily Distance (km)")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                if bars.isEmpty {
                    DrivingDailyDistanceEmpty()
                } else {
                    DrivingDistanceBarChart(bars: bars, accessibilityLabel: chartAccessibilityLabel)
                }
            }
        }
    }
}

/// The daily-distance bar chart — the native counterpart of the web Recharts `BarChart` with one
/// `<Bar dataKey="distance">` per weekday. Tapping a column reveals a value tooltip (web
/// `ChartTooltip`); each column carries a per-day VoiceOver value.
struct DrivingDistanceBarChart: View {
    let bars: [DrivingDistanceBar]
    let accessibilityLabel: String

    @State private var selectedDay: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var selectedBar: DrivingDistanceBar? {
        guard let selectedDay else { return nil }
        return bars.first { $0.day == selectedDay }
    }

    private var dayLabel: String {
        DrivingSectionStrings.string("analytics.weeklyDigest.driving.day", "Day")
    }

    private var distanceLabel: String {
        DrivingSectionStrings.string("analytics.weeklyDigest.distance", "Distance")
    }

    var body: some View {
        Chart {
            ForEach(bars) { bar in
                BarMark(
                    x: .value(dayLabel, bar.day),
                    y: .value(distanceLabel, bar.distanceKm)
                )
                .foregroundStyle(TSChartPalette.color(at: 0))
                .cornerRadius(4)
                .accessibilityLabel(Text(verbatim: bar.day))
                .accessibilityValue(Text(verbatim: bar.valueText))
            }

            if let selectedBar {
                RuleMark(x: .value(dayLabel, selectedBar.day))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        DrivingDistanceTooltip(bar: selectedBar)
                    }
            }
        }
        .chartXScale(domain: bars.map(\.day))
        .chartXSelection(value: $selectedDay)
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel {
                    if let day = value.as(String.self) {
                        Text(verbatim: day)
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: DrivingFormat.integer(number))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .frame(height: 260)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: bars)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

/// The selection tooltip: the day label over the distance value — the native parity of the web
/// `ChartTooltip` payload list.
struct DrivingDistanceTooltip: View {
    let bar: DrivingDistanceBar

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: bar.day)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle().fill(TSChartPalette.color(at: 0)).frame(width: 7, height: 7)
                DrivingSectionStrings.text("analytics.weeklyDigest.distance", "Distance")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: bar.valueText)
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
        .frame(minWidth: 148, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// The chart's empty state (web `<EmptyState message={t('…noDailyDistance')}>`): never a blank box.
struct DrivingDailyDistanceEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                DrivingSectionStrings.text(
                    "analytics.weeklyDigest.noDailyDistance",
                    "No driving distance data is available for this week."
                )
            } icon: {
                Image(systemName: "chart.bar.xaxis")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}
