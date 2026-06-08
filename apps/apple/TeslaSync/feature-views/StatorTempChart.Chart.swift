//
//  StatorTempChart.Chart.swift
//  TeslaSync — P4 feature view · 0159 · StatorTempChart (Apple)
//
//  The Swift Charts chart for the StatorTempChart surface — the native counterpart of the web
//  Recharts three-series `LineChart` with its two Normal / Warm `<ReferenceLine>`s and the
//  selection tooltip (web `ChartTooltip`) — plus the series / threshold color-token mappings and
//  the unit-suffixed series naming shared with the legend. Split out of StatorTempChart.Views.swift
//  so each file stays within the house length budget. Token-driven (P1/S9); copy via the P1/S10
//  facade. No networking lives here.
//

import Charts
import SwiftUI

// MARK: - Series / threshold color → token (web hex stroke → P1/S9 token)

extension StatorSeriesColor {
    /// Maps the web `<Line stroke>` hex to the matching brand chart-series token (red #ef4444 →
    /// temperature, purple #a855f7 → power, cyan #06b6d4 → regen).
    var color: Color {
        switch self {
        case .temperature: Color.TS.chartSeriesTemperature
        case .power: Color.TS.chartSeriesPower
        case .regen: Color.TS.chartSeriesRegen
        }
    }
}

extension StatorThresholdTone {
    /// Maps the web reference-line `stroke` to a status token (green #4ade80 → success, amber
    /// #fbbf24 → warning).
    var color: Color {
        switch self {
        case .normal: Color.TS.statusSuccess
        case .warm: Color.TS.statusWarning
        }
    }
}

// MARK: - Localized series naming (web `<Line name>` + unit suffix)

/// Shared naming helpers so the legend swatch, the chart color scale, and the tooltip always agree
/// on a series' label.
enum StatorTempNaming {
    /// The full line name with the display-unit suffix (web `${t('drivetrain.statorTemp')}
    /// (${tempUnit})`).
    static func fullName(_ series: StatorSeries, unit: String) -> String {
        "\(StatorTempStrings.string(series.nameKey, series.nameFallback)) (\(unit))"
    }

    /// The compact column label (web `dataColumns` label, e.g. "Stator").
    static func shortName(_ series: StatorSeries) -> String {
        StatorTempStrings.string(series.shortKey, series.shortFallback)
    }
}

// MARK: - Chart (web Recharts three-series `LineChart` + two `<ReferenceLine>`s)

/// The three-series line chart — the native counterpart of the web Recharts `LineChart` with the
/// `stator` / `statorRel` / `statorRer` lines plus the Normal / Warm `<ReferenceLine>`s. One row
/// per present `(snapshot, series)` (web `connectNulls`); tapping a snapshot reveals a value
/// tooltip (web `ChartTooltip`); the Y axis carries the temperature scale and the X axis a thinned
/// set of time labels (web `formatTime`).
struct StatorTempLineChart: View {
    let points: [StatorTempPoint]
    let rows: [StatorTempRow]
    let thresholds: [StatorThresholdLine]
    let unitSymbol: String
    let localeIdentifier: String

    @State private var selectedIndex: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var timeAxisName: String {
        StatorTempStrings.string("drivetrain.col.time", "Time")
    }

    private var tempAxisName: String {
        StatorTempStrings.string("drivetrain.statorTemp", "Stator Temp")
    }

    private var selectedPoint: StatorTempPoint? {
        guard let selectedIndex else { return nil }
        return points.first { $0.index == selectedIndex }
    }

    private var tickIndices: [Int] {
        StatorTempProjector.axisTickIndices(pointCount: points.count)
    }

    var body: some View {
        Chart {
            ForEach(rows) { row in
                LineMark(
                    x: .value(timeAxisName, row.index),
                    y: .value(tempAxisName, row.value)
                )
                .foregroundStyle(by: .value(tempAxisName, StatorTempNaming.fullName(row.series, unit: unitSymbol)))
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .accessibilityLabel(Text(verbatim: rowAccessibilityLabel(row)))
                .accessibilityValue(Text(verbatim: rowAccessibilityValue(row)))
            }

            ForEach(thresholds) { line in
                RuleMark(y: .value(tempAxisName, line.value))
                    .foregroundStyle(line.threshold.tone.color.opacity(0.55))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    .annotation(position: .trailing, alignment: .leading, spacing: TSSpacing.xs) {
                        Text(verbatim: StatorTempStrings.string(line.threshold.labelKey, line.threshold.labelFallback))
                            .font(Font.TS.label)
                            .foregroundStyle(line.threshold.tone.color)
                            .accessibilityHidden(true)
                    }
            }

            if let selectedPoint {
                RuleMark(x: .value(timeAxisName, selectedPoint.index))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        StatorTempTooltip(
                            point: selectedPoint,
                            unitSymbol: unitSymbol,
                            localeIdentifier: localeIdentifier
                        )
                    }
            }
        }
        .chartForegroundStyleScale(domain: seriesDomain, range: seriesRange)
        .chartXSelection(value: $selectedIndex)
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks(values: tickIndices) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let index = value.as(Int.self) {
                        Text(verbatim: labelForIndex(index))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: StatorTempFormat.decimal(number, localeIdentifier: localeIdentifier))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxisLabel(position: .leading, alignment: .center) {
            Text(verbatim: "\(tempAxisName) (\(unitSymbol))")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(height: 280)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: rows)
        .accessibilityLabel(
            StatorTempStrings.text(
                "drivetrain.statorTempHistory.aria",
                "Front, rear-left and rear-right motor stator temperature history line chart"
            )
        )
    }

    private var seriesDomain: [String] {
        StatorSeries.ordered.map { StatorTempNaming.fullName($0, unit: unitSymbol) }
    }

    private var seriesRange: [Color] {
        StatorSeries.ordered.map(\.color.color)
    }

    private func labelForIndex(_ index: Int) -> String {
        points.first { $0.index == index }?.timeLabel ?? ""
    }

    private func rowAccessibilityLabel(_ row: StatorTempRow) -> String {
        let time = row.timeLabel.isEmpty ? timeAxisName : row.timeLabel
        return "\(StatorTempNaming.fullName(row.series, unit: unitSymbol)), \(time)"
    }

    private func rowAccessibilityValue(_ row: StatorTempRow) -> String {
        StatorTempFormat.temperature(row.value, unit: unitSymbol, localeIdentifier: localeIdentifier)
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the snapshot time over each present series' temperature, the native
/// parity of the web `ChartTooltip` payload list. Absent readings are omitted (web gap).
struct StatorTempTooltip: View {
    let point: StatorTempPoint
    let unitSymbol: String
    let localeIdentifier: String

    private var timeHeader: String {
        point.timeLabel.isEmpty
            ? StatorTempStrings.string("drivetrain.col.time", "Time")
            : point.timeLabel
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: timeHeader)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(StatorSeries.ordered) { series in
                if let value = point.value(for: series) {
                    HStack(spacing: TSSpacing.sm) {
                        Circle().fill(series.color.color).frame(width: 7, height: 7)
                        Text(verbatim: StatorTempNaming.shortName(series))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                        Spacer(minLength: TSSpacing.md)
                        Text(verbatim: StatorTempFormat.temperature(
                            value,
                            unit: unitSymbol,
                            localeIdentifier: localeIdentifier
                        ))
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                    }
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
        .frame(minWidth: 168, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
