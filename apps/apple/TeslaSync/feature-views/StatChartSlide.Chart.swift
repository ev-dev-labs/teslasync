//
//  StatChartSlide.Chart.swift
//  TeslaSync — P4 feature view · 0067 · StatChartSlide (Apple)
//
//  The Swift Charts bar chart — the native counterpart of the web Recharts
//  `BarChart` in StatChartSlide.tsx (one bar per month over `monthly_stats`). The
//  web "@/components/charts" barrel re-exports Recharts; the slide's "(none)" charts
//  metadata is an extraction artifact — the source clearly renders a bar chart, so
//  it is reproduced here with Swift Charts per the prompt's Recharts→Swift Charts map.
//
//  Renders one drives-per-month bar (web violet `rgba(167,139,250,0.7)` → the brand
//  `chartSeriesPower` token), a tap-to-inspect value tooltip, per-bar VoiceOver
//  values, and a friendly fallback when a recap has no monthly rows (never a
//  blank box).
//

import Charts
import SwiftUI

/// Drives-by-month bar chart. Bars use the brand purple token (the web violet fill);
/// the x-domain is pinned to the bar order so months stay chronological and the
/// y-axis labels are abbreviated (web `fmt(v, 0)`). Honors Reduce Motion.
struct StatChartSlideChart: View {
    let bars: [StatChartSlideBar]
    let localeIdentifier: String

    @State private var selectedMonth: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var selectedBar: StatChartSlideBar? {
        guard let selectedMonth else { return nil }
        return bars.first { $0.month == selectedMonth }
    }

    private var monthAxisLabel: String {
        StatChartSlideStrings.string("yearReview.statChart.monthAxis", "Month")
    }

    private var drivesAxisLabel: String {
        StatChartSlideStrings.string("yearReview.statChart.drivesAxis", "Drives")
    }

    private func barAccessibilityValue(for bar: StatChartSlideBar) -> String {
        StatChartSlideAccessibility.barValue(for: bar, localeIdentifier: localeIdentifier)
    }

    var body: some View {
        if bars.isEmpty {
            emptyChart
        } else {
            chart
        }
    }

    private var chart: some View {
        Chart {
            ForEach(bars) { bar in
                BarMark(
                    x: .value(monthAxisLabel, bar.label),
                    y: .value(drivesAxisLabel, bar.drives)
                )
                .foregroundStyle(Color.TS.chartSeriesPower.opacity(bar.month == selectedMonth ? 1 : 0.7))
                .cornerRadius(4)
                .accessibilityLabel(Text(verbatim: bar.label))
                .accessibilityValue(Text(verbatim: barAccessibilityValue(for: bar)))
            }

            if let selectedBar {
                RuleMark(x: .value(monthAxisLabel, selectedBar.label))
                    .foregroundStyle(Color.TS.border)
                    .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        tooltip(for: selectedBar)
                    }
            }
        }
        .chartXScale(domain: bars.map(\.label))
        .chartXSelection(value: selectedLabelBinding)
        .chartXAxis {
            AxisMarks { _ in
                AxisValueLabel()
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.5))
                AxisValueLabel {
                    if let number = value.as(Int.self) {
                        Text(verbatim: Self.axisLabel(number, localeIdentifier: localeIdentifier))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: bars)
        .accessibilityLabel(
            StatChartSlideStrings.text(
                "yearReview.statChart.chartA11y",
                "Bar chart of your drives by month"
            )
        )
    }

    /// Bridges the category-string chart selection back to the bar's month identity.
    private var selectedLabelBinding: Binding<String?> {
        Binding(
            get: { selectedBar?.label },
            set: { newLabel in selectedMonth = bars.first { $0.label == newLabel }?.month }
        )
    }

    private func tooltip(for bar: StatChartSlideBar) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: bar.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: StatChartSlideFormat.integer(bar.drives, localeIdentifier: localeIdentifier))
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

    private var emptyChart: some View {
        StatChartSlideStrings.text("yearReview.statChart.emptyChart", "No monthly data yet")
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .multilineTextAlignment(.center)
            .accessibilityElement()
            .accessibilityLabel(StatChartSlideStrings.text("yearReview.statChart.emptyChart", "No monthly data yet"))
    }

    /// Abbreviated y-axis label; large counts collapse to a `k`/`M` suffix (web `fmt`).
    static func axisLabel(_ value: Int, localeIdentifier: String = "en_US") -> String {
        let magnitude = abs(value)
        switch magnitude {
        case 1_000_000...:
            return String(format: "%.1fM", Double(value) / 1_000_000)
        case 10000...:
            return String(format: "%.0fk", Double(value) / 1000)
        default:
            return StatChartSlideFormat.integer(value, localeIdentifier: localeIdentifier)
        }
    }
}
