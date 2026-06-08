//
//  TemperatureTrendChart.Chart.swift
//  TeslaSync — P4 feature view · 0162 · TemperatureTrendChart (Apple)
//
//  The Swift Charts surface for the "Temperature Trend" view, split out of
//  TemperatureTrendChart.Views.swift to keep each file focused (and under the 400-line
//  SwiftLint budget): the single-series line chart (web Recharts `LineChart` → native
//  `Chart { LineMark }`) with its Warm Zone / Freezing reference rules (web
//  `<ReferenceLine>` → `RuleMark`), the drive selection tooltip (web `ChartTooltip`),
//  and the display-unit Y axis. Copy resolves through the P1/S10 facade; chrome is
//  token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import Charts
import SwiftUI

// MARK: - Chart (web Recharts single-series `LineChart`)

/// The outside-temperature line chart — the native counterpart of the web Recharts
/// `LineChart` with one `outsideTemp` line and the two `<ReferenceLine>`s. One point
/// per drive; tapping a drive reveals a value tooltip (web `ChartTooltip`); each drive
/// carries a per-point VoiceOver value, and the Y axis carries the display-unit label.
struct TemperatureTrendLineChart: View {
    let projection: TemperatureTrendProjection
    let localeIdentifier: String

    @State private var selectedIndex: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var dateAxisName: String {
        TemperatureTrendStrings.string("drivetrain.col.date", "Date")
    }

    private var seriesName: String {
        TemperatureTrendStrings.string("drivetrain.outsideTemp", "Outside Temp")
    }

    private var selectedPoint: TemperatureTrendPoint? {
        guard let selectedIndex else { return nil }
        return projection.points.first { $0.index == selectedIndex && $0.outsideTemp != nil }
    }

    var body: some View {
        Chart {
            ForEach(projection.plottablePoints) { point in
                lineMark(for: point)
                pointMark(for: point)
            }
            thresholdRules
            selectionRule
        }
        .chartXScale(domain: projection.points.map(\.index))
        .chartXSelection(value: $selectedIndex)
        .chartLegend(.hidden)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .chartYAxisLabel(position: .leading, alignment: .center) {
            Text(verbatim: projection.unitSymbol)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(height: 280)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: projection)
        .accessibilityLabel(
            TemperatureTrendStrings.text(
                "drivetrain.tempHistory.aria",
                "Outside temperature trend line chart per recent drive"
            )
        )
    }

    @ChartContentBuilder
    private func lineMark(for point: TemperatureTrendPoint) -> some ChartContent {
        if let value = point.outsideTemp {
            LineMark(
                x: .value(dateAxisName, point.index),
                y: .value(seriesName, value)
            )
            .foregroundStyle(TemperatureTrendPalette.line)
            .interpolationMethod(.monotone)
        }
    }

    @ChartContentBuilder
    private func pointMark(for point: TemperatureTrendPoint) -> some ChartContent {
        if let value = point.outsideTemp {
            PointMark(
                x: .value(dateAxisName, point.index),
                y: .value(seriesName, value)
            )
            .foregroundStyle(TemperatureTrendPalette.line)
            .symbolSize(36)
            .accessibilityLabel(Text(verbatim: point.date))
            .accessibilityValue(Text(verbatim: pointValue(for: point)))
        }
    }

    @ChartContentBuilder
    private var thresholdRules: some ChartContent {
        ForEach(projection.thresholds) { threshold in
            RuleMark(y: .value(seriesName, threshold.value))
                .foregroundStyle(TemperatureTrendPalette.color(for: threshold.kind))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                .annotation(position: .top, alignment: .leading, spacing: 2) {
                    TemperatureTrendStrings.text(threshold.kind.labelKey, threshold.kind.labelFallback)
                        .font(Font.TS.label)
                        .foregroundStyle(TemperatureTrendPalette.color(for: threshold.kind))
                }
        }
    }

    @ChartContentBuilder
    private var selectionRule: some ChartContent {
        if let selectedPoint {
            RuleMark(x: .value(dateAxisName, selectedPoint.index))
                .foregroundStyle(Color.TS.border)
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    TemperatureTrendTooltip(
                        point: selectedPoint,
                        unitSymbol: projection.unitSymbol,
                        localeIdentifier: localeIdentifier
                    )
                }
        }
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: tickIndices) { value in
            AxisValueLabel {
                if let index = value.as(Int.self), let label = label(forIndex: index) {
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
                    Text(verbatim: TemperatureTrendFormat.decimal(number, localeIdentifier: localeIdentifier))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    /// A thinned set of x ticks (≤ 7) so the date labels stay legible while every drive
    /// is still plotted (Recharts auto-thins category ticks the same way).
    private var tickIndices: [Int] {
        let all = projection.points.map(\.index)
        guard all.count > 7 else { return all }
        let step = Int((Double(all.count) / 6).rounded(.up))
        guard step > 1 else { return all }
        var thinned = all.enumerated().filter { $0.offset.isMultiple(of: step) }.map(\.element)
        if let last = all.last, thinned.last != last { thinned.append(last) }
        return thinned
    }

    private func label(forIndex index: Int) -> String? {
        projection.points.first { $0.index == index }?.date
    }

    private func pointValue(for point: TemperatureTrendPoint) -> String {
        TemperatureTrendAccessibility.pointValue(
            point,
            unit: projection.unitSymbol,
            localize: TemperatureTrendStrings.string,
            localeIdentifier: localeIdentifier
        )
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the drive date over its outside-temperature value — the
/// native parity of the web `ChartTooltip` payload (`Outside Temp: N °unit`).
struct TemperatureTrendTooltip: View {
    let point: TemperatureTrendPoint
    let unitSymbol: String
    let localeIdentifier: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: point.date)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle().fill(TemperatureTrendPalette.line).frame(width: 7, height: 7)
                TemperatureTrendStrings.text("drivetrain.outsideTemp", "Outside Temp")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: TemperatureTrendFormat.temperature(
                    point.outsideTemp,
                    unit: unitSymbol,
                    localeIdentifier: localeIdentifier
                ))
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
        .frame(minWidth: 156, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
