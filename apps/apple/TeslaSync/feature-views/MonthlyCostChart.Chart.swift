//
//  MonthlyCostChart.Chart.swift
//  TeslaSync — P4 feature view · 0116 · MonthlyCostChart (Apple)
//
//  The monthly cost area (web Recharts `AreaChart` → native Swift `Chart` with an
//  `AreaMark` gradient fill plus a `LineMark` stroke per vertex). Split out of
//  MonthlyCostChart.Views.swift to keep each presentational file focused. A
//  drag/tap selection reproduces the web `<Tooltip>`: it pins a rule + a
//  highlighted dot and shows a month/cost callout. Vehicle-annotation `RuleMark`s
//  reproduce the web `renderAnnotationLines` overlay. The Y axis is
//  currency-formatted (web `formatCurrency(v, 0)`) and the X axis is thinned to a
//  readable `MM/YY` tick set (web `tickFormatter`). The whole chart exposes a single
//  accessible summary plus per-vertex labels so VoiceOver isn't handed an opaque
//  image. Colors come from `MonthlyCostPalette` (P1/S9). No networking here.
//

import Charts
import SwiftUI

// MARK: - Cost area (web `AreaChart` with a `cost` `Area`)

/// The monthly cost area. One `AreaMark` (gradient fill, web
/// `fill="url(#costGrad)"`) + a `LineMark` stroke (web `stroke={palette[0]}`) per
/// bucket, the currency Y axis, a thinned `MM/YY` X axis, the vehicle-annotation
/// reference lines, and an interactive selection callout that mirrors the web hover
/// tooltip.
struct MonthlyCostAreaChart: View {
    let points: [MonthlyCostChartPoint]
    let annotations: [MonthlyCostAnnotation]
    let axisTicks: [String]
    let localize: (String, String) -> String
    let formatting: any MonthlyCostFormatting

    @State private var selectedMonth: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The web `<Area name="Cost ($)">` series label.
    private var costLabel: String {
        localize("costAnalysis.charts.cost", "Cost ($)")
    }

    /// The X-axis value label (web `dataKey="month"`).
    private var monthLabel: String {
        localize("costAnalysis.charts.col.month", "Month")
    }

    /// The figure's accessible name (web `<ChartContainer ariaLabel>`).
    private var ariaLabel: String {
        localize("costAnalysis.charts.monthlyCost.aria", "Monthly charging cost trend area chart")
    }

    private var selectedPoint: MonthlyCostChartPoint? {
        guard let selectedMonth else { return nil }
        return points.first { $0.month == selectedMonth }
    }

    private var chartSummary: String {
        MonthlyCostAccessibility.chartSummary(
            points,
            localize: localize,
            formatCurrency: { [formatting] value in formatting.formatCurrency(value) }
        )
    }

    /// The vertical gradient under the line (web `areaGradient(color, 0.3)` →
    /// stops `0.3` at the top, `0.02` near the bottom).
    private var areaFill: LinearGradient {
        LinearGradient(
            colors: [MonthlyCostPalette.area.opacity(0.3), MonthlyCostPalette.area.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    var body: some View {
        chart
            .chartXSelection(value: $selectedMonth)
            .chartLegend(.hidden)
            .frame(height: 260)
            .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.fastDuration), value: selectedMonth)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: ariaLabel))
            .accessibilityValue(Text(verbatim: chartSummary))
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                AreaMark(
                    x: .value(monthLabel, point.month),
                    y: .value(costLabel, point.cost)
                )
                .foregroundStyle(areaFill)
                .interpolationMethod(.monotone)
                .accessibilityHidden(true)

                LineMark(
                    x: .value(monthLabel, point.month),
                    y: .value(costLabel, point.cost)
                )
                .foregroundStyle(MonthlyCostPalette.area)
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.monotone)
                .accessibilityLabel(Text(verbatim: MonthlyCostAccessibility.pointLabel(point)))
                .accessibilityValue(
                    Text(verbatim: MonthlyCostAccessibility.pointValue(
                        point,
                        formatCurrency: formatting.formatCurrency
                    ))
                )
            }

            ForEach(annotations) { annotation in
                RuleMark(x: .value(monthLabel, annotation.month))
                    .foregroundStyle(Color.TS.accent.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .annotation(position: .top, alignment: .leading, spacing: 2) {
                        Text(verbatim: annotation.label)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.accent)
                            .accessibilityLabel(Text(verbatim: annotation.label))
                    }
            }

            if let selected = selectedPoint {
                RuleMark(x: .value(monthLabel, selected.month))
                    .foregroundStyle(Color.TS.textMuted.opacity(0.4))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .annotation(
                        position: .top,
                        alignment: .center,
                        spacing: 6,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        MonthlyCostSelectionCallout(point: selected, formatting: formatting)
                    }

                PointMark(
                    x: .value(monthLabel, selected.month),
                    y: .value(costLabel, selected.cost)
                )
                .foregroundStyle(MonthlyCostPalette.area)
                .symbolSize(90)
                .accessibilityHidden(true)
            }
        }
        .chartXAxis {
            AxisMarks(values: axisTicks) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.15))
                AxisValueLabel {
                    if let month = value.as(String.self) {
                        Text(verbatim: MonthlyCostMonthLabel.short(month))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let cost = value.as(Double.self) {
                        Text(verbatim: formatting.formatCurrency(cost, decimals: 0))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
    }
}

// MARK: - Selection callout (web `<Tooltip>`)

/// The floating readout shown above the selected bucket — the native parity of the
/// web Recharts `<Tooltip>`: the `MM/YY` month over the formatted cost.
struct MonthlyCostSelectionCallout: View {
    let point: MonthlyCostChartPoint
    let formatting: any MonthlyCostFormatting

    var body: some View {
        VStack(spacing: 2) {
            Text(verbatim: point.shortMonth)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: formatting.formatCurrency(point.cost, decimals: 0))
                .font(Font.TS.bodySm)
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
}
