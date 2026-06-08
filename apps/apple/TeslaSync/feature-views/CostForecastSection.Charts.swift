//
//  CostForecastSection.Charts.swift
//  TeslaSync — P4 feature view · 0109 · CostForecastSection (Apple)
//
//  The two charts — the Swift Charts parity of the web Recharts blocks:
//    • CostForecastChart — the web `ComposedChart`: a 95%-confidence `AreaMark`
//      band (`[costLow, costHigh]`, drawn natively with `yStart:/yEnd:` rather than
//      the web's stacked transparent-base trick), the actual-cost `AreaMark` +
//      `LineMark` over the historical months, and the projected-cost dashed
//      `LineMark` over the forecast months. A custom legend (web `Legend`) sits
//      above the plot.
//    • CostForecastSectionPerKwhChart — the web `LineChart`: a `LineMark` + `PointMark` of the
//      historical `cost_per_kwh`.
//  Each chart exposes a single accessible summary so VoiceOver isn't handed an
//  opaque image. Series colors mirror the web exactly (actual = chart palette[0];
//  forecast/band = #a855f7; cost-per-kWh = #06b6d4).
//

import Charts
import SwiftUI

// MARK: - Palette (web hex parity)

/// The forecast charts' series colors, matched to the web source. `actual` follows
/// the design-token chart palette (web `palette[0]`); `projected` / `band` reuse the
/// web's `#a855f7` (the `TrendingUp` neon-purple); `costPerKwh` reuses `#06b6d4`.
enum CostForecastPalette {
    /// Web `palette[0]` — the actual-cost series.
    static var actual: Color {
        TSChartPalette.color(at: 0)
    }

    /// Web `#a855f7` — the projected-cost line and the confidence band.
    static let projected = Color(red: 168.0 / 255.0, green: 85.0 / 255.0, blue: 247.0 / 255.0)

    /// Web `#06b6d4` — the cost-per-kWh trend line.
    static let costPerKwh = Color(red: 6.0 / 255.0, green: 182.0 / 255.0, blue: 196.0 / 255.0)
}

// MARK: - Legend chip (web `Legend`)

/// One legend entry: a colored swatch + the series name (pre-localized).
struct CostForecastLegendChip: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
    }
}

// MARK: - Cost Forecast composed chart (web `ComposedChart`)

/// The composed forecast chart. The confidence band sits behind the actual-cost
/// area; the projected-cost dashed line picks up where the actuals end. A manual
/// legend names the three series, and a single accessible summary describes the
/// whole plot.
struct CostForecastChart: View {
    let chart: ForecastChartModel
    let localize: (String, String) -> String
    let formatting: any CostForecastFormatting

    private var actualLabel: String {
        localize("costAnalysis.forecast.actual", "Actual Cost")
    }

    private var projectedLabel: String {
        localize("costAnalysis.forecast.projected", "Projected Cost")
    }

    private var confidenceLabel: String {
        localize("costAnalysis.forecast.confidence", "95% Confidence")
    }

    private var actualGradient: LinearGradient {
        LinearGradient(
            colors: [CostForecastPalette.actual.opacity(0.30), CostForecastPalette.actual.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var chartSummary: String {
        CostForecastAccessibility.forecastSummary(
            chart,
            labels: ForecastSeriesLabels(
                title: localize("costAnalysis.forecast.title", "Cost Forecast"),
                actual: actualLabel,
                projected: projectedLabel,
                confidence: confidenceLabel
            ),
            formatCurrency: { formatting.formatCurrency($0, decimals: 2) }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            legend
            plot
                .frame(height: 300)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: chartSummary))
        }
    }

    private var legend: some View {
        HStack(spacing: TSSpacing.md) {
            CostForecastLegendChip(color: CostForecastPalette.projected.opacity(0.5), label: confidenceLabel)
            CostForecastLegendChip(color: CostForecastPalette.actual, label: actualLabel)
            CostForecastLegendChip(color: CostForecastPalette.projected, label: projectedLabel)
        }
        .accessibilityElement(children: .combine)
    }

    private var plot: some View {
        Chart {
            // 95%-confidence band (web ci_low + ci_band stacked area → native band).
            ForEach(chart.band) { point in
                AreaMark(
                    x: .value("month", point.month),
                    yStart: .value("low", point.low),
                    yEnd: .value("high", point.high)
                )
                .foregroundStyle(CostForecastPalette.projected.opacity(0.15))
                .interpolationMethod(.catmullRom)
            }

            // Actual cost (web `Area dataKey="actual"`): gradient fill + stroke.
            ForEach(chart.actual) { point in
                AreaMark(
                    x: .value("month", point.month),
                    y: .value("actual", point.cost)
                )
                .foregroundStyle(actualGradient)
                .interpolationMethod(.catmullRom)
            }
            ForEach(chart.actual) { point in
                LineMark(
                    x: .value("month", point.month),
                    y: .value("actual", point.cost),
                    series: .value("series", "actual")
                )
                .foregroundStyle(CostForecastPalette.actual)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.catmullRom)
            }

            // Projected cost (web `Line dataKey="forecast"` strokeDasharray="8 4").
            ForEach(chart.projected) { point in
                LineMark(
                    x: .value("month", point.month),
                    y: .value("forecast", point.cost),
                    series: .value("series", "forecast")
                )
                .foregroundStyle(CostForecastPalette.projected)
                .lineStyle(StrokeStyle(lineWidth: 2, dash: [8, 4]))
                .interpolationMethod(.catmullRom)
            }
        }
        .chartXScale(domain: chart.orderedMonths)
        .chartYScale(domain: 0 ... chart.domainUpperBound)
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: formatting.formatCurrencyCompact(number))
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks { _ in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.15))
                AxisValueLabel()
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .chartLegend(.hidden)
    }
}

// MARK: - Cost per kWh trend chart (web `LineChart`)

/// The cost-per-kWh trend line (web `LineChart` plotting `cost_per_kwh`): a single
/// cyan line with point dots and a dollar axis, with an accessible range summary.
struct CostForecastSectionPerKwhChart: View {
    let points: [CostPerKwhPoint]
    let upperBound: Double
    let localize: (String, String) -> String
    let formatting: any CostForecastFormatting

    private var seriesLabel: String {
        localize("costAnalysis.forecast.costPerKwh", "$/kWh")
    }

    private var chartSummary: String {
        CostForecastAccessibility.costPerKwhSummary(
            points,
            title: localize("costAnalysis.forecast.costPerKwhTrend", "Cost per kWh Trend"),
            formatCurrency: { formatting.formatCurrency($0, decimals: 2) }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            CostForecastLegendChip(color: CostForecastPalette.costPerKwh, label: seriesLabel)
                .accessibilityHidden(true)
            plot
                .frame(height: 200)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: chartSummary))
        }
    }

    private var plot: some View {
        Chart {
            ForEach(points) { point in
                LineMark(
                    x: .value("month", point.month),
                    y: .value("costPerKwh", point.costPerKwh)
                )
                .foregroundStyle(CostForecastPalette.costPerKwh)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.catmullRom)

                PointMark(
                    x: .value("month", point.month),
                    y: .value("costPerKwh", point.costPerKwh)
                )
                .foregroundStyle(CostForecastPalette.costPerKwh)
                .symbolSize(36)
            }
        }
        .chartYScale(domain: 0 ... upperBound)
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: formatting.formatCurrency(number, decimals: 2))
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks { _ in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.15))
                AxisValueLabel()
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .chartLegend(.hidden)
    }
}
