//
//  MotorHistoryCharts.Charts.swift
//  TeslaSync — P4 feature view · 0172 · MotorHistoryCharts (Apple)
//
//  The Swift Charts compositions for the "Motor History" surface: the power /
//  regen area chart (web Recharts `AreaChart` → `AreaMark` + `LineMark`) and the
//  shared front/rear dual-line chart reused by the torque and rpm histories (web
//  Recharts `LineChart` → `LineMark`), plus the shared time / value axes and the
//  selection helpers. Colors come from the design tokens (P1/S9); the legends,
//  tooltip and states live in MotorHistoryCharts.Views.swift. No networking here.
//

import Charts
import SwiftUI

// MARK: - Shared time formatter (web `useDateFormat().formatTime`)

/// The default short-time axis/tooltip label — the native parity of the web
/// `formatTime`. Injected so previews / tests can pin a deterministic format.
enum MotorHistoryTime {
    static let shortened: @Sendable (Date) -> String = { $0.formatted(date: .omitted, time: .shortened) }
}

/// The plotted point nearest a selected time (web hover → the row under the cursor).
func motorHistoryNearestPoint(
    _ points: [MotorHistoryChartsPoint],
    to date: Date
) -> MotorHistoryChartsPoint? {
    points.min { lhs, rhs in
        abs(lhs.time.timeIntervalSince(date)) < abs(rhs.time.timeIntervalSince(date))
    }
}

/// A safe x-domain for a time series, widening a degenerate single-sample range so
/// the axis still renders (mirrors the MotorHistoryWidget convention).
func motorHistoryXDomain(_ points: [MotorHistoryChartsPoint]) -> ClosedRange<Date> {
    guard let first = points.first?.time, let last = points.last?.time else {
        let now = Date()
        return now.addingTimeInterval(-60) ... now
    }
    guard first < last else {
        return first.addingTimeInterval(-60) ... last.addingTimeInterval(60)
    }
    return first ... last
}

// MARK: - Power chart (web Recharts `AreaChart`: power + regen)

/// The motor power-over-time area chart — the native counterpart of the web
/// Recharts `AreaChart` with a cyan `power` area and a green `regen` area, each a
/// gradient fill under a solid stroke. The legend is interactive (web
/// `ChartLegend`); selecting a time reveals the value tooltip (web `ChartTooltip`).
struct MotorPowerAreaChart: View {
    let points: [MotorHistoryChartsPoint]
    let hidden: Set<String>
    let onToggle: (String) -> Void
    var timeLabel: (Date) -> String = MotorHistoryTime.shortened

    @State private var selected: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// power → cyan (chartSeriesRegen == web #06b6d4); regen → green
    /// (chartSeriesBattery == web #22c55e).
    private static let powerColor = Color.TS.chartSeriesRegen
    private static let regenColor = Color.TS.chartSeriesBattery

    private var unit: String {
        MotorHistoryChartsStrings.string("dynamics.motorHistory.powerUnit", "kW")
    }

    private var legendItems: [MotorHistoryLegendItem] {
        [
            MotorHistoryLegendItem(
                id: MotorHistoryChartsSeries.power,
                name: MotorHistoryChartsStrings.string("dynamics.power", "Power"),
                color: Self.powerColor
            ),
            MotorHistoryLegendItem(
                id: MotorHistoryChartsSeries.regen,
                name: MotorHistoryChartsStrings.string("dynamics.regen", "Regen"),
                color: Self.regenColor
            )
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            MotorHistoryChartsLegend(items: legendItems, hidden: hidden, onToggle: onToggle)
            chart
        }
    }

