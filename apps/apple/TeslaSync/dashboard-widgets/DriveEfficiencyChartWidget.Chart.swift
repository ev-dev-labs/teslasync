//
//  DriveEfficiencyChartWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0038 · DriveEfficiencyChartWidget (Apple)
//
//  The Swift Charts area chart — the native counterpart of the web Recharts
//  `AreaChart` in features/dashboard/widgets/DriveEfficiencyChartWidget.tsx. Plots
//  the daily Wh/distance average as a gradient area, overlays the 7-day rolling
//  average as a dashed line, marks the overall average with a reference rule, and
//  carries a custom two-item legend, a tap-to-inspect tooltip, and per-point
//  VoiceOver values.
//

import Charts
import SwiftUI

/// Daily drive-efficiency area chart with a rolling-average overlay. The daily
/// series uses the brand accent (web `palette.series[0]`); the rolling average +
/// the overall-average reference rule use amber (web `#f59e0b`). The y-domain is
/// padded ±20 like the web `domain={['dataMin - 20', 'dataMax + 20']}`, and the
/// x ticks are strided so a 30-day axis stays legible.
struct DriveEfficiencyChart: View {
    let projection: DriveEfficiencyProjection
    /// Wide widgets (cols ≥ 3) get more x ticks (web `tick = isWide ? … : …`).
    var isWide: Bool = false

    @State private var selectedIndex: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var dailyColor: Color {
        Color.TS.accent
    }

    private var rollingColor: Color {
        Color.TS.statusWarning
    }

    private var dailyLabel: String {
        DriveEfficiencyChartStrings.string("widget.driveEfficiencyChart.daily", "Daily")
    }

    private var rollingLabel: String {
        DriveEfficiencyChartStrings.string("widget.driveEfficiencyChart.rolling", "7-day avg")
    }

    private var dailyGradient: LinearGradient {
        LinearGradient(
            colors: [dailyColor.opacity(0.35), dailyColor.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var rollingPoints: [DriveEfficiencyPoint] {
        projection.points.filter { $0.rollingAvg != nil }
    }

    private var labelByIndex: [Int: String] {
        Dictionary(projection.points.map { ($0.index, $0.label) }, uniquingKeysWith: { first, _ in first })
    }

    private var selectedPoint: DriveEfficiencyPoint? {
        guard let selectedIndex else { return nil }
        return projection.points.first { $0.index == selectedIndex }
    }

    /// Padded y-domain (web `['dataMin - 20', 'dataMax + 20']`). Falls back to a
    /// sensible band when the series is degenerate.
    private var yDomain: ClosedRange<Double> {
        guard let minimum = projection.seriesMinimum, let maximum = projection.seriesMaximum else {
            return 0 ... 1
        }
        let lower = max(0, minimum - 20)
        let upper = maximum + 20
        return lower < upper ? lower ... upper : lower ... (lower + 1)
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            chart
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            legend
        }
    }

    private var chart: some View {
        Chart {
            ForEach(projection.points) { point in
                AreaMark(
                    x: .value("day", point.index),
                    y: .value(dailyLabel, point.efficiency)
                )
                .foregroundStyle(dailyGradient)
                .interpolationMethod(.monotone)
            }

            ForEach(projection.points) { point in
                LineMark(
                    x: .value("day", point.index),
                    y: .value(dailyLabel, point.efficiency),
                    series: .value("series", dailyLabel)
                )
                .foregroundStyle(dailyColor)
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.monotone)
            }

            ForEach(rollingPoints) { point in
                LineMark(
                    x: .value("day", point.index),
                    y: .value(rollingLabel, point.rollingAvg ?? 0),
                    series: .value("series", rollingLabel)
                )
                .foregroundStyle(rollingColor)
                .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 2]))
                .interpolationMethod(.monotone)
            }

            if let overallAvg = projection.overallAvg {
                RuleMark(y: .value("average", overallAvg))
                    .foregroundStyle(rollingColor.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
            }

            if let selectedPoint {
                RuleMark(x: .value("day", selectedPoint.index))
                    .foregroundStyle(Color.TS.border)
                    .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        tooltip(for: selectedPoint)
                    }
            }
        }
        .chartYScale(domain: yDomain)
        .chartXSelection(value: $selectedIndex)
        .chartXAxis {
            AxisMarks(values: xTicks()) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let raw = value.as(Int.self) {
                        Text(verbatim: labelByIndex[raw] ?? "")
                            .font(isWide ? Font.TS.caption : Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let raw = value.as(Double.self) {
                        Text(verbatim: DriveEfficiencyFormat.int(raw))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: projection)
        .accessibilityElement()
        .accessibilityLabel(DriveEfficiencyChartStrings.text(
            "widget.driveEfficiencyChart.chartA11y",
            "Drive efficiency over the last 30 days with a 7-day rolling average"
        ))
        .accessibilityValue(Text(verbatim: DriveEfficiencyChartAccessibility.summary(for: projection)))
    }

    // MARK: Legend (web custom legend row)

    private var legend: some View {
        HStack(spacing: TSSpacing.md) {
            legendItem(color: dailyColor, label: dailyLabel)
            legendItem(color: rollingColor, label: rollingLabel)
        }
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }

    private func legendItem(color: Color, label: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
        }
    }

    // MARK: Tooltip (web Recharts `<ChartTooltip />`)

    private func tooltip(for point: DriveEfficiencyPoint) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: point.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Circle().fill(dailyColor).frame(width: 6, height: 6)
                Text(verbatim: "\(DriveEfficiencyFormat.int(point.efficiency)) \(projection.efficiencyUnit)")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
            if let rolling = point.rollingAvg {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Circle().fill(rollingColor).frame(width: 6, height: 6)
                    Text(verbatim: "\(DriveEfficiencyFormat.int(rolling)) \(projection.efficiencyUnit)")
                        .font(Font.TS.caption)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
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

    /// Up-to-`maxTicks` evenly-strided x positions (keeps endpoints), so the
    /// 30-day axis stays legible (web auto-skips ticks).
    private func xTicks() -> [Int] {
        let points = projection.points
        let maxTicks = isWide ? 6 : 4
        guard points.count > maxTicks else { return points.map(\.index) }
        let step = Double(points.count - 1) / Double(maxTicks - 1)
        return (0 ..< maxTicks).map { points[Int((Double($0) * step).rounded())].index }
    }
}
