//
//  SignalChartPanel.Chart.swift
//  TeslaSync — P4 feature view · 0266 · SignalChartPanel (Apple)
//
//  The overlay trace — the native counterpart of the web Recharts multi-line
//  `LineChart`. Time on the x axis (labeled at the endpoints, web
//  `tickFormatter={formatTime}`), every series on a shared left scale except series
//  index 1, which is rescaled onto that scale and relabeled by a trailing axis when
//  the auto dual-axis decision fires (web `useRightAxis` → `yAxisId="right"`).
//  Tapping snaps a synced cursor and reveals a value tooltip (web `ChartTooltip`);
//  a circle-dot legend sits below (web `<Legend iconType="circle">`). Series colors
//  come from the shared brand palette (web `CHART_COLORS[i]`); animation is
//  suppressed in live mode (web `isAnimationActive={!isLive}`).
//

import Charts
import SwiftUI

// MARK: - Overlay chart (web multi-line `LineChart`)

struct SignalChartOverlay: View {
    let samples: [SignalChartSample]
    let selectedSignals: [String]
    let useRightAxis: Bool
    let isLive: Bool
    let height: CGFloat

    @State private var selectedIndex: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var rightIndex: Int? {
        SignalChartBuilder.rightAxisIndex(useRightAxis: useRightAxis, selectedCount: selectedSignals.count)
    }

    private var leftSignals: [String] {
        selectedSignals.enumerated().filter { $0.offset != rightIndex }.map(\.element)
    }

    private var leftDomain: ClosedRange<Double> {
        SignalChartBuilder.domain(for: leftSignals, in: samples) ?? 0 ... 1
    }

    private var rightDomain: ClosedRange<Double>? {
        guard let rightIndex else { return nil }
        return SignalChartBuilder.domain(for: [selectedSignals[rightIndex]], in: samples)
    }

