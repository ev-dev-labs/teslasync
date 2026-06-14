//
//  BatteryRangeCharts.DriveChart.swift
//  TeslaSync — P4 feature view · 0288 · BatteryRangeCharts (Apple)
//
//  The Drive Distance Trend chart (split out of BatteryRangeCharts.Charts.swift to keep both
//  files within the file-length budget). The native counterpart of the web Recharts
//  `<AreaChart data={driveChartData}>` with two overlapping `<Area>`s — distance
//  (CHART_COLORS[0]) + duration (CHART_COLORS[1]) — its per-drive tooltip (web `ChartTooltip`),
//  and the "No drive data for chart" empty leaf (web `EmptyState`). Colors come from the
//  index-stable `TSChartPalette` (P1/S9); copy resolves through the P1/S10 facade. No networking
//  and no Tailwind ports live here.
//

import Charts
import SwiftUI

// MARK: - Drive trend chart (web `<AreaChart data={driveChartData}>`)

/// The recent-drives distance + duration area trace — the native counterpart of the web Recharts
/// `AreaChart` with two overlapping `<Area>`s. Distance (CHART_COLORS[0]) and duration
/// (CHART_COLORS[1]) draw `stacking: .unstacked` so they overlap from the shared baseline, each a
/// gradient area under a 2 pt stroke. A custom legend names the series; tapping reveals a
/// per-drive tooltip (web `ChartTooltip`).
struct BatteryRangeChartsDriveAreaChart: View {
    let points: [BatteryRangeChartsDrivePoint]
    let unitSymbol: String

    @State private var selectedOrder: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var distanceColor: Color {
        TSChartPalette.color(at: 0)
    }

    private var durationColor: Color {
        TSChartPalette.color(at: 1)
    }

    private var distanceLabel: String {
        let distance = BatteryRangeChartsStrings.string("common.distance", "Distance")
        return "\(distance) (\(unitSymbol))"
    }

    private var durationLabel: String {
        BatteryRangeChartsStrings.string("common.duration", "Duration")
    }

    private var labelsByOrder: [Int: String] {
        Dictionary(uniqueKeysWithValues: points.map { ($0.order, $0.dateLabel) })
    }

    private var selectedPoint: BatteryRangeChartsDrivePoint? {
        guard let selectedOrder else { return nil }
        return points.first { $0.order == selectedOrder }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            legend
            chart
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: chartSummary))
    }

    private var legend: some View {
        HStack(spacing: TSSpacing.md) {
            BatteryRangeChartsLegendChip(color: distanceColor, label: distanceLabel)
            BatteryRangeChartsLegendChip(color: durationColor, label: durationLabel)
        }
        .accessibilityHidden(true)
    }

    private var chart: some View {
        Chart {
            distanceMarks
            durationMarks
            selectionRule
        }
        .chartXScale(domain: xDomain)
        .chartXSelection(value: $selectedOrder)
        .chartLegend(.hidden)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(height: 208)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: points)
    }

    @ChartContentBuilder
    private var distanceMarks: some ChartContent {
        ForEach(points) { point in
            AreaMark(
                x: .value(orderAxisName, point.order),
                y: .value(distanceLabel, point.distance),
                series: .value(seriesAxisName, distanceLabel),
                stacking: .unstacked
            )
            .interpolationMethod(.monotone)
            .foregroundStyle(gradient(distanceColor))
        }
        ForEach(points) { point in
            LineMark(
                x: .value(orderAxisName, point.order),
                y: .value(distanceLabel, point.distance),
                series: .value(seriesAxisName, distanceLabel)
            )
            .interpolationMethod(.monotone)
            .lineStyle(StrokeStyle(lineWidth: 2))
            .foregroundStyle(distanceColor)
        }
    }

    @ChartContentBuilder
    private var durationMarks: some ChartContent {
        ForEach(points) { point in
            AreaMark(
                x: .value(orderAxisName, point.order),
                y: .value(durationLabel, point.duration),
                series: .value(seriesAxisName, durationLabel),
                stacking: .unstacked
            )
            .interpolationMethod(.monotone)
            .foregroundStyle(gradient(durationColor))
        }
        ForEach(points) { point in
            LineMark(
                x: .value(orderAxisName, point.order),
                y: .value(durationLabel, point.duration),
                series: .value(seriesAxisName, durationLabel)
            )
            .interpolationMethod(.monotone)
            .lineStyle(StrokeStyle(lineWidth: 2))
            .foregroundStyle(durationColor)
        }
    }

    @ChartContentBuilder
    private var selectionRule: some ChartContent {
        if let selectedPoint {
            RuleMark(x: .value(orderAxisName, selectedPoint.order))
                .foregroundStyle(Color.TS.border)
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    BatteryRangeChartsDriveTooltip(
                        point: selectedPoint,
                        unitSymbol: unitSymbol,
                        distanceColor: distanceColor,
                        durationColor: durationColor
                    )
                }
        }
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: points.map(\.order)) { value in
            AxisValueLabel {
                if let order = value.as(Int.self), let label = labelsByOrder[order] {
                    Text(verbatim: label)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: "\(Int(number))")
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private var xDomain: ClosedRange<Int> {
        let upper = max(points.count - 1, 1)
        return 0 ... upper
    }

    private var orderAxisName: String {
        BatteryRangeChartsStrings.string("vehicles.detail.driveTrend", "Drive Distance Trend")
    }

    private var seriesAxisName: String {
        BatteryRangeChartsStrings.string("vehicles.detail.driveTrend.series", "Series")
    }

    private var chartSummary: String {
        BatteryRangeChartsAccessibility.driveChartSummary(
            points: points,
            unitSymbol: unitSymbol,
            localize: BatteryRangeChartsStrings.string
        )
    }

    /// Area gradient (web `areaGradient`): a token tint fading to near-transparent.
    private func gradient(_ color: Color) -> LinearGradient {
        LinearGradient(
            colors: [color.opacity(0.28), color.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

// MARK: - Drive tooltip (web `ChartTooltip`)

/// The drive selection tooltip: the drive's date over its distance + duration values — the native
/// parity of the web `ChartTooltip` payload.
struct BatteryRangeChartsDriveTooltip: View {
    let point: BatteryRangeChartsDrivePoint
    let unitSymbol: String
    let distanceColor: Color
    let durationColor: Color

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: point.dateLabel)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            row(
                color: distanceColor,
                key: "common.distance",
                fallback: "Distance",
                value: "\(Int(point.distance)) \(unitSymbol)"
            )
            row(
                color: durationColor,
                key: "common.duration",
                fallback: "Duration",
                value: durationValue
            )
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(minWidth: 160, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var durationValue: String {
        let minutes = BatteryRangeChartsStrings.string("vehicles.detail.driveTrend.minutesNoun", "min")
        return "\(Int(point.duration)) \(minutes)"
    }

    private func row(color: Color, key: String, fallback: String, value: String) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Circle().fill(color).frame(width: 7, height: 7)
            BatteryRangeChartsStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: value)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
    }
}

// MARK: - Inner drive-empty leaf (web `<EmptyState icon={Route} message="No drive data for chart">`)

/// The Drive Distance Trend empty leaf shown when there are no drives — the native parity of the
/// web `EmptyState` (route glyph + "No drive data for chart"). Never a blank box.
struct BatteryRangeChartsDriveEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                BatteryRangeChartsStrings.text("vehicles.detail.noDriveData", "No drive data for chart")
            } icon: {
                Image(systemName: "road.lanes")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 208)
    }
}
