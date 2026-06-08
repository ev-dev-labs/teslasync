//
//  RecentActivity.Charts.swift
//  TeslaSync — P4 feature view · 0130 · RecentActivity (Apple)
//
//  The battery-trend Swift Charts surface for "Recent Activity" — the native counterpart of the
//  web Recharts `AreaChartWrapper` single "Battery %" series (RecentActivity.tsx). An area + line
//  over the recent drives' end state-of-charge with a top-to-bottom gradient fill (web
//  `linearGradient` 0.3 → 0), a 0–100 % y axis, the original drive index as the x tick (web `i`),
//  and a selection tooltip (web `Tooltip`). Copy resolves through the P1/S10 facade; chrome is
//  token-driven (P1/S9). No networking lives here.
//

import Charts
import SwiftUI

// MARK: - Battery-trend area chart (web Recharts `AreaChartWrapper`)

/// The single-series battery-trend area chart. Tapping a point reveals its SoC tooltip; each
/// point carries a per-drive VoiceOver value, and the chart carries an overall a11y label.
struct RecentActivityBatteryChart: View {
    let points: [RecentActivityBatteryPoint]
    let locale: Locale

    @State private var selectedPosition: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var seriesColor: Color {
        Color.TS.chartSeriesBattery
    }

    private var socLabel: String {
        RecentActivityStrings.string("battery.axis", "Battery %")
    }

    private var driveLabel: String {
        RecentActivityStrings.string("battery.drive", "Drive")
    }

    private var selectedPoint: RecentActivityBatteryPoint? {
        guard let selectedPosition else { return nil }
        return points.first { $0.position == selectedPosition }
    }

    var body: some View {
        Chart {
            ForEach(points) { point in
                AreaMark(
                    x: .value(driveLabel, point.position),
                    y: .value(socLabel, point.value)
                )
                .foregroundStyle(fill)
                .interpolationMethod(.monotone)

                LineMark(
                    x: .value(driveLabel, point.position),
                    y: .value(socLabel, point.value)
                )
                .foregroundStyle(seriesColor)
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.monotone)
                .accessibilityLabel(Text(verbatim: point.label))
                .accessibilityValue(Text(verbatim: percent(point.value)))
            }

            if let selectedPoint {
                RuleMark(x: .value(driveLabel, selectedPoint.position))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        RecentActivityBatteryTooltip(point: selectedPoint, value: percent(selectedPoint.value))
                    }
            }
        }
        .chartYScale(domain: 0 ... 100)
        .chartXSelection(value: $selectedPosition)
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks(values: points.map(\.position)) { value in
                AxisValueLabel {
                    if let position = value.as(Int.self) {
                        Text(verbatim: labelForPosition(position))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: percent(number))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .frame(height: 180)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: points)
        .accessibilityLabel(
            RecentActivityStrings.text("battery.aria", "Battery level across recent drives")
        )
    }

    private var fill: LinearGradient {
        LinearGradient(
            colors: [seriesColor.opacity(0.3), seriesColor.opacity(0)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private func percent(_ value: Double) -> String {
        "\(RecentActivityFormat.int(value, locale: locale))\(RecentActivityFormat.percentSymbol)"
    }

    private func labelForPosition(_ position: Int) -> String {
        points.first { $0.position == position }?.label ?? String(position)
    }
}

// MARK: - Tooltip (web `Tooltip`)

/// The selection tooltip: the battery percentage for the tapped point, the native parity of the
/// web Recharts tooltip payload.
struct RecentActivityBatteryTooltip: View {
    let point: RecentActivityBatteryPoint
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            RecentActivityStrings.text("battery.axis", "Battery %")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle().fill(Color.TS.chartSeriesBattery).frame(width: 7, height: 7)
                Text(verbatim: value)
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
        .accessibilityElement(children: .combine)
    }
}