    private var cursorSample: SignalChartSample? {
        guard let selectedIndex else { return nil }
        return samples.first { $0.index == selectedIndex }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            chart
            SignalChartLegend(signals: selectedSignals)
        }
    }

    private var chart: some View {
        Chart {
            ForEach(plottedSeries) { series in
                ForEach(series.points) { point in
                    LineMark(
                        x: .value("Time", point.index),
                        y: .value("Value", point.plotted)
                    )
                    .foregroundStyle(by: .value("Signal", series.name))
                    .interpolationMethod(.monotone)
                    .lineStyle(StrokeStyle(lineWidth: 1.5))
                }
            }
            cursorMark
        }
        .chartForegroundStyleScale(domain: selectedSignals, range: seriesColors)
        .chartYScale(domain: leftDomain.lowerBound ... leftDomain.upperBound)
        .chartXSelection(value: $selectedIndex)
        .chartLegend(.hidden)
        .chartXAxis { endpointTimeAxis }
        .chartYAxis { yAxis }
        .frame(height: height)
        .animation(animation, value: samples)
        .accessibilityLabel(Text(verbatim: SignalChartStrings.legendLabel))
    }

    private var animation: Animation? {
        reduceMotion || isLive ? nil : .easeInOut(duration: TSMotion.normalDuration)
    }

    private var seriesColors: [Color] {
        selectedSignals.indices.map { TSChartPalette.color(at: $0) }
    }

    // MARK: Marks

    private var plottedSeries: [SignalChartPlottedSeries] {
        selectedSignals.enumerated().map { offset, name in
            let isRight = offset == rightIndex
            let points = samples.compactMap { sample -> SignalChartPlottedPoint? in
                guard let value = sample.values[name], value.isFinite else { return nil }
                let plotted = isRight ? plottedRight(value) : value
                return SignalChartPlottedPoint(index: sample.index, plotted: plotted)
            }
            return SignalChartPlottedSeries(name: name, points: points)
        }
    }

    private func plottedRight(_ value: Double) -> Double {
        guard let rightDomain else { return value }
        return SignalChartBuilder.rescale(value, from: rightDomain, onto: leftDomain)
    }

    @ChartContentBuilder
    private var cursorMark: some ChartContent {
        if let cursorSample {
            RuleMark(x: .value("Time", cursorSample.index))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 2]))
                .foregroundStyle(Color.TS.textMuted)
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    SignalChartTooltip(sample: cursorSample, selectedSignals: selectedSignals)
                }
        }
    }

    // MARK: Axes

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine(stroke: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                .foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: TSChartFormat.axisLabel(number))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        if useRightAxis, let rightDomain {
            AxisMarks(position: .trailing) { value in
                AxisValueLabel {
                    if let plotted = value.as(Double.self) {
                        let mapped = SignalChartBuilder.rescale(plotted, from: leftDomain, onto: rightDomain)
                        Text(verbatim: TSChartFormat.axisLabel(mapped))
                            .font(Font.TS.label)
                            .foregroundStyle(TSChartPalette.color(at: 1))
                    }
                }
            }
        }
    }

    @AxisContentBuilder
    private var endpointTimeAxis: some AxisContent {
        AxisMarks(values: SignalChartBuilder.endpointIndices(samples)) { value in
            AxisValueLabel {
                if let index = value.as(Int.self), let label = timeLabel(for: index) {
                    Text(verbatim: label)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private func timeLabel(for index: Int) -> String? {
        guard let sample = samples.first(where: { $0.index == index }) else { return nil }
        guard let timestamp = sample.timestamp else { return sample.timestampRaw }
        return SignalChartFormat.time(from: timestamp)
    }
}

// MARK: - Plotted value types

/// One series ready to plot: its name (the foreground-scale key) and its finite,
/// already-rescaled points.
private struct SignalChartPlottedSeries: Identifiable {
    let name: String
    let points: [SignalChartPlottedPoint]

    var id: String {
        name
    }
}

/// One plotted point: the x index and the y value already mapped onto the shared
/// left scale (raw for left-axis series, rescaled for the right-axis series).
private struct SignalChartPlottedPoint: Identifiable {
    let index: Int
    let plotted: Double

    var id: Int {
        index
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The synced-cursor tooltip: the sample's time header over each present series'
/// raw value at that sample — the native parity of the web `ChartTooltip` payload.
struct SignalChartTooltip: View {
    let sample: SignalChartSample
    let selectedSignals: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: timeHeader)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(Array(selectedSignals.enumerated()), id: \.element) { offset, name in
                if let value = sample.values[name], value.isFinite {
                    row(name: name, value: value, colorIndex: offset)
                }
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(minWidth: 148, maxWidth: 232, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private var timeHeader: String {
        guard let timestamp = sample.timestamp else { return sample.timestampRaw }
        return SignalChartFormat.time(from: timestamp)
    }

    private func row(name: String, value: Double, colorIndex: Int) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Circle().fill(TSChartPalette.color(at: colorIndex)).frame(width: 7, height: 7)
            Text(verbatim: name)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: SignalChartNumber.tooltip(value))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
    }
}

// MARK: - Legend (web `<Legend iconType="circle">`)

/// The circle-dot legend below the overlay chart — one chip per series with its
/// palette color and name (web `<Legend>` after the chart body).
struct SignalChartLegend: View {
    let signals: [String]

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 104), spacing: TSSpacing.sm, alignment: .leading)],
            alignment: .leading,
            spacing: TSSpacing.xs
        ) {
            ForEach(Array(signals.enumerated()), id: \.element) { offset, name in
                HStack(spacing: TSSpacing.xs) {
                    Circle().fill(TSChartPalette.color(at: offset)).frame(width: 7, height: 7)
                    Text(verbatim: name)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: name))
            }
        }
        .accessibilityLabel(Text(verbatim: SignalChartStrings.legendLabel))
    }
}

// MARK: - Tooltip number format

/// The tooltip value format (web `ChartTooltip` → `fmtNumber`): locale-grouped with
/// up to two fraction digits, trailing zeros trimmed.
enum SignalChartNumber {
    static func tooltip(_ value: Double, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 2
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}
