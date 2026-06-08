//
//  SpeedProfileWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0095 · SpeedProfileWidget (Apple)
//
//  The leaf views the SpeedProfileWidget surface composes: the per-stat cell
//  (web `WidgetChartSummary` stat), the series legend (replacing the web Recharts
//  hover tooltip with a touch-friendly key), and the composed speed-distribution
//  chart — a Swift Charts reproduction of the web `ComposedChart` (frequency bars
//  on the leading axis + an efficiency line on a normalized trailing axis).
//  Kept in their own file so the surface file stays within the house length limit.
//

import Charts
import SwiftUI

// MARK: - Stat cell (web `WidgetChartSummary` stat)

/// One summary stat's data, mirroring the web `ChartSummaryStat` (label, value,
/// optional trailing unit chip).
struct SpeedProfileStatData: Identifiable, Equatable {
    let id: String
    let label: String
    let value: String
    var unit: String?
}

/// One summary stat cell: a muted label above a semibold value with an optional
/// trailing unit, mirroring the web stat (`<span>label</span>` + value + unit).
struct SpeedProfileStatCell: View {
    let data: SpeedProfileStatData

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: data.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(verbatim: data.value)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let unit = data.unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        if let unit = data.unit {
            return "\(data.label) \(data.value) \(unit)"
        }
        return "\(data.label) \(data.value)"
    }
}

// MARK: - Series legend (replaces the web Recharts hover tooltip)

/// A compact key for the two series. The web shows the series names in a Recharts
/// hover tooltip (desktop-only); the native surface renders a persistent,
/// touch-friendly legend so VoiceOver and touch users get the same context.
struct SpeedProfileLegend: View {
    let frequencyName: String
    let efficiencyName: String

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            item(color: SpeedProfileChart.frequencyColor, label: frequencyName, isLine: false)
            item(color: SpeedProfileChart.efficiencyColor, label: efficiencyName, isLine: true)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(frequencyName), \(efficiencyName)"))
    }

    private func item(color: Color, label: String, isLine: Bool) -> some View {
        HStack(spacing: TSSpacing.xs) {
            swatch(color: color, isLine: isLine)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private func swatch(color: Color, isLine: Bool) -> some View {
        if isLine {
            Capsule().fill(color).frame(width: 12, height: 3)
        } else {
            RoundedRectangle(cornerRadius: 2, style: .continuous).fill(color).frame(width: 9, height: 9)
        }
    }
}

// MARK: - Composed chart (web `ComposedChart`: Bar + Line)

/// The speed-distribution chart: frequency `BarMark`s read on the leading percent
/// axis, with the average-power efficiency `LineMark` overlaid on a normalized
/// trailing axis (Swift Charts shares one y-domain, so the efficiency series is
/// scaled into the frequency band for drawing and the trailing axis is labelled
/// back in efficiency units). A 1:1 reproduction of the web Recharts composition.
struct SpeedProfileChart: View {
    let bars: [SpeedProfileBar]
    let isWide: Bool
    let frequencyName: String
    let efficiencyName: String
    let speedAxisName: String

    /// Frequency bars — the speed series color from the design tokens (P1/S9),
    /// the native counterpart of the web indigo bar fill.
    static let frequencyColor = Color.TS.chartSeriesSpeed
    /// Efficiency line — the energy series color (matches the web amber overlay).
    static let efficiencyColor = Color.TS.chartSeriesEnergy

    var body: some View {
        Chart {
            ForEach(bars) { bar in
                BarMark(
                    x: .value(speedAxisName, bar.bucket),
                    y: .value(frequencyName, bar.frequency)
                )
                .foregroundStyle(Self.frequencyColor.gradient)
                .cornerRadius(4)
                .accessibilityLabel(Text(verbatim: bar.bucket))
                .accessibilityValue(Text(verbatim: accessibilityValue(for: bar)))
            }
            ForEach(bars) { bar in
                LineMark(
                    x: .value(speedAxisName, bar.bucket),
                    y: .value(efficiencyName, normalizedEfficiency(bar.efficiency))
                )
                .foregroundStyle(Self.efficiencyColor)
                .interpolationMethod(.catmullRom)
                .lineStyle(StrokeStyle(lineWidth: 2))
                PointMark(
                    x: .value(speedAxisName, bar.bucket),
                    y: .value(efficiencyName, normalizedEfficiency(bar.efficiency))
                )
                .foregroundStyle(Self.efficiencyColor)
                .symbolSize(34)
            }
        }
        .chartXScale(domain: bars.map(\.bucket))
        .chartYScale(domain: 0 ... (frequencyMax * 1.15))
        .chartYAxis { yAxis }
        .chartXAxis { xAxis }
        .chartLegend(.hidden)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border)
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: "\(SpeedProfileNumberFormat.integer(number))%")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        AxisMarks(position: .trailing) { value in
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: efficiencyAxisLabel(number))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: axisBuckets) { value in
            AxisValueLabel {
                if let label = value.as(String.self) {
                    Text(verbatim: label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    // MARK: Derived plotting values

    /// The largest frequency share, floored to a tiny positive so the normalized
    /// efficiency mapping and the y-domain never divide by / collapse to zero.
    private var frequencyMax: Double {
        max(bars.map(\.frequency).max() ?? 0, 0.0001)
    }

    /// The largest efficiency value, floored to a tiny positive for the same reason.
    private var efficiencyUpper: Double {
        max(bars.map(\.efficiency).max() ?? 0, 0.0001)
    }

    /// Scales an efficiency value into the frequency band so the overlaid line
    /// shares the chart's single y-domain.
    private func normalizedEfficiency(_ efficiency: Double) -> Double {
        (efficiency / efficiencyUpper) * frequencyMax
    }

    /// De-normalizes a trailing-axis tick (in frequency units) back to its real
    /// efficiency value for the label (web right-axis `tickFormatter`).
    private func efficiencyAxisLabel(_ axisValue: Double) -> String {
        SpeedProfileNumberFormat.integer((axisValue / frequencyMax) * efficiencyUpper)
    }

    /// The bucket labels shown on the x-axis: all of them on a wide widget,
    /// evenly thinned on a narrow one so the labels never collide (web swaps
    /// `axisTick` ↔ `axisTickSm` by width for the same reason).
    private var axisBuckets: [String] {
        let labels = bars.map(\.bucket)
        let limit = isWide ? 8 : 5
        guard labels.count > limit else { return labels }
        let stride = Int(ceil(Double(labels.count) / Double(limit)))
        return labels.enumerated().filter { $0.offset.isMultiple(of: stride) }.map(\.element)
    }

    /// The per-bar VoiceOver value: frequency share + efficiency overlay value.
    private func accessibilityValue(for bar: SpeedProfileBar) -> String {
        let frequency = SpeedProfileNumberFormat.percent(bar.frequency)
        let efficiency = SpeedProfileNumberFormat.integer(bar.efficiency)
        return "\(frequency), \(efficiency) \(efficiencyName)"
    }
}
