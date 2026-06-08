//
//  DriveOverviewChart.Chart.swift
//  TeslaSync — P4 feature view · 0138 · DriveOverviewChart (Apple)
//
//  The composed Swift Charts trace (web Recharts `ComposedChart` → native `Chart` with
//  an `AreaMark` + layered `LineMark`s) plus the synced-cursor `RuleMark` (web
//  `useSyncedReferenceLineX`) and its value tooltip (web `ChartTooltip`). The hidden
//  left axis (web `<YAxis yAxisId="speed" hide />`) carries speed / range / SOC on one
//  shared scale; power is rescaled onto that scale and labeled by a trailing "kW" axis
//  (web right `<YAxis unit=" kW" />`). Split out of Views.swift to keep both files
//  within the file-length budget. Token-driven (P1/S9), localized via P1/S10.
//

import Charts
import SwiftUI

// MARK: - Series styling (web hex strokes)

/// Series → SwiftUI color, parsed from the web hex each `DriveSeriesKind` carries so the
/// native trace matches the web stroke palette exactly.
enum DriveOverviewStyle {
    static func color(_ kind: DriveSeriesKind) -> Color {
        color(hex: kind.hex)
    }

    /// Parses a `#rrggbb` hex (the only form the series use) into an sRGB `Color`,
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

// MARK: - Chart (web Recharts `ComposedChart`)

/// The composed drive trace — the native counterpart of the web `ComposedChart`. Time
/// on x (labeled at the endpoints, web `interval="preserveStartEnd"`), the hidden
/// left-axis overlay (speed area + range/SOC lines) plus the rescaled power line on the
/// trailing "kW" axis. Tapping snaps the synced cursor and reveals a value tooltip.
struct DriveOverviewChartView: View {
    let samples: [DriveChartSample]
    let units: DriveUnitLabels
    @Binding var cursorIndex: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var primary: ClosedRange<Double> {
        DriveOverviewProjection.primaryDomain(samples) ?? 0 ... 1
    }

    private var power: ClosedRange<Double> {
        DriveOverviewProjection.powerDomain(samples) ?? 0 ... 1
    }

    private var cursorSample: DriveChartSample? {
        guard let cursorIndex else { return nil }
        return samples.first { $0.index == cursorIndex }
    }

