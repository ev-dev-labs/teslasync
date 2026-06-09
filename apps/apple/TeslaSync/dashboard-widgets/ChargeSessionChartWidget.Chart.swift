//
//  ChargeSessionChartWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0019 · ChargeSessionChartWidget (Apple)
//
//  The Swift Charts bar chart — the native counterpart of the web Recharts
//  `BarChart` in features/dashboard/widgets/ChargeSessionChartWidget.tsx. Renders
//  one bar per recent charge session (energy added in kWh), color-coded by
//  charger-type bucket, with a tap-to-inspect tooltip, per-bar VoiceOver values,
//  and the persistent home / Supercharger / DC legend the web draws under the
//  chart.
//

import Charts
import SwiftUI

// MARK: - Charge-session bar chart (web Recharts `BarChart`)

/// Energy-per-session bar chart. Each bar is filled with its charger-type color
/// (web `CHARGER_COLORS`: Supercharger red, DC amber, Home green — sourced here
/// from the design-token status palette so the colors track the theme). Bars are
/// plotted against a stable per-session key so two sessions on the same calendar
/// day never collapse, and the x-axis renders the human date label.
struct ChargeSessionChart: View {
    let bars: [ChargeSessionBar]
    let energyUnit: String
    var isWide: Bool = false

    @State private var selectedKey: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The design-token fill for a charger-type bucket — the native counterpart
    /// of the web `CHARGER_COLORS` hex values (Supercharger `#ef4444` →
    /// statusDanger, DC `#f59e0b` → statusWarning, Home `#10b981` → statusSuccess).
    static func color(for kind: ChargeSessionChargerKind) -> Color {
        switch kind {
        case .home: Color.TS.statusSuccess
        case .supercharger: Color.TS.statusDanger
        case .dc: Color.TS.statusWarning
        }
    }

    private var sessionLabel: String {
        ChargeSessionStrings.string("widget.chargeSessionChart.session", "Session")
    }

    private var energyLabel: String {
        ChargeSessionStrings.string("widget.chargeSessionChart.energy", "Energy")
    }

    private var labelsByKey: [String: String] {
        Dictionary(bars.map { ($0.plotKey, $0.label) }, uniquingKeysWith: { first, _ in first })
    }

    private var selectedBar: ChargeSessionBar? {
        guard let selectedKey else { return nil }
        return bars.first { $0.plotKey == selectedKey }
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            chart
            legend
        }
    }

    private var chart: some View {
        Chart {
            ForEach(bars) { bar in
                BarMark(
                    x: .value(sessionLabel, bar.plotKey),
                    y: .value(energyLabel, bar.energy)
                )
                .foregroundStyle(Self.color(for: bar.kind))
                .cornerRadius(4)
                .accessibilityLabel(Text(verbatim: bar.label))
                .accessibilityValue(Text(verbatim: ChargeSessionAccessibility.barLabel(bar)))
            }

            if let selectedBar {
                RuleMark(x: .value(sessionLabel, selectedBar.plotKey))
                    .foregroundStyle(Color.TS.border)
                    .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        tooltip(for: selectedBar)
                    }
            }
        }
        .chartXScale(domain: bars.map(\.plotKey))
        .chartXSelection(value: $selectedKey)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: bars)
        .accessibilityLabel(
            ChargeSessionStrings.text(
                "widget.chargeSessionChart.chartA11y",
                "Bar chart of energy added per recent charge session, color-coded by charger type"
            )
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
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: ChargeSessionFormat.number(number, decimals: 0))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    /// The session keys shown on the x-axis: all of them on a wide widget,
    /// evenly thinned on a narrow one so the date labels never collide (the web
    /// swaps `axisTick` ↔ `axisTickSm` by width for the same reason).
    private var axisKeys: [String] {
        let keys = bars.map(\.plotKey)
        let limit = isWide ? 10 : 6
        guard keys.count > limit else { return keys }
        let step = Int(ceil(Double(keys.count) / Double(limit)))
        return keys.enumerated().filter { $0.offset.isMultiple(of: step) }.map(\.element)
    }

    private func tooltip(for bar: ChargeSessionBar) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: bar.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: "\(ChargeSessionFormat.number(bar.energy, decimals: 1)) \(energyUnit)")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            ChargeSessionStrings.text(bar.kind.labelKey, bar.kind.labelFallback)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
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

    // MARK: Legend (web charger-type legend under the chart)

    private var legend: some View {
        HStack(spacing: TSSpacing.md) {
            ForEach(ChargeSessionChargerKind.allCases) { kind in
                HStack(spacing: TSSpacing.xs) {
                    Circle()
                        .fill(Self.color(for: kind))
                        .frame(width: 8, height: 8)
                    ChargeSessionStrings.text(kind.labelKey, kind.labelFallback)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            ChargeSessionStrings.text("widget.chargeSessionChart.legendA11y", "Charger type legend")
        )
    }
}
