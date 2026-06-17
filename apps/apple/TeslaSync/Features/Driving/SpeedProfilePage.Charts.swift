//
//  SpeedProfilePage.Charts.swift
//  TeslaSync — P4 feature view · P7 · driving/SpeedProfile (Apple) — Charts
//
//  The native first-party chart surfaces (never a WKWebView): the three hero speed
//  gauges (web `RadialGauge`, value + unit), the speed-distribution bar chart (web
//  Recharts `BarChart`) and the efficiency-vs-speed scatter (web `ScatterChart`).
//  Each bar / point keeps its web band color, mapped to the P2 chart-palette tokens;
//  speed (m/s) and consumption (Wh/km) convert to the user's unit at this render
//  boundary via `SpeedProfileFormat` (P1/S5).
//

import Charts
import SwiftUI

// MARK: - Hero gauge (web `RadialGauge` — value + unit + label)

/// A circular value gauge (web `RadialGauge`): an arc filled to `value / max`, the
/// converted speed + unit at the centre, and the label beneath. Native SwiftUI
/// (`Circle().trim`) with tokenized colors — never a WKWebView. Mirrors the shared
/// `TSRadialGauge` visual but renders a unit-bearing value instead of a percent.
struct SpeedProfileGauge: View {
    let value: Int
    let maxValue: Int
    let label: LocalizedStringKey
    let unit: String
    let tint: Color
    var size: CGFloat = 120

    private var fraction: Double {
        guard maxValue > 0 else { return 0 }
        return min(max(Double(value) / Double(maxValue), 0), 1)
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ZStack {
                Circle()
                    .stroke(Color.TS.border.opacity(0.3), lineWidth: 8)
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(tint, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text(verbatim: "\(value)")
                        .font(Font.TS.title)
                        .fontWeight(.bold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                .padding(.horizontal, TSSpacing.sm)
            }
            .frame(width: size, height: size)
            TSMetricLabel(label)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: "\(value) \(unit)"))
    }
}

// MARK: - Speed distribution bar chart (web `BarChart`)

/// The speed-bucket distribution bar chart (web Recharts `BarChart`): one `BarMark`
/// per bucket, tinted with the bucket's band color (green / cyan / amber / red →
/// palette tokens). The caller renders the empty state, so this always has bars.
struct SpeedDistributionChart: View {
    let buckets: [SpeedProfileBucket]

    private var rangeAxisLabel: String {
        String(localized: "translation.speedProfile.speed", defaultValue: "Speed")
    }

    private var timeAxisLabel: String {
        "% \(String(localized: "translation.speedProfile.timeSpent", defaultValue: "time"))"
    }

    var body: some View {
        Chart(buckets) { bucket in
            BarMark(
                x: .value(rangeAxisLabel, bucket.label),
                y: .value(timeAxisLabel, bucket.readings)
            )
            .foregroundStyle(SpeedProfileFormat.bucketColor(bucket.label).opacity(0.7))
            .cornerRadius(4)
        }
        .chartXAxis { categoryAxis }
        .chartYAxis { valueAxis }
        .frame(height: 280)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("translation.speedProfile.distribution.aria"))
        .accessibilityValue(Text(verbatim: accessibilityValue))
    }

    @AxisContentBuilder
    private var categoryAxis: some AxisContent {
        AxisMarks(values: .automatic) { value in
            AxisValueLabel {
                if let label = value.as(String.self) {
                    Text(verbatim: label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var valueAxis: some AxisContent {
        AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { _ in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel()
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private var accessibilityValue: String {
        let total = buckets.reduce(0) { $0 + $1.readings }
        return "\(buckets.count) · \(total)"
    }
}

// MARK: - Efficiency-vs-speed scatter (web `ScatterChart`)

/// The per-drive efficiency-versus-speed scatter (web Recharts `ScatterChart`): one
/// `PointMark` per drive, plotted in the user's speed + consumption units and tinted
/// by efficiency band (efficient → high consumption). The caller renders the empty
/// state, so this always has points.
struct SpeedEfficiencyScatterChart: View {
    let samples: [SpeedScatterSample]
    let units: UnitPreferences

    /// Web `scatterData` element resolved to display values + band color.
    private struct Point: Identifiable {
        let id: String
        let speed: Int
        let efficiency: Int
        let color: Color
    }

    private var points: [Point] {
        samples.map { sample in
            let displayEfficiency = SpeedProfileFormat.efficiencyDisplay(sample.efficiencyWhPerKm, units)
            return Point(
                id: sample.id,
                speed: SpeedProfileFormat.speedRounded(sample.speedMps, units),
                efficiency: SpeedProfileFormat.efficiencyRounded(sample.efficiencyWhPerKm, units),
                color: SpeedProfileFormat.scatterColor(displayEfficiency)
            )
        }
    }

    private var speedAxisLabel: String {
        String(localized: "translation.speedProfile.speed", defaultValue: "Speed")
    }

    private var efficiencyAxisLabel: String {
        SpeedProfileFormat.efficiencyUnit(units)
    }

    var body: some View {
        Chart(points) { point in
            PointMark(
                x: .value(speedAxisLabel, point.speed),
                y: .value(efficiencyAxisLabel, point.efficiency)
            )
            .foregroundStyle(point.color.opacity(0.75))
            .symbolSize(60)
        }
        .chartXAxis { numericAxis(position: .bottom) }
        .chartYAxis { numericAxis(position: .leading) }
        .frame(height: 240)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("translation.speedProfile.effVsSpeed.aria"))
        .accessibilityValue(Text(verbatim: "\(points.count)"))
    }

    @AxisContentBuilder
    private func numericAxis(position: AxisMarkPosition) -> some AxisContent {
        AxisMarks(position: position, values: .automatic(desiredCount: 4)) { _ in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel()
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}
