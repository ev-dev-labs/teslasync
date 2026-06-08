//
//  CostPerKwhChart.Chart.swift
//  TeslaSync — P4 feature view · 0110 · CostPerKwhChart (Apple)
//
//  The cost-per-kWh trend line (web Recharts `LineChart` → native Swift `Chart`
//  with a `LineMark` per vertex). Split out of CostPerKwhChart.Views.swift to keep
//  each presentational file focused. A drag/tap selection reproduces the web
//  `<Tooltip>` + `activeDot`: it pins a rule + a highlighted dot and shows a
//  date/rate callout. The Y axis is currency-formatted (web `formatCurrency(v, 2)`)
//  and the X axis is thinned to a readable tick set. The whole chart exposes a
//  single accessible summary plus per-vertex labels so VoiceOver isn't handed an
//  opaque image. Colors come from `CostPerKwhPalette` (P1/S9). No networking here.
//

import Charts
import SwiftUI

// MARK: - Trend line (web `LineChart` with a `costPerKwh` `Line`)

/// The cost-per-kWh trend line. One `LineMark` per sample (web `<Line>` with
/// `dataKey="costPerKwh"`), the CB-safe palette stroke (web `palette[2]`), the
/// currency Y axis, a thinned date X axis, and an interactive selection callout
/// that mirrors the web hover tooltip.
struct CostPerKwhLineChart: View {
    let points: [CostPerKwhPoint]
    let axisTicks: [String]
    let localize: (String, String) -> String
    let formatting: any CostPerKwhFormatting

    @State private var selectedDate: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The web `<Line name="$/kWh">` series label.
    private var rateLabel: String {
        localize("costAnalysis.charts.rateLabel", "$/kWh")
    }

    /// The X-axis value label (web `dataKey="date"`).
    private var dateLabel: String {
        localize("costAnalysis.charts.a11y.date", "Date")
    }

    private var selectedPoint: CostPerKwhPoint? {
        guard let selectedDate else { return nil }
        return points.first { $0.date == selectedDate }
    }

    private var chartSummary: String {
        CostPerKwhAccessibility.chartSummary(
            points,
            localize: localize,
            formatCurrency: { [formatting] value in formatting.formatCurrency(value) }
        )
    }

    var body: some View {
        chart
            .chartXSelection(value: $selectedDate)
            .chartLegend(.hidden)
            .frame(height: 260)
            .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.fastDuration), value: selectedDate)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: chartSummary))
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                LineMark(
                    x: .value(dateLabel, point.date),
                    y: .value(rateLabel, point.costPerKwh)
                )
                .foregroundStyle(CostPerKwhPalette.line)
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.monotone)
                .accessibilityLabel(Text(verbatim: CostPerKwhAccessibility.pointLabel(point)))
                .accessibilityValue(
                    Text(verbatim: CostPerKwhAccessibility.pointValue(point, formatCurrency: formatting.formatCurrency))
                )
            }

            if let selected = selectedPoint {
                RuleMark(x: .value(dateLabel, selected.date))
                    .foregroundStyle(Color.TS.textMuted.opacity(0.4))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .annotation(
                        position: .top,
                        alignment: .center,
                        spacing: 6,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        CostPerKwhSelectionCallout(point: selected, formatting: formatting)
                    }

                PointMark(
                    x: .value(dateLabel, selected.date),
                    y: .value(rateLabel, selected.costPerKwh)
                )
                .foregroundStyle(CostPerKwhPalette.line)
                .symbolSize(90)
                .accessibilityHidden(true)
            }
        }
        .chartXAxis {
            AxisMarks(values: axisTicks) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.15))
                AxisValueLabel {
                    if let label = value.as(String.self) {
                        Text(verbatim: label)
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
                    if let rate = value.as(Double.self) {
                        Text(verbatim: formatting.formatCurrency(rate, decimals: 2))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
    }
}

// MARK: - Selection callout (web `<Tooltip>`)

/// The floating readout shown above the selected vertex — the native parity of the
/// web Recharts `<Tooltip>`: the date category over the formatted rate.
struct CostPerKwhSelectionCallout: View {
    let point: CostPerKwhPoint
    let formatting: any CostPerKwhFormatting

    var body: some View {
        VStack(spacing: 2) {
            Text(verbatim: point.date)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: formatting.formatCurrency(point.costPerKwh, decimals: 2))
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
