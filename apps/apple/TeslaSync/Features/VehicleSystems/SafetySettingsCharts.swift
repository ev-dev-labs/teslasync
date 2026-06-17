//
//  SafetySettingsCharts.swift
//  TeslaSync — P4 feature view · P7 · vehicle-systems/SafetySettings (Apple) — Swift Charts
//
//  The two native Swift Charts surfaces (never a WKWebView):
//   • `SafetyRadialGauge` — the safety-score gauge (web Recharts/SVG `RadialGauge`)
//     drawn as a donut with `SectorMark`: a tinted fill arc over a hairline track,
//     the percentage + label centered.
//   • `SafetyStatesChart` — the three-series safety-state history (web Recharts
//     `LineChart`, `type="stepAfter"`) drawn with `LineMark` + `.stepEnd`
//     interpolation, the Y axis labeled On / Off.
//
//  Series colors and the gauge track come from the generated chart-series design
//  tokens (P2); values are already collapsed to 0/1 by the model.
//

import Charts
import SwiftUI

// MARK: - Chart — RadialGauge (web `RadialGauge`)

/// The safety-score donut: a tinted fill arc proportional to `value / maximum`
/// layered over a hairline track, with the percentage + label centered.
struct SafetyRadialGauge: View {
    let value: Double
    let maximum: Double
    let label: String
    let unit: String
    let tone: SafetyTone

    private var clamped: Double { min(max(value, 0), maximum) }
    private var fraction: Double { maximum > 0 ? clamped / maximum : 0 }

    var body: some View {
        Chart(sectors) { sector in
            SectorMark(
                angle: .value("Fraction", sector.amount),
                innerRadius: .ratio(0.68),
                angularInset: 1
            )
            .foregroundStyle(sector.color)
            .cornerRadius(3)
        }
        .chartLegend(.hidden)
        .frame(width: 132, height: 132)
        .overlay { centerOverlay }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(unit))
    }

    private var centerOverlay: some View {
        VStack(spacing: 1) {
            Text(unit)
                .font(.system(size: 22, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(tone.color)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, TSSpacing.sm)
        .accessibilityHidden(true)
    }

    private var sectors: [SafetyGaugeSector] {
        [
            SafetyGaugeSector(id: "fill", amount: fraction, color: tone.color),
            SafetyGaugeSector(id: "track", amount: max(0, 1 - fraction), color: Color.TS.border)
        ]
    }
}

/// One slice of the gauge donut (fill or track).
private struct SafetyGaugeSector: Identifiable {
    let id: String
    let amount: Double
    let color: Color
}

// MARK: - Chart — Safety states over time (web `LineChart`, stepAfter)

/// The three-series safety-state history. Each ADAS series (AEB / BSCW / ELDA) is
/// a `LineMark` with `.stepEnd` interpolation (web `type="stepAfter"`); the Y axis
/// reads On / Off at 1 / 0. The caller renders the empty state when there are no
/// points, so this view always has data to plot.
struct SafetyStatesChart: View {
    let points: [SafetyChartPoint]

    var body: some View {
        Chart {
            ForEach(SafetyChartSeries.allCases) { series in
                ForEach(points) { point in
                    LineMark(
                        x: .value("Time", point.time),
                        y: .value("State", point.value(for: series))
                    )
                    .foregroundStyle(by: .value("Series", series.label))
                    .lineStyle(StrokeStyle(lineWidth: 2))
                    .interpolationMethod(.stepEnd)
                }
            }
        }
        .chartForegroundStyleScale(domain: seriesNames, range: seriesColors)
        .chartLegend(position: .bottom, spacing: TSSpacing.md)
        .chartYScale(domain: 0 ... 1)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(height: 300)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(safetyText("Safety States Over Time")))
        .accessibilityValue(Text("\(points.count)"))
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: .automatic(desiredCount: 4)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let date = value.as(Date.self) {
                    Text(date.formatted(date: .abbreviated, time: .omitted))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading, values: [0, 1]) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let state = value.as(Double.self) {
                    Text(stateLabel(state))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    /// Web `tickFormatter={(v) => (v === 1 ? t('On') : t('Off'))}`.
    private func stateLabel(_ value: Double) -> String {
        value >= 1
            ? safetyText("On")
            : safetyText("Off")
    }

    private var seriesNames: [String] {
        SafetyChartSeries.allCases.map(\.label)
    }

    private var seriesColors: [Color] {
        SafetyChartSeries.allCases.map(\.color)
    }
}

// MARK: - GlassPanel 13 — Safety States chart panel

/// The safety-states chart panel (web GlassPanel 13): the section title over the
/// step-line chart, with a `ContentUnavailableView` when there is no history to
/// chart — never a blank region.
struct SafetyStatesChartPanel: View {
    let points: [SafetyChartPoint]

    var body: some View {
        SafetyPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                SafetySectionTitle(text: safetyText("Safety States Over Time"))
                if points.isEmpty {
                    emptyState
                } else {
                    SafetyStatesChart(points: points)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var emptyState: some View {
        ContentUnavailableView(
            safetyText("No safety state history to chart yet."),
            systemImage: "chart.line.downtrend.xyaxis"
        )
        .frame(height: 300)
        .frame(maxWidth: .infinity)
    }
}
