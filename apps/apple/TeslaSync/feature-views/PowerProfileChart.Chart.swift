//
//  PowerProfileChart.Chart.swift
//  TeslaSync — P4 feature view · 0146 · PowerProfileChart (Apple)
//
//  The Swift Charts power trace (web Recharts `AreaChart` → native `Chart` with a
//  zero-anchored `AreaMark` + an overlaid `LineMark`), the zero baseline (web
//  `<ReferenceLine y={0}>`), and the synced-cursor `RuleMark` (web
//  `useSyncedReferenceLineX`) with its value tooltip (web `ChartTooltip`). The area is
//  anchored at zero so drive power fills above the baseline and regeneration fills below,
//  the native-idiomatic reading of a signed power profile. Split out of Views.swift to
//  keep both files within the file-length budget. Token-driven (P1/S9), localized via
//  P1/S10.
//

import Charts
import SwiftUI

// MARK: - Series styling (web hex strokes)

/// The surface's data-viz colors, parsed from the web hex values so the native trace
/// matches the web palette exactly: the amber power stroke (`#f59e0b`) and the amber /
/// cyan footer accents the web prints for "Max Power" (`text-amber-400`) and "Max Regen"
/// (`text-cyan-400`).
enum PowerProfileStyle {
    /// Web area + line stroke (`#f59e0b`, amber-500).
    static let powerHex = "#f59e0b"
    /// Web "Max Power" value color (`text-amber-400`).
    static let maxPowerHex = "#fbbf24"
    /// Web "Max Regen" value color (`text-cyan-400`).
    static let maxRegenHex = "#22d3ee"

    static var power: Color {
        color(hex: powerHex)
    }

    static var maxPower: Color {
        color(hex: maxPowerHex)
    }

    static var maxRegen: Color {
        color(hex: maxRegenHex)
    }

    /// Parses a `#rrggbb` hex (the only form the surface uses) into an sRGB `Color`,
    /// falling back to the accent token for any malformed value.
    static func color(hex: String) -> Color {
        var hexValue = hex
        if hexValue.hasPrefix("#") { hexValue.removeFirst() }
        guard hexValue.count == 6, let rgb = UInt32(hexValue, radix: 16) else {
            return Color.TS.accent
        }
        let red = Double((rgb >> 16) & 0xFF) / 255
        let green = Double((rgb >> 8) & 0xFF) / 255
        let blue = Double(rgb & 0xFF) / 255
        return Color(.sRGB, red: red, green: green, blue: blue, opacity: 1)
    }
}

// MARK: - Chart (web Recharts `AreaChart`)

/// The power trace — the native counterpart of the web `AreaChart`. Time on x (labeled at
/// the endpoints, web `interval="preserveStartEnd"`), a kW y-axis (web left `<YAxis>`),
/// the amber zero-anchored area + stroke, and the zero baseline. Tapping snaps the synced
/// cursor and reveals a value tooltip.
struct PowerProfileChartView: View {
    let samples: [PowerProfileSample]
    @Binding var cursorIndex: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var domain: ClosedRange<Double> {
        PowerProfileProjection.powerDomain(samples) ?? 0 ... 1
    }

    private var cursorSample: PowerProfileSample? {
        guard let cursorIndex else { return nil }
        return samples.first { $0.index == cursorIndex }
    }

    private var powerLabel: String {
        PowerProfileStrings.string("driveDetail.power", "Power")
    }

    var body: some View {
        Chart {
            areaMarks
            lineMarks
            zeroRule
            cursorMark
        }
        .chartYScale(domain: domain.lowerBound ... domain.upperBound)
        .chartXSelection(value: $cursorIndex)
        .chartXAxis { endpointTimeAxis }
        .chartYAxis { kilowattAxis }
        .chartLegend(.hidden)
        .frame(height: 220)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: samples)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            PowerProfileStrings.text(
                "driveDetail.powerProfile.aria",
                "Drive power profile area chart over time"
            )
        )
    }

    // MARK: Marks

    /// The zero-anchored gradient area (web `areaGradient('powerGrad', '#f59e0b')`, top
    /// opacity 0.3 → 0.02): fills up from the zero baseline for drive power and down for
    /// regeneration.
    @ChartContentBuilder
    private var areaMarks: some ChartContent {
        ForEach(samples) { sample in
            AreaMark(
                x: .value(powerLabel, sample.index),
                yStart: .value(powerLabel, 0),
                yEnd: .value(powerLabel, sample.power)
            )
            .interpolationMethod(.monotone)
            .foregroundStyle(
                .linearGradient(
                    colors: [PowerProfileStyle.power.opacity(0.30), PowerProfileStyle.power.opacity(0.02)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
    }

    /// The 2 pt monotone power stroke (web `<Area strokeWidth={2}>`).
    @ChartContentBuilder
    private var lineMarks: some ChartContent {
        ForEach(samples) { sample in
            LineMark(
                x: .value(powerLabel, sample.index),
                y: .value(powerLabel, sample.power)
            )
            .interpolationMethod(.monotone)
            .lineStyle(StrokeStyle(lineWidth: 2))
            .foregroundStyle(PowerProfileStyle.power)
        }
    }

    /// The zero baseline (web `<ReferenceLine y={0} stroke="rgba(255,255,255,0.15)">`).
    @ChartContentBuilder
    private var zeroRule: some ChartContent {
        RuleMark(y: .value(powerLabel, 0))
            .lineStyle(StrokeStyle(lineWidth: 1))
            .foregroundStyle(Color.TS.textMuted.opacity(0.35))
    }

    /// The synced-cursor reference line + its value tooltip (web `ReferenceLine` +
    /// `ChartTooltip`), shown only when a sample is selected.
    @ChartContentBuilder
    private var cursorMark: some ChartContent {
        if let cursorSample {
            RuleMark(x: .value(powerLabel, cursorSample.index))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 2]))
                .foregroundStyle(Color.TS.textMuted)
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    PowerProfileTooltip(sample: cursorSample)
                }
        }
    }

    // MARK: Axes

    /// The leading kW axis (web left `<YAxis>`), with a dashed horizontal grid (web grid
    /// "3 3").
    private var kilowattAxis: some AxisContent {
        AxisMarks(position: .leading) { mark in
            AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let value = mark.as(Double.self) {
                    Text(verbatim: "\(Int(value.rounded())) kW")
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    /// The x axis: only the first + last time labels (web `interval="preserveStartEnd"`).
    private var endpointTimeAxis: some AxisContent {
        AxisMarks(values: PowerProfileProjection.endpointIndices(samples)) { mark in
            AxisValueLabel {
                if let index = mark.as(Int.self), let label = timeLabel(for: index) {
                    Text(verbatim: label)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private func timeLabel(for index: Int) -> String? {
        samples.first { $0.index == index }?.time
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the sample's time header over the power value at that sample —
/// the native parity of the web `ChartTooltip` payload.
struct PowerProfileTooltip: View {
    let sample: PowerProfileSample

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: sample.time)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle()
                    .fill(PowerProfileStyle.power)
                    .frame(width: 7, height: 7)
                PowerProfileStrings.text("driveDetail.power", "Power")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: PowerNumberFormat.kilowatt(sample.power))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(minWidth: 140, maxWidth: 220, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