    var body: some View {
        Chart {
            speedMarks
            if DriveOverviewProjection.hasIdealRange(samples) { rangeMarks(.idealRange) }
            if DriveOverviewProjection.hasEstOrRated(samples) { rangeMarks(.estRange) }
            socMarks
            if DriveOverviewProjection.hasUsableSoc(samples) { thinLineMarks(.usableSoc) }
            powerMarks
            cursorMark
        }
        .chartYScale(domain: primary.lowerBound ... primary.upperBound)
        .chartXSelection(value: $cursorIndex)
        .chartYAxis { trailingPowerAxis }
        .chartXAxis { endpointTimeAxis }
        .chartLegend(.hidden)
        .frame(height: 360)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: samples)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            DriveOverviewStrings.text(
                "driveDetail.driveChart.aria",
                "Drive overview composed chart of speed, range, SOC and power over time"
            )
        )
    }

    // MARK: Marks

    /// The speed series: a low-opacity gradient area (web `areaGradient(_, 0.08)`) with
    /// a 1.5 pt monotone stroke (web `<Area strokeWidth={1.5}>`).
    @ChartContentBuilder
    private var speedMarks: some ChartContent {
        ForEach(samples) { sample in
            AreaMark(
                x: .value(seriesLabel(.speed), sample.index),
                y: .value(seriesLabel(.speed), sample.speed)
            )
            .interpolationMethod(.monotone)
            .foregroundStyle(
                .linearGradient(
                    colors: [DriveOverviewStyle.color(.speed).opacity(0.18), .clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
        ForEach(samples) { sample in
            LineMark(
                x: .value(seriesLabel(.speed), sample.index),
                y: .value(seriesLabel(.speed), sample.speed)
            )
            .interpolationMethod(.monotone)
            .lineStyle(StrokeStyle(lineWidth: 1.5))
            .foregroundStyle(DriveOverviewStyle.color(.speed))
        }
    }

    /// A dashed 1 pt range line (web `<Line strokeWidth={1} strokeDasharray="4 2">`),
    /// skipping samples without a value so the line breaks like the web series.
    @ChartContentBuilder
    private func rangeMarks(_ kind: DriveSeriesKind) -> some ChartContent {
        ForEach(samples) { sample in
            if let value = DriveOverviewProjection.value(of: kind, at: sample) {
                LineMark(
                    x: .value(seriesLabel(kind), sample.index),
                    y: .value(seriesLabel(kind), value)
                )
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 2]))
                .foregroundStyle(DriveOverviewStyle.color(kind))
            }
        }
    }

    /// The SOC series: a 1.5 pt monotone line over `battery` (web `<Line dataKey="battery">`).
    @ChartContentBuilder
    private var socMarks: some ChartContent {
        ForEach(samples) { sample in
            LineMark(
                x: .value(seriesLabel(.soc), sample.index),
                y: .value(seriesLabel(.soc), sample.battery)
            )
            .interpolationMethod(.monotone)
            .lineStyle(StrokeStyle(lineWidth: 1.5))
            .foregroundStyle(DriveOverviewStyle.color(.soc))
        }
    }

    /// A thin 1 pt line for a present optional series (usable SOC).
    @ChartContentBuilder
    private func thinLineMarks(_ kind: DriveSeriesKind) -> some ChartContent {
        ForEach(samples) { sample in
            if let value = DriveOverviewProjection.value(of: kind, at: sample) {
                LineMark(
                    x: .value(seriesLabel(kind), sample.index),
                    y: .value(seriesLabel(kind), value)
                )
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 1))
                .foregroundStyle(DriveOverviewStyle.color(kind))
            }
        }
    }

    /// The power series, rescaled onto the hidden primary scale (web right-axis line).
    @ChartContentBuilder
    private var powerMarks: some ChartContent {
        ForEach(samples) { sample in
            LineMark(
                x: .value(seriesLabel(.power), sample.index),
                y: .value(seriesLabel(.power), plottedPower(sample.power))
            )
            .interpolationMethod(.monotone)
            .lineStyle(StrokeStyle(lineWidth: 1.5))
            .foregroundStyle(DriveOverviewStyle.color(.power))
        }
    }

    /// The synced-cursor reference line + its value tooltip (web `ReferenceLine` +
    /// `ChartTooltip`), shown only when a sample is selected.
    @ChartContentBuilder
    private var cursorMark: some ChartContent {
        if let cursorSample {
            RuleMark(x: .value(seriesLabel(.speed), cursorSample.index))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 2]))
                .foregroundStyle(Color.TS.textMuted)
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    DriveOverviewTooltip(sample: cursorSample, samples: samples, units: units)
                }
        }
    }

    // MARK: Axes

    /// The trailing power axis: framework ticks relabeled to kW via the inverse rescale
    /// (web right `<YAxis unit=" kW" />`), with a dashed horizontal grid (web grid "3 3").
    private var trailingPowerAxis: some AxisContent {
        AxisMarks(position: .trailing) { mark in
            AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let plotted = mark.as(Double.self) {
                    let kilowatts = DriveOverviewProjection.power(
                        forPlotted: plotted,
                        primary: primary,
                        power: power
                    )
                    Text(verbatim: "\(Int(kilowatts.rounded())) kW")
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    /// The x axis: only the first + last time labels (web `interval="preserveStartEnd"`).
    private var endpointTimeAxis: some AxisContent {
        AxisMarks(values: endpointIndices) { mark in
            AxisValueLabel {
                if let index = mark.as(Int.self), let label = timeLabel(for: index) {
                    Text(verbatim: label)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    // MARK: Helpers

    private var endpointIndices: [Int] {
        guard let first = samples.first?.index, let last = samples.last?.index, first != last else {
            return samples.first.map { [$0.index] } ?? []
        }
        return [first, last]
    }

    private func timeLabel(for index: Int) -> String? {
        samples.first { $0.index == index }?.time
    }

    private func plottedPower(_ value: Double) -> Double {
        DriveOverviewProjection.rescale(power: value, from: power, onto: primary)
    }

    private func seriesLabel(_ kind: DriveSeriesKind) -> String {
        DriveOverviewStrings.string(kind.localizationKey, kind.titleFallback)
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the sample's time header over each present series' value at
/// that sample — the native parity of the web `ChartTooltip` payload list.
struct DriveOverviewTooltip: View {
    let sample: DriveChartSample
    let samples: [DriveChartSample]
    let units: DriveUnitLabels

    private var kinds: [DriveSeriesKind] {
        DriveOverviewProjection.plottedKinds(samples)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: sample.time)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(kinds) { kind in
                if let value = DriveOverviewProjection.value(of: kind, at: sample) {
                    HStack(spacing: TSSpacing.sm) {
                        Circle()
                            .fill(DriveOverviewStyle.color(kind))
                            .frame(width: 7, height: 7)
                        DriveOverviewStrings.text(kind.localizationKey, kind.titleFallback)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                            .lineLimit(1)
                        Spacer(minLength: TSSpacing.md)
                        Text(verbatim: tooltipValue(kind, value))
                            .font(Font.TS.caption)
                            .fontWeight(.semibold)
                            .monospacedDigit()
                            .foregroundStyle(Color.TS.textPrimary)
                    }
                }
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(minWidth: 168, maxWidth: 248, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    /// Formats a series value for the tooltip with its display unit suffix.
    private func tooltipValue(_ kind: DriveSeriesKind, _ value: Double) -> String {
        switch kind.unitSuffix {
        case .speed: "\(DriveNumberFormat.number(value, fractionDigits: 1)) \(units.speed)"
        case .distance: "\(DriveNumberFormat.int(value)) \(units.distance)"
        case .percent: DriveNumberFormat.percent(value, fractionDigits: 0)
        case .kilowatt: DriveNumberFormat.withUnit(value, unit: "kW", fractionDigits: 1)
        }
    }
}
