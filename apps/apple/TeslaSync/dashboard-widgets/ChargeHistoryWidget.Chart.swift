//
//  ChargeHistoryWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0017 · ChargeHistoryWidget (Apple)
//
//  The Swift Charts gradient area chart — the native counterpart of the web
//  Recharts `AreaChart` (via `AreaChartWrapper`) in
//  features/dashboard/widgets/ChargeHistoryWidget.tsx. Plots one point per recent
//  charge session (energy added in kWh) as a single emerald monotone area with a
//  top→bottom gradient fill (web `<Area type="monotone" fill="url(#gradient)">`),
//  with a tap-to-inspect tooltip, per-point VoiceOver values, and a kWh-formatted
//  y axis. Honors Reduce Motion.
//

import Charts
import SwiftUI

// MARK: - Charge-history area chart (web Recharts `AreaChart`)

/// Energy-per-session area chart. A single emerald series (web `color: '#10b981'`,
/// sourced here from the design-token success palette so it tracks the theme)
/// with a 0.3→0 vertical gradient fill (web `stopOpacity` 0.3→0) and a 2pt stroke
/// (web `strokeWidth={2}`). Points are plotted against a stable per-session key
/// so the reversed order is preserved, and the x-axis renders the web index label
/// (web `xKey="i"` with no formatter).
struct ChargeHistoryAreaChart: View {
    let points: [ChargeHistoryPoint]
    let energyUnit: String
    var isWide: Bool = false

    @State private var selectedKey: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The design-token series color — the native counterpart of the web
    /// `#10b981` (emerald) energy series. `Color.TS.statusSuccess` resolves to
    /// `#10b981` in dark mode with a themed light/high-contrast variant.
    static let seriesColor = Color.TS.statusSuccess

    private var areaGradient: LinearGradient {
        LinearGradient(
            colors: [Self.seriesColor.opacity(0.3), Self.seriesColor.opacity(0.0)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var sessionLabel: String {
        ChargeHistoryStrings.string("widget.chargeHistory.session", "Session")
    }

    private var energyLabel: String {
        ChargeHistoryStrings.string("widget.chargeHistory.energy", "Energy")
    }

    private var labelsByKey: [String: String] {
        Dictionary(points.map { ($0.plotKey, $0.indexLabel) }, uniquingKeysWith: { first, _ in first })
    }

    private var selectedPoint: ChargeHistoryPoint? {
        guard let selectedKey else { return nil }
        return points.first { $0.plotKey == selectedKey }
    }

    var body: some View {
        Chart {
            ForEach(points) { point in
                AreaMark(
                    x: .value(sessionLabel, point.plotKey),
                    y: .value(energyLabel, point.energy)
                )
                .foregroundStyle(areaGradient)
                .interpolationMethod(.monotone)
                .accessibilityLabel(Text(verbatim: point.indexLabel))
                .accessibilityValue(Text(verbatim: ChargeHistoryAccessibility.pointLabel(point, unit: energyUnit)))

                LineMark(
                    x: .value(sessionLabel, point.plotKey),
                    y: .value(energyLabel, point.energy)
                )
                .foregroundStyle(Self.seriesColor)
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.monotone)
            }

            if let selectedPoint {
                RuleMark(x: .value(sessionLabel, selectedPoint.plotKey))
                    .foregroundStyle(Color.TS.border)
                    .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        tooltip(for: selectedPoint)
                    }
            }
        }
        .chartXScale(domain: points.map(\.plotKey))
        .chartXSelection(value: $selectedKey)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: points)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            ChargeHistoryStrings.text(
                "widget.chargeHistory.chartA11y",
                "Area chart of energy added per recent charge session"
            )
        )
        .accessibilityValue(Text(verbatim: ChargeHistoryAccessibility.summary(for: chartProjection)))
    }

    /// A lightweight projection wrapper so the chart's VoiceOver value reuses the
    /// shared summary builder without the view owning the model.
    private var chartProjection: ChargeHistoryChartProjection {
        let total = points.reduce(0) { $0 + $1.energy }
        let avg = points.isEmpty ? 0 : total / Double(points.count)
        return ChargeHistoryChartProjection(
            points: points,
            totalEnergy: total,
            avgEnergy: avg,
            energyUnit: energyUnit,
            hasData: points.count > 1
        )
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: axisKeys) { value in
            AxisValueLabel {
                if let key = value.as(String.self), let label = labelsByKey[key] {
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
            AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: "\(ChargeHistoryFormat.number(number, decimals: 0)) \(energyUnit)")
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    /// The session keys shown on the x-axis: all of them on a wide widget,
    /// evenly thinned on a narrow one so the index labels never collide.
    private var axisKeys: [String] {
        let keys = points.map(\.plotKey)
        let limit = isWide ? 10 : 6
        guard keys.count > limit else { return keys }
        let step = Int(ceil(Double(keys.count) / Double(limit)))
        return keys.enumerated().filter { $0.offset.isMultiple(of: step) }.map(\.element)
    }

    private func tooltip(for point: ChargeHistoryPoint) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: "\(sessionLabel) \(point.indexLabel)")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: "\(ChargeHistoryFormat.number(point.energy, decimals: 1)) \(energyUnit)")
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
