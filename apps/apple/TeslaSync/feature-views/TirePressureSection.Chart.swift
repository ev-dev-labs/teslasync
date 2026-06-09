//
//  TirePressureSection.Chart.swift
//  TeslaSync — P4 feature view · 0151 · TirePressureSection (Apple)
//
//  The four-wheel Swift Charts line chart + its selection tooltip for the drive-detail
//  "Tire Pressure During Drive" surface (web Recharts `LineChart` + `ChartTooltip`).
//  Split out of TirePressureSection.Views.swift to keep each file within the lint
//  budget. Chrome is token-driven (P1/S9); copy resolves through the P1/S10 facade. No
//  networking lives here.
//

import Charts
import SwiftUI

// MARK: - Line chart (web Recharts four-wheel `LineChart`)

/// The four-wheel tire-pressure line chart — the native counterpart of the web Recharts
/// `LineChart` with the FL/FR/RL/RR lines. Plots one `LineMark` per present sample per
/// present wheel; tapping reveals a reference line + value tooltip (web `ChartTooltip`).
/// The dense per-sample trace carries no data table (web `chart-a11y:no-table`); the
/// chart's VoiceOver summary + the stat tiles above carry the spoken values.
struct TPSectionLineChart: View {
    let projection: TPSectionProjection
    let locale: Locale
    let summary: String

    @State private var selectedIndex: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var timeLabel: String {
        TPSectionStrings.string("driveDetail.time", "Time")
    }

    private var pressureLabel: String {
        TPSectionStrings.string("driveDetail.pressure", "Pressure")
    }

    private var wheelLabel: String {
        TPSectionStrings.string("driveDetail.wheel", "Wheel")
    }

    private var lastIndex: Int {
        max(0, projection.pointCount - 1)
    }

    private var selectedPoint: TPSectionPoint? {
        guard let selectedIndex else { return nil }
        return projection.points.first { $0.index == selectedIndex }
    }

    var body: some View {
        Chart {
            ForEach(projection.presentWheels) { wheel in
                ForEach(projection.points) { point in
                    if let value = point.value(for: wheel) {
                        LineMark(
                            x: .value(timeLabel, point.index),
                            y: .value(pressureLabel, value)
                        )
                        .foregroundStyle(by: .value(wheelLabel, wheel.rawValue))
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 2))
                    }
                }
            }

            if let selectedPoint {
                RuleMark(x: .value(timeLabel, selectedPoint.index))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        TPSectionTooltip(point: selectedPoint, projection: projection, locale: locale)
                    }
            }
        }
        .chartForegroundStyleScale(domain: wheelDomain, range: wheelRange)
        .chartLegend(.hidden)
        .chartXScale(domain: 0 ... max(1, lastIndex))
        .chartXSelection(value: $selectedIndex)
        .chartXAxis {
            AxisMarks(values: axisIndices) { value in
                AxisValueLabel {
                    if let index = value.as(Int.self) {
                        Text(verbatim: timeText(at: index))
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
                        Text(verbatim: TPSectionFormat.number(
                            number,
                            decimals: 0,
                            localeIdentifier: locale.identifier
                        ))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .frame(height: 220)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: projection.points)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            TPSectionStrings.text(
                "driveDetail.tirePressure.aria",
                "Front and rear tire pressure lines over the drive timeline"
            )
        )
        .accessibilityValue(Text(verbatim: summary))
    }

    private var wheelDomain: [String] {
        projection.presentWheels.map(\.rawValue)
    }

    private var wheelRange: [Color] {
        projection.presentWheels.map(TPSectionPalette.color)
    }

    /// Web `interval="preserveStartEnd"`: label only the first + last samples.
    private var axisIndices: [Int] {
        lastIndex > 0 ? [0, lastIndex] : [0]
    }

    private func timeText(at index: Int) -> String {
        projection.points.first { $0.index == index }?.time ?? ""
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the sample's time over each present wheel's converted value —
/// the native parity of the web `ChartTooltip` payload list.
struct TPSectionTooltip: View {
    let point: TPSectionPoint
    let projection: TPSectionProjection
    let locale: Locale

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: point.time)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(projection.presentWheels) { wheel in
                if let value = point.value(for: wheel) {
                    row(for: wheel, value: value)
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

    private func row(for wheel: TPSectionWheel, value: Double) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Circle().fill(TPSectionPalette.color(for: wheel)).frame(width: 7, height: 7)
            TPSectionStrings.text(wheel.tileLabelKey, wheel.tileLabelFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: TPSectionFormat.value(
                value,
                symbol: projection.unitSymbol,
                localeIdentifier: locale.identifier
            ))
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
        }
    }
}
