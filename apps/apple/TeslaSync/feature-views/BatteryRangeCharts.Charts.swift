//
//  BatteryRangeCharts.Charts.swift
//  TeslaSync — P4 feature view · 0288 · BatteryRangeCharts (Apple)
//
//  The Battery Overview bar chart + the shared legend chip (the Drive Distance Trend chart lives
//  in BatteryRangeCharts.DriveChart.swift to keep both files within the file-length budget). This
//  is the native parity of the web Recharts `<BarChart data={batteryChartData}>` with one
//  `<Bar dataKey="value" fill={CHART_COLORS[0]}>` over a `[0,100]` y domain: two columns (Current,
//  Remaining) with a per-column tap tooltip (web `ChartTooltip`).
//
//  Colors come from the index-stable `TSChartPalette` (P1/S9), matching the web `CHART_COLORS`
//  order exactly. The chart carries one accessible summary so VoiceOver is not handed an opaque
//  image. No networking and no Tailwind ports live here.
//

import Charts
import SwiftUI

// MARK: - Legend chip (web `<Legend>`)

/// One legend entry: a colored swatch + the series name (pre-localized).
struct BatteryRangeChartsLegendChip: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
    }
}

// MARK: - 1. Battery bar chart (web `<BarChart data={batteryChartData}>`)

/// The Current-vs-Remaining battery bar chart — the native counterpart of the web Recharts
/// `BarChart` with one blue `<Bar dataKey="value">` over a `[0,100]` y domain. Tapping a column
/// reveals a value tooltip (web `ChartTooltip`); each column carries a per-bar VoiceOver value.
struct BatteryRangeChartsBatteryBarChart: View {
    let bars: [BatteryRangeChartsBatteryBar]

    @State private var selectedName: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Web `CHART_COLORS[0]` (the blue categorical series).
    private static var barColor: Color {
        TSChartPalette.color(at: 0)
    }

    private var selectedBar: BatteryRangeChartsBatteryBar? {
        guard let selectedName else { return nil }
        return bars.first { $0.name == selectedName }
    }

    private var nameAxisName: String {
        BatteryRangeChartsStrings.string("vehicles.detail.batteryOverview", "Battery Overview")
    }

    private var valueAxisName: String {
        BatteryRangeChartsStrings.string("common.battery", "Battery")
    }

    var body: some View {
        Chart {
            ForEach(bars) { bar in
                BarMark(
                    x: .value(nameAxisName, bar.name),
                    y: .value(valueAxisName, bar.value)
                )
                .foregroundStyle(Self.barColor)
                .cornerRadius(4)
                .accessibilityLabel(Text(verbatim: bar.name))
                .accessibilityValue(Text(verbatim: bar.display))
            }
            selectionRule
        }
        .chartXScale(domain: bars.map(\.name))
        .chartYScale(domain: 0 ... 100)
        .chartXSelection(value: $selectedName)
        .chartLegend(.hidden)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(height: 176)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: bars)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: chartSummary))
    }

    private var chartSummary: String {
        BatteryRangeChartsAccessibility.batteryChartSummary(
            bars: bars,
            localize: BatteryRangeChartsStrings.string
        )
    }

    @ChartContentBuilder
    private var selectionRule: some ChartContent {
        if let selectedBar {
            RuleMark(x: .value(nameAxisName, selectedBar.name))
                .foregroundStyle(Color.TS.border)
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    BatteryRangeChartsBarTooltip(bar: selectedBar)
                }
        }
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks { value in
            AxisValueLabel {
                if let label = value.as(String.self) {
                    Text(verbatim: label)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading, values: [0, 25, 50, 75, 100]) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let number = value.as(Int.self) {
                    Text(verbatim: "\(number)")
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }
}

// MARK: - Battery bar tooltip (web `ChartTooltip`)

/// The bar selection tooltip: the category label over its percent value — the native parity of
/// the web `ChartTooltip` payload.
struct BatteryRangeChartsBarTooltip: View {
    let bar: BatteryRangeChartsBatteryBar

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: bar.name)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle().fill(TSChartPalette.color(at: 0)).frame(width: 7, height: 7)
                Text(verbatim: bar.display)
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
        .frame(minWidth: 120, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
