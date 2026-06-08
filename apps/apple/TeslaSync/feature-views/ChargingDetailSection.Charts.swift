//
//  ChargingDetailSection.Charts.swift
//  TeslaSync — P4 feature view · 0053 · ChargingDetailSection (Apple)
//
//  The Monthly Charging Trend composed chart — the Swift Charts parity of the web
//  Recharts `ComposedChart`: an energy `AreaMark` + a sessions `BarMark` on the
//  LEFT axis and an average-power `LineMark` on the RIGHT axis. Swift Charts shares
//  one y-domain, so the line is re-projected onto the left domain via
//  `MonthlyTrendScale` and a trailing axis is drawn with labels mapped back to true
//  power. A custom legend (web `Legend`) sits above the plot; the whole chart
//  exposes a single accessible summary so VoiceOver isn't handed an opaque image.
//

import Charts
import SwiftUI

// MARK: - Legend chip (web `Legend`)

/// One legend entry: a colored swatch + the series name (pre-localized).
struct ChargingLegendChip: View {
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

// MARK: - Monthly Charging Trend composed chart (web `ComposedChart`)

/// The composed monthly chart. Bars (sessions) sit behind the energy area, with
/// the average-power line on top; the dual axis is reproduced by re-projecting the
/// power line onto the left domain and labeling a trailing axis with true power.
struct MonthlyChargingTrendChart: View {
    let points: [MonthlyChargePoint]
    let scale: MonthlyTrendScale
    let localize: (String, String) -> String
    let formatting: any ChargingDetailFormatting

    /// Web CHART_COLORS parity: energy=[1], sessions=[2], avgPower=[3].
    private var energyColor: Color {
        TSChartPalette.color(at: 1)
    }

    private var sessionsColor: Color {
        TSChartPalette.color(at: 2)
    }

    private var powerColor: Color {
        TSChartPalette.color(at: 3)
    }

    private var energyLabel: String {
        localize("analytics.charging.energykWh", "Energy (kWh)")
    }

    private var powerLabel: String {
        localize("analytics.charging.avgPowerkW", "Avg Power (kW)")
    }

    private var sessionsLabel: String {
        localize("analytics.charging.sessions", "sessions")
    }

    private var energyGradient: LinearGradient {
        LinearGradient(
            colors: [energyColor.opacity(0.35), energyColor.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var chartSummary: String {
        ChargingAccessibility.monthlyTrendSummary(
            points,
            labels: MonthlyTrendLabels(
                title: localize("analytics.charging.monthlyTrend", "Monthly Charging Trend"),
                energy: energyLabel,
                power: powerLabel,
                sessions: sessionsLabel
            ),
            formatInt: formatting.formatInt
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            legend
            chart
                .frame(height: 260)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: chartSummary))
        }
    }

    private var legend: some View {
        HStack(spacing: TSSpacing.md) {
            ChargingLegendChip(color: energyColor, label: energyLabel)
            ChargingLegendChip(color: powerColor, label: powerLabel)
            ChargingLegendChip(color: sessionsColor, label: sessionsLabel)
        }
        .accessibilityElement(children: .combine)
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                BarMark(
                    x: .value("month", point.month),
                    y: .value("sessions", ChargingNumeric.safe(point.sessions))
                )
                .foregroundStyle(sessionsColor.opacity(0.6))
                .cornerRadius(3)

                AreaMark(
                    x: .value("month", point.month),
                    y: .value("energy", ChargingNumeric.safe(point.energy))
                )
                .foregroundStyle(energyGradient)
                .interpolationMethod(.catmullRom)

                LineMark(
                    x: .value("month", point.month),
                    y: .value("power", scale.plotted(power: point.avgPower))
                )
                .foregroundStyle(powerColor)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.catmullRom)
            }
        }
        .chartYScale(domain: 0 ... scale.domainUpperBound)
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: ChargingNumeric.axisLabel(number))
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
            AxisMarks(position: .trailing, values: scale.trailingTickPositions) { value in
                AxisValueLabel {
                    if let plotted = value.as(Double.self) {
                        Text(verbatim: formatting.formatInt(scale.truePower(fromPlotted: plotted)))
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
