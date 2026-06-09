//
//  BatteryDegradationTrendWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0012 · BatteryDegradationTrendWidget (Apple)
//
//  Presentation pieces for the surface: the SoH / Degradation / Cycles stat row
//  (web `WidgetChartSummary` stat header) and the Swift Charts gradient area
//  chart (web Recharts `AreaChart` of `health` with the 80% reference line).
//  Pure presentation — they receive the projection + layout flags and render,
//  with no data access of their own. Colors come from the design tokens.
//

import Charts
import SwiftUI

// MARK: - Stat summary row (web `WidgetChartSummary` stat header)

/// One labelled metric in the summary row (web `ChartSummaryStat`). `value` is
/// pre-formatted; `unit` is an optional trailing unit chip (e.g. "/mo").
public struct BatteryDegradationStat: Identifiable, Equatable {
    public let id: String
    public let label: String
    public let value: String
    public let unit: String?

    public init(id: String, label: String, value: String, unit: String? = nil) {
        self.id = id
        self.label = label
        self.value = value
        self.unit = unit
    }

    /// The flattened "label value unit" string spoken by VoiceOver.
    public var accessibilityText: String {
        [label, value, unit].compactMap(\.self).joined(separator: " ")
    }
}

/// The horizontal stat header (web grid/flex of `label` + `value``unit`). Left
/// aligned, monospaced values so columns line up as data ticks.
struct BatteryDegradationStatRow: View {
    let stats: [BatteryDegradationStat]

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            ForEach(stats) { stat in
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: stat.label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                    HStack(alignment: .firstTextBaseline, spacing: 2) {
                        Text(verbatim: stat.value)
                            .font(Font.TS.panel)
                            .fontWeight(.semibold)
                            .monospacedDigit()
                            .foregroundStyle(Color.TS.textPrimary)
                            .lineLimit(1)
                        if let unit = stat.unit {
                            Text(verbatim: unit)
                                .font(Font.TS.caption)
                                .foregroundStyle(Color.TS.textMuted)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: stat.accessibilityText))
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Area chart (web Recharts `AreaChart` → Swift Charts)

/// The gradient-filled state-of-health area chart. Plots health % over the trend
/// months, draws the 80% warranty reference rule (web `ReferenceLine y={80}`),
/// frames the y axis at `dataMin − 2 … 100`, formats ticks as whole percents, and
/// offers tap-to-inspect with per-point VoiceOver values. Honors Reduce Motion.
struct BatteryDegradationTrendChart: View {
    let projection: BatteryDegradationProjection

    @State private var selectedMonth: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var seriesColor: Color {
        Color.TS.chartSeriesBattery
    }

    private var areaGradient: LinearGradient {
        LinearGradient(
            colors: [seriesColor.opacity(0.35), seriesColor.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var labelByMonth: [String: String] {
        Dictionary(
            projection.points.map { ($0.month, $0.monthLabel) },
            uniquingKeysWith: { first, _ in first }
        )
    }

    private var selectedPoint: DegradationTrendPoint? {
        guard let selectedMonth else { return nil }
        return projection.points.first { $0.month == selectedMonth }
    }

    private var healthLabel: String {
        BatteryDegradationTrendStrings.string("widget.batteryDegradationTrend.healthPct", "Health %")
    }

    private var monthLabel: String {
        BatteryDegradationTrendStrings.string("widget.batteryDegradationTrend.month", "Month")
    }

    var body: some View {
        Chart {
            RuleMark(y: .value(thresholdLabel, BatteryDegradationProjection.healthThreshold))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                .foregroundStyle(Color.TS.statusDanger.opacity(0.4))
                .annotation(position: .top, alignment: .trailing, spacing: 1) {
                    Text(verbatim: BatteryDegradationTrendFormat.axisPercent(
                        BatteryDegradationProjection.healthThreshold
                    ))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.statusDanger.opacity(0.7))
                }

            ForEach(projection.points) { point in
                AreaMark(
                    x: .value(monthLabel, point.month),
                    y: .value(healthLabel, point.health)
                )
                .foregroundStyle(areaGradient)
                .interpolationMethod(.monotone)
                .accessibilityLabel(Text(verbatim: point.monthLabel))
                .accessibilityValue(Text(verbatim: BatteryDegradationTrendAccessibility.pointLabel(point)))

                LineMark(
                    x: .value(monthLabel, point.month),
                    y: .value(healthLabel, point.health)
                )
                .foregroundStyle(seriesColor)
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.monotone)
            }

            if let selectedPoint {
                RuleMark(x: .value(monthLabel, selectedPoint.month))
                    .foregroundStyle(Color.TS.border)
                    .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        tooltip(for: selectedPoint)
                    }
            }
        }
        .chartXScale(domain: projection.points.map(\.month))
        .chartYScale(domain: projection.healthFloor ... 100)
        .chartXSelection(value: $selectedMonth)
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel {
                    if let raw = value.as(String.self) {
                        Text(verbatim: labelByMonth[raw] ?? raw)
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
                        Text(verbatim: BatteryDegradationTrendFormat.axisPercent(number))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: projection.points)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(BatteryDegradationTrendStrings.text(
            "widget.batteryDegradationTrend.chartA11y",
            "Battery state-of-health trend over recent months"
        ))
        .accessibilityValue(Text(verbatim: BatteryDegradationTrendAccessibility.summary(for: projection)))
    }

    private var thresholdLabel: String {
        BatteryDegradationTrendStrings.string("widget.batteryDegradationTrend.threshold", "Threshold")
    }

    private func tooltip(for point: DegradationTrendPoint) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: point.monthLabel)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: BatteryDegradationTrendFormat.healthValue(point.health))
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
}

// MARK: - "More data needed" empty-trend slot (web single-point branch)

/// The chart-slot fallback shown when there is at most one trend point (web
/// `chartData.length > 1 ? <AreaChart…> : <p>More data needed for trend</p>`).
struct BatteryDegradationTrendNeedsMore: View {
    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "chart.line.uptrend.xyaxis")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            BatteryDegradationTrendStrings.text(
                "widget.batteryDegradationTrend.needMoreData",
                "More data needed for trend"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
