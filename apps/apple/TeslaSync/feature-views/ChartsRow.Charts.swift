//
//  ChartsRow.Charts.swift
//  TeslaSync — P4 feature view · 0099 · ChartsRow (Apple)
//
//  The two Swift Charts that are the body of the surface, the native parity of the web
//  Recharts charts (mapped through the P3 `@/components/charts` layer):
//
//    1. Energy & Cost Trend — an energy `AreaMark` (gradient fill + solid stroke) and a
//       dashed cost `LineMark`, both on one shared y-domain (web `<AreaChart>` with a
//       single `<YAxis/>` shared by both `<Area/>`s). A custom legend names the series.
//    2. Charger Breakdown  — a `SectorMark` donut (web `<PieChart><Pie innerRadius…>`),
//       each slice tinted by its semantic tone.
//
//  Colors come from the generated `Color.TS` tokens (P1/S9), not ported Tailwind: the
//  tokens match the web hexes exactly (statusSuccess=#10b981, statusWarning=#f59e0b,
//  statusDanger=#ef4444). Each chart carries a single accessible summary so VoiceOver is
//  not handed an opaque image.
//

import Charts
import SwiftUI

// MARK: - Tone → design token (P1/S9)

extension ChartsRowTone {
    /// The `Color.TS` token this tone resolves to. The token RGB matches the web hex the
    /// tone ports, so the native chart reads identically without hardcoding a hex.
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .accent: Color.TS.accent
        case .info: Color.TS.statusInfo
        }
    }
}

// MARK: - Legend chip (web `<Legend>`)

/// One legend entry: a colored swatch + the series name (pre-localized).
struct ChartsRowLegendChip: View {
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

// MARK: - 1. Energy & Cost Trend (web `<AreaChart>`)

/// The energy & cost trend chart. The energy series is a gradient area with a solid
/// stroke; the cost series is a dashed line. Both share one y-domain (web single
/// `<YAxis/>`), with the date band on x. A custom legend sits above the plot.
struct ChartsRowEnergyChart: View {
    let points: [ChartsRowEnergyPoint]
    let scale: ChartsRowEnergyScale
    let localize: (String, String) -> String
    let formatting: any ChartsRowFormatting

    private var energyColor: Color {
        ChartsRowTone.success.color
    }

    private var costColor: Color {
        ChartsRowTone.warning.color
    }

    private var energyLabel: String {
        localize("charging.charts.energySeries", "Energy (kWh)")
    }

    private var costLabel: String {
        localize("charging.charts.costSeries", "Cost ($)")
    }

    private var energyGradient: LinearGradient {
        LinearGradient(
            colors: [energyColor.opacity(0.35), energyColor.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var chartSummary: String {
        ChartsRowAccessibility.energyTrendSummary(
            points,
            labels: ChartsRowTrendLabels(
                title: localize("charging.charts.energyCostTrend", "Energy & Cost Trend"),
                energy: energyLabel,
                cost: costLabel
            ),
            formatNumber: { formatting.formatNumber($0) },
            formatCurrency: { formatting.formatCurrency($0) }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            legend
            chart
                .frame(height: 200)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: chartSummary))
        }
    }

    private var legend: some View {
        HStack(spacing: TSSpacing.md) {
            ChartsRowLegendChip(color: energyColor, label: energyLabel)
            ChartsRowLegendChip(color: costColor, label: costLabel)
        }
        .accessibilityHidden(true)
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                AreaMark(
                    x: .value("date", point.date),
                    y: .value("energy", ChartsRowNumeric.safe(point.energy))
                )
                .foregroundStyle(energyGradient)
                .interpolationMethod(.catmullRom)

                LineMark(
                    x: .value("date", point.date),
                    y: .value("energy", ChartsRowNumeric.safe(point.energy))
                )
                .foregroundStyle(energyColor)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.catmullRom)
            }
            ForEach(points) { point in
                LineMark(
                    x: .value("date", point.date),
                    y: .value("cost", ChartsRowNumeric.safe(point.cost))
                )
                .foregroundStyle(costColor)
                .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 2]))
                .interpolationMethod(.catmullRom)
            }
        }
        .chartYScale(domain: 0 ... scale.domainUpperBound)
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: formatting.formatNumber(number, decimals: 0))
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 6)) { _ in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.15))
                AxisValueLabel()
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .chartLegend(.hidden)
    }
}

// MARK: - 2. Charger Breakdown (web `<PieChart><Pie innerRadius=40 outerRadius=70 />`)

/// The charger-breakdown donut. Each slice is angled by its value and tinted by its
/// tone; the inner radius reproduces the web donut hole. The summary is built by the
/// panel so the chart stays presentational.
struct ChartsRowDonutChart: View {
    let donut: ChartsRowDonut
    let accessibilitySummary: String

    var body: some View {
        Chart(donut.slices) { slice in
            SectorMark(
                angle: .value("value", slice.value),
                innerRadius: .ratio(0.6),
                angularInset: 2
            )
            .cornerRadius(3)
            .foregroundStyle(slice.tone.color)
        }
        .chartLegend(.hidden)
        .frame(width: 168, height: 168)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }
}
