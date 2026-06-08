//
//  MonthlyMileageWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0065 · MonthlyMileageWidget (Apple)
//
//  The Swift Charts bar chart — the native counterpart of the web Recharts
//  `BarChart` in features/dashboard/widgets/MonthlyMileageWidget.tsx. Renders one
//  bar per month over the last 12 months with the current calendar month
//  highlighted, a tap-to-inspect value tooltip, and per-bar VoiceOver values.
//

import Charts
import SwiftUI

/// Monthly driving-distance bar chart. The current month is drawn in the brand
/// accent; prior months use a muted fill (web cyan `#22d3ee` vs `white/10`). The
/// x-domain is pinned to the bar order so months stay chronological, and the
/// y-axis labels are abbreviated (web `fmt(v, 0)`).
struct MonthlyMileageChart: View {
    let bars: [MileageBar]
    let unit: String
    var isWide: Bool = false

    @State private var selectedMonth: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var selectedBar: MileageBar? {
        guard let selectedMonth else { return nil }
        return bars.first { $0.month == selectedMonth }
    }

    private var monthLabel: String {
        MonthlyMileageStrings.string("widget.monthlyMileage.month", "Month")
    }

    private var distanceLabel: String {
        MonthlyMileageStrings.string("widget.monthlyMileage.distance", "Distance")
    }

    var body: some View {
        Chart {
            ForEach(bars) { bar in
                BarMark(
                    x: .value(monthLabel, bar.month),
                    y: .value(distanceLabel, bar.distance)
                )
                .foregroundStyle(bar.isCurrent ? Color.TS.accent : Color.TS.textMuted.opacity(0.35))
                .cornerRadius(4)
                .accessibilityLabel(Text(verbatim: bar.month))
                .accessibilityValue(Text(verbatim: MonthlyMileageAccessibility.barLabel(bar, unit: unit)))
            }

            if let selectedBar {
                RuleMark(x: .value(monthLabel, selectedBar.month))
                    .foregroundStyle(Color.TS.border)
                    .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        tooltip(for: selectedBar)
                    }
            }
        }
        .chartXScale(domain: bars.map(\.month))
        .chartXSelection(value: $selectedMonth)
        .chartXAxis {
            AxisMarks { _ in
                AxisValueLabel()
                    .font(isWide ? Font.TS.caption : Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: Self.axisLabel(number))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: bars)
        .accessibilityLabel(
            MonthlyMileageStrings.text(
                "widget.monthlyMileage.chartA11y",
                "Bar chart of monthly driving distance over the last 12 months"
            )
        )
    }

    private func tooltip(for bar: MileageBar) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            MonthlyMileageStrings.text("widget.monthlyMileage.distance", "Distance")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: "\(MonthlyMileageFormat.decimal(bar.distance, digits: 1)) \(unit)")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    /// Abbreviated axis label; non-finite input renders an em dash (web `fmt`).
    static func axisLabel(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        let magnitude = abs(value)
        switch magnitude {
        case 1_000_000...:
            return String(format: "%.1fM", value / 1_000_000)
        case 1000...:
            return String(format: "%.1fk", value / 1000)
        default:
            return String(format: "%.0f", value)
        }
    }
}
