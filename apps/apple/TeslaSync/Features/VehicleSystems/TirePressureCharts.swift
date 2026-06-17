//
//  TirePressureCharts.swift
//  TeslaSync — P4 feature view · P7 · TirePressure (Apple) — Swift Charts
//
//  The two native Swift Charts surfaces (never a WKWebView):
//   • `TirePressureRadialGauge` — the per-corner gauge (web Recharts/SVG
//     `RadialGauge`) drawn as a donut with `SectorMark`: a tinted fill arc over
//     a hairline track, the value + unit centered, the corner label beneath.
//   • `TirePressureHistoryChart` — the four-corner pressure history (web Recharts
//     `LineChart`) drawn with `LineMark`, one series per corner.
//
//  Series colors and the gauge track come from the generated chart-series design
//  tokens (P2); values are already converted to the display unit by the model.
//

import Charts
import SwiftUI

// MARK: - Chart — RadialGauge (web `RadialGauge`)

/// One donut gauge: a tinted fill arc proportional to `value / maximum` layered
/// over a hairline track, with the value + unit centered and the label below.
struct TirePressureRadialGauge: View {
    let value: Double
    let maximum: Double
    let label: String
    let unit: String
    let tone: TirePressureTone

    private var clamped: Double { min(max(value, 0), maximum) }
    private var fraction: Double { maximum > 0 ? clamped / maximum : 0 }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
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
            .frame(width: 120, height: 120)
            .overlay { centerOverlay }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(label))
            .accessibilityValue(Text(valueText))

            Text(label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private var centerOverlay: some View {
        VStack(spacing: 1) {
            Text(TirePressureFormat.number(clamped))
                .font(.system(size: 20, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(unit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .accessibilityHidden(true)
    }

    private var valueText: String {
        "\(TirePressureFormat.number(clamped)) \(unit)"
    }

    private var sectors: [TirePressureGaugeSector] {
        [
            TirePressureGaugeSector(id: "fill", amount: fraction, color: tone.color),
            TirePressureGaugeSector(id: "track", amount: max(0, 1 - fraction), color: Color.TS.border)
        ]
    }
}

/// One slice of the gauge donut (fill or track).
private struct TirePressureGaugeSector: Identifiable {
    let id: String
    let amount: Double
    let color: Color
}

// MARK: - Chart — Pressure history (web `LineChart`)

/// The four-corner pressure-history line chart. Each corner is a `LineMark`
/// series tinted by its design token; the X axis is time, the Y axis the display
/// pressure. The caller renders an empty state when there are no points, so this
/// view always has data to plot.
struct TirePressureHistoryChart: View {
    let points: [TirePressureChartPoint]
    let unit: TirePressureUnit

    var body: some View {
        Chart {
            ForEach(TirePosition.allCases) { position in
                ForEach(points) { point in
                    LineMark(
                        x: .value("Time", point.time),
                        y: .value("Pressure", point.value(for: position))
                    )
                    .foregroundStyle(by: .value("Series", position.label))
                    .lineStyle(StrokeStyle(lineWidth: 2))
                    .interpolationMethod(.catmullRom)
                }
            }
        }
        .chartForegroundStyleScale(domain: seriesNames, range: seriesColors)
        .chartLegend(position: .bottom, spacing: TSSpacing.md)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(height: 300)
        .overlay(alignment: .topTrailing) { unitTitle }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityLabel))
        .accessibilityValue(Text(accessibilityValue))
    }

    // MARK: Axes

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
        AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let pressure = value.as(Double.self) {
                    Text(TirePressureFormat.number(pressure))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private var unitTitle: some View {
        Text(unit.label)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .padding(TSSpacing.xs)
    }

    // MARK: Series identity + color tokens

    /// Web `LINE_COLORS`: FL #3b82f6 → speed, FR #06b6d4 → regen,
    /// RL #22c55e → battery, RR #a855f7 → power (exact-hex token matches).
    private var seriesColors: [Color] {
        TirePosition.allCases.map { position in
            switch position {
            case .fl: return Color.TS.chartSeriesSpeed
            case .fr: return Color.TS.chartSeriesRegen
            case .rl: return Color.TS.chartSeriesBattery
            case .rr: return Color.TS.chartSeriesPower
            }
        }
    }

    private var seriesNames: [String] {
        TirePosition.allCases.map(\.label)
    }

    private var accessibilityLabel: String {
        String(localized: "translation.Pressure History", defaultValue: "Pressure History")
    }

    private var accessibilityValue: String {
        "\(points.count) \(unit.label)"
    }
}

// MARK: - GlassPanel 8 — pressure history chart panel

/// The pressure-history panel (web GlassPanel 8): the section header over the
/// line chart, with a redacted skeleton while reloading and a
/// `ContentUnavailableView` when the window holds no readings.
struct TirePressureHistoryChartPanel: View {
    let points: [TirePressureChartPoint]
    let unit: TirePressureUnit
    let isLoading: Bool

    var body: some View {
        TirePressureCard {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TirePressureSectionHeader(
                    systemImage: "chart.xyaxis.line",
                    title: String(localized: "translation.Pressure History", defaultValue: "Pressure History")
                )

                if isLoading {
                    chartSkeleton
                } else if points.isEmpty {
                    emptyState
                } else {
                    TirePressureHistoryChart(points: points, unit: unit)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var emptyState: some View {
        ContentUnavailableView(
            String(localized: "translation.No History Data", defaultValue: "No History Data"),
            systemImage: "chart.line.downtrend.xyaxis"
        )
        .frame(height: 300)
        .frame(maxWidth: .infinity)
    }

    private var chartSkeleton: some View {
        RoundedRectangle(cornerRadius: TSRadius.md)
            .fill(Color.TS.surface)
            .frame(height: 300)
            .redacted(reason: .placeholder) // parity:allow native shimmer for the chart loading state
    }
}