    private var chart: some View {
        Chart {
            if !hidden.contains(MotorHistoryChartsSeries.power) {
                areaSeries(\.powerKw, name: legendItems[0].name, color: Self.powerColor)
            }
            if !hidden.contains(MotorHistoryChartsSeries.regen) {
                areaSeries(\.regenKw, name: legendItems[1].name, color: Self.regenColor)
            }
            selectionRule
        }
        .chartXScale(domain: motorHistoryXDomain(points))
        .chartXSelection(value: $selected)
        .chartLegend(.hidden)
        .chartXAxis { timeAxis(timeLabel) }
        .chartYAxis { valueAxis(unit: unit) }
        .frame(height: 220)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: points)
        .accessibilityLabel(
            MotorHistoryChartsStrings.text(
                "dynamics.powerOverTime.aria",
                "Motor power and regen over time area chart"
            )
        )
        .accessibilityValue(Text(verbatim: accessibilityValue))
    }

    private func areaSeries(
        _ key: KeyPath<MotorHistoryChartsPoint, Double?>,
        name: String,
        color: Color
    ) -> some ChartContent {
        ForEach(points.filter { $0[keyPath: key] != nil }) { point in
            let value = point[keyPath: key] ?? 0
            AreaMark(
                x: .value("time", point.time),
                y: .value(name, value)
            )
            .foregroundStyle(
                LinearGradient(
                    colors: [color.opacity(0.35), color.opacity(0.02)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .interpolationMethod(.monotone)

            LineMark(
                x: .value("time", point.time),
                y: .value(name, value)
            )
            .foregroundStyle(color)
            .lineStyle(StrokeStyle(lineWidth: 2))
            .interpolationMethod(.monotone)
        }
    }

    @ChartContentBuilder
    private var selectionRule: some ChartContent {
        if let selected, let point = motorHistoryNearestPoint(points, to: selected) {
            RuleMark(x: .value("time", point.time))
                .foregroundStyle(Color.TS.border)
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    MotorHistoryChartsTooltip(title: timeLabel(point.time), rows: tooltipRows(point))
                }
        }
    }

    private func tooltipRows(_ point: MotorHistoryChartsPoint) -> [MotorHistoryTooltipRow] {
        var rows: [MotorHistoryTooltipRow] = []
        if !hidden.contains(MotorHistoryChartsSeries.power), let power = point.powerKw, power.isFinite {
            rows.append(.init(
                id: MotorHistoryChartsSeries.power,
                name: legendItems[0].name,
                color: Self.powerColor,
                value: "\(MotorHistoryChartsFormat.decimal(power, fractionDigits: 1)) \(unit)"
            ))
        }
        if !hidden.contains(MotorHistoryChartsSeries.regen), let regen = point.regenKw, regen.isFinite {
            rows.append(.init(
                id: MotorHistoryChartsSeries.regen,
                name: legendItems[1].name,
                color: Self.regenColor,
                value: "\(MotorHistoryChartsFormat.decimal(regen, fractionDigits: 1)) \(unit)"
            ))
        }
        return rows
    }

    private var accessibilityValue: String {
        MotorHistoryChartsAccessibility.chartSummary(
            title: MotorHistoryChartsStrings.string("dynamics.powerOverTime", "Motor Power Over Time"),
            series: [
                (legendItems[0].name, MotorHistoryChartsProjection(points: points).values(\.powerKw)),
                (legendItems[1].name, MotorHistoryChartsProjection(points: points).values(\.regenKw))
            ],
            unit: unit,
            localize: MotorHistoryChartsStrings.string
        )
    }
}

// MARK: - Dual-line chart (web Recharts `LineChart`: front + rear)

/// One line series for the dual-line chart (torque / rpm front & rear).
struct MotorLineSeries {
    let id: String
    let name: String
    let color: Color
    let key: KeyPath<MotorHistoryChartsPoint, Double?>
}

/// The shared front/rear dual-line chart — the native counterpart of the web
/// Recharts `LineChart` used for both the torque and the rpm histories (identical
/// composition, different series + unit). A static legend (web `Legend`) sits below
/// the plot; selecting a time reveals the value tooltip (web `ChartTooltip`).
struct MotorDualLineChart: View {
    let points: [MotorHistoryChartsPoint]
    let front: MotorLineSeries
    let rear: MotorLineSeries
    let unit: String
    let fractionDigits: Int
    let ariaKey: String
    let ariaFallback: String
    let titleKey: String
    let titleFallback: String
    var timeLabel: (Date) -> String = MotorHistoryTime.shortened

    @State private var selected: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var series: [MotorLineSeries] {
        [front, rear]
    }

    private var legendItems: [MotorHistoryLegendItem] {
        series.map { MotorHistoryLegendItem(id: $0.id, name: $0.name, color: $0.color) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            chart
            MotorHistoryChartsLegend(items: legendItems)
        }
    }

    private var chart: some View {
        Chart {
            ForEach(series, id: \.id) { line in
                lineSeries(line)
            }
            selectionRule
        }
        .chartXScale(domain: motorHistoryXDomain(points))
        .chartXSelection(value: $selected)
        .chartLegend(.hidden)
        .chartXAxis { timeAxis(timeLabel) }
        .chartYAxis { valueAxis(unit: unit) }
        .frame(height: 220)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: points)
        .accessibilityLabel(MotorHistoryChartsStrings.text(ariaKey, ariaFallback))
        .accessibilityValue(Text(verbatim: accessibilityValue))
    }

    private func lineSeries(_ line: MotorLineSeries) -> some ChartContent {
        ForEach(points.filter { $0[keyPath: line.key] != nil }) { point in
            LineMark(
                x: .value("time", point.time),
                y: .value(line.name, point[keyPath: line.key] ?? 0)
            )
            .foregroundStyle(line.color)
            .lineStyle(StrokeStyle(lineWidth: 2))
            .interpolationMethod(.monotone)
        }
    }

    @ChartContentBuilder
    private var selectionRule: some ChartContent {
        if let selected, let point = motorHistoryNearestPoint(points, to: selected) {
            RuleMark(x: .value("time", point.time))
                .foregroundStyle(Color.TS.border)
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    MotorHistoryChartsTooltip(title: timeLabel(point.time), rows: tooltipRows(point))
                }
        }
    }

    private func tooltipRows(_ point: MotorHistoryChartsPoint) -> [MotorHistoryTooltipRow] {
        series.compactMap { line in
            guard let value = point[keyPath: line.key], value.isFinite else { return nil }
            return MotorHistoryTooltipRow(
                id: line.id,
                name: line.name,
                color: line.color,
                value: "\(MotorHistoryChartsFormat.decimal(value, fractionDigits: fractionDigits)) \(unit)"
            )
        }
    }

    private var accessibilityValue: String {
        let projection = MotorHistoryChartsProjection(points: points)
        return MotorHistoryChartsAccessibility.chartSummary(
            title: MotorHistoryChartsStrings.string(titleKey, titleFallback),
            series: series.map { ($0.name, projection.values($0.key)) },
            unit: unit,
            localize: MotorHistoryChartsStrings.string
        )
    }
}

// MARK: - Shared axes (web Recharts `XAxis` / `YAxis`)

/// The time X axis (web `XAxis dataKey="time"`), labels via the injected formatter.
@AxisContentBuilder
func timeAxis(_ label: @escaping (Date) -> String) -> some AxisContent {
    AxisMarks(values: .automatic(desiredCount: 4)) { value in
        AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
        AxisValueLabel {
            if let date = value.as(Date.self) {
                Text(verbatim: label(date))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}

/// The leading value Y axis with the series unit suffix (web `YAxis unit=" kW"`).
@AxisContentBuilder
func valueAxis(unit: String) -> some AxisContent {
    AxisMarks(position: .leading) { value in
        AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
        AxisValueLabel {
            if let number = value.as(Double.self) {
                Text(verbatim: "\(MotorHistoryChartsFormat.decimal(number, fractionDigits: 0)) \(unit)")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}
