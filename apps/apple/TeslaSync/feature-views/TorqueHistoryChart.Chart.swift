//
//  TorqueHistoryChart.Chart.swift
//  TeslaSync — P4 feature view · 0164 · TorqueHistoryChart (Apple)
//
//  The single-series Swift Charts area chart for the "Motor Torque" surface (web
//  Recharts `AreaChart` → native `Chart { AreaMark + LineMark }`) with its
//  `#00f0ff` gradient fill, the `y = 0` reference rule (web `ReferenceLine`), and
//  the x-selection value tooltip (web `ChartTooltip`). Split out of
//  TorqueHistoryChart.Views.swift so each presentational unit stays focused. Copy
//  resolves through the P1/S10 facade; chrome is token-driven (P1/S9).
//

import Charts
import SwiftUI

// MARK: - Chart (web Recharts single-series `AreaChart`)

/// The single-series area chart — the native counterpart of the web Recharts
/// `AreaChart` with one `Area` (`torque`, Nm). One mark per non-null sample (web
/// `connectNulls` bridges the gaps); a `y = 0` reference rule mirrors the web
/// `ReferenceLine`; tapping a sample reveals a value tooltip (web `ChartTooltip`);
/// each sample carries a per-point VoiceOver value.
struct TorqueHistoryAreaChart: View {
    let points: [TorquePoint]
    let locale: Locale

    @State private var selectedIndex: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var plotted: [TorquePoint] {
        TorqueHistoryProjection.plotted(points)
    }

    private var labelByIndex: [Int: String] {
        Dictionary(points.map { ($0.index, $0.time) }, uniquingKeysWith: { first, _ in first })
    }

    private var selectedPoint: TorquePoint? {
        guard let selectedIndex else { return nil }
        return points.first { $0.index == selectedIndex && $0.torque != nil }
    }

    private var timeLabel: String {
        TorqueHistoryStrings.string("drivetrain.col.time", "Time")
    }

    private var torqueLabel: String {
        TorqueHistoryStrings.string("drivetrain.col.torque", "Torque (Nm)")
    }

    var body: some View {
        Chart {
            ForEach(plotted) { point in
                AreaMark(
                    x: .value(timeLabel, point.index),
                    y: .value(torqueLabel, point.torque ?? 0)
                )
                .foregroundStyle(TorqueHistoryStyle.areaFill)
                .interpolationMethod(.monotone)
                .accessibilityLabel(Text(verbatim: point.time))
                .accessibilityValue(Text(verbatim: pointValue(for: point)))
            }

            ForEach(plotted) { point in
                LineMark(
                    x: .value(timeLabel, point.index),
                    y: .value(torqueLabel, point.torque ?? 0)
                )
                .foregroundStyle(TorqueHistoryStyle.stroke)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.monotone)
            }

            RuleMark(y: .value(torqueLabel, 0))
                .foregroundStyle(Color.TS.textMuted.opacity(0.6))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 2]))

            if let selectedPoint {
                RuleMark(x: .value(timeLabel, selectedPoint.index))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        TorqueHistoryTooltip(point: selectedPoint, locale: locale)
                    }
            }
        }
        .chartXSelection(value: $selectedIndex)
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 6)) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
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
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: TorqueHistoryFormat.decimal(number, locale: locale))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .frame(height: 260)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: points)
        .accessibilityLabel(
            TorqueHistoryStrings.text(
                "drivetrain.torqueHistory.aria",
                "Motor inverter torque output history area chart"
            )
        )
    }

    private func labelForIndex(_ index: Int) -> String {
        if let exact = labelByIndex[index] { return exact }
        // `.automatic` may land on a tick between samples; snap to the nearest one.
        guard let nearest = points.min(by: { abs($0.index - index) < abs($1.index - index) }) else {
            return ""
        }
        return nearest.time
    }

    private func pointValue(for point: TorquePoint) -> String {
        let unit = TorqueHistoryStrings.string("drivetrain.nmUnit", "Nm")
        let name = TorqueHistoryStrings.string("drivetrain.torque", "Torque")
        let value = point.torque.map { TorqueHistoryFormat.newtonMetres($0, unit: unit, locale: locale) } ?? "—"
        return "\(point.time): \(name) \(value)"
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the time label over the sample's torque value, the
/// native parity of the web `ChartTooltip` payload row.
struct TorqueHistoryTooltip: View {
    let point: TorquePoint
    let locale: Locale

    private var unit: String {
        TorqueHistoryStrings.string("drivetrain.nmUnit", "Nm")
    }

    private var valueText: String {
        point.torque.map { TorqueHistoryFormat.newtonMetres($0, unit: unit, locale: locale) } ?? "—"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: point.time)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle().fill(TorqueHistoryStyle.stroke).frame(width: 7, height: 7)
                TorqueHistoryStrings.text("drivetrain.torque.legend", "Torque (Nm)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: valueText)
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
