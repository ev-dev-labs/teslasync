//
//  TripReplayCharts.Chart.swift
//  TeslaSync — P4 feature view · 0273 · TripReplayCharts (Apple)
//
//  The Swift Charts dual-axis area trace + its value tooltip — the native counterpart of
//  the web Recharts `AreaChart` in features/trips/components/TripReplayCharts.tsx (a
//  speed `<Area yAxisId="speed">` on a left axis + a power `<Area yAxisId="power">` on a
//  right "kW" axis, with a dashed playhead `<ReferenceLine>`). Split out of the chrome in
//  TripReplayCharts.Views.swift so both files stay within the file-length budget. Copy
//  resolves through the P1/S10 facade; chrome is token-driven (P1/S9). No networking here.
//
//  Recharts → Swift Charts mapping: Swift Charts carries one y-scale per `Chart`, so the
//  web's dual y-axes are reproduced by keeping the LEFT scale in the speed unit and
//  projecting the power area into that same domain (`projectedPower`) while a TRAILING
//  `AxisMarks` reads the true kW values back out — a real second axis, not a collapsed
//  one. The two areas draw `stacking: .unstacked` so they overlap from the shared
//  baseline (web independent axes). The synced-cursor seek (web `useSyncedCursor` /
//  `useSyncedReferenceLineX` → `onSeekToIndex`) is a `RuleMark` at the playhead time plus
//  a `.chartXSelection` that forwards the scrubbed time through `onScrub`.
//

import Charts
import SwiftUI

// MARK: - Chart (web Recharts dual-axis `AreaChart`)

/// The speed + power area trace. Speed (left axis, the user's unit) and power (right axis,
/// kW — projected into the speed domain) draw as overlapping unstacked areas with crisp
/// top strokes; the dashed playhead reference line marks `currentPosition` and reveals a
/// per-sample tooltip; tapping / scrubbing forwards the nearest sample's time to `onScrub`.
struct TripReplayTimelineChart: View {
    let samples: [TripReplaySample]
    let speedUnit: String
    let currentPosition: Int
    let onScrub: (Double) -> Void
    let locale: Locale

    @State private var rawSelection: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var primary: ClosedRange<Double> {
        TripReplayChartsProjection.speedDomain(samples) ?? 0 ... 1
    }

    private var powerRange: ClosedRange<Double> {
        TripReplayChartsProjection.powerDomain(samples) ?? 0 ... 1
    }

    private var timeRange: ClosedRange<Double> {
        TripReplayChartsProjection.timeDomain(samples) ?? 0 ... 1
    }

    private var cursorTime: Double? {
        TripReplayChartsProjection.cursorTime(forPosition: currentPosition, in: samples)
    }

    private var cursorSample: TripReplaySample? {
        TripReplayChartsProjection.sample(at: currentPosition, in: samples)
    }

    var body: some View {
        Chart {
            speedMarks
            powerMarks
            playheadMark
        }
        .chartYScale(domain: primary.lowerBound ... primary.upperBound)
        .chartXScale(domain: timeRange.lowerBound ... timeRange.upperBound)
        .chartXSelection(value: $rawSelection)
        .onChange(of: rawSelection) { _, newValue in
            if let time = newValue { onScrub(time) }
        }
        .chartYAxis { yAxisMarks }
        .chartXAxis { xAxisMarks }
        .chartYAxisLabel(position: .leading, alignment: .center) {
            Text(verbatim: speedUnit).font(Font.TS.label).foregroundStyle(Color.TS.chartSeriesSpeed)
        }
        .chartYAxisLabel(position: .trailing, alignment: .center) {
            Text(verbatim: TripReplayFormat.powerUnit).font(Font.TS.label).foregroundStyle(Color.TS.chartSeriesPower)
        }
        .chartLegend(.hidden)
        .frame(height: 220)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: samples)
        .accessibilityElement()
        .accessibilityLabel(
            TripReplayChartsStrings.text(
                "replay.timeline.aria",
                "Trip replay speed and power timeline area chart"
            )
        )
        .accessibilityValue(Text(verbatim: accessibilitySummary))
    }

    // MARK: Marks

    /// The speed series: a low-opacity gradient area (web `url(#speedGrad)`) under a 2 pt
    /// monotone stroke, both on the left-axis scale.
    @ChartContentBuilder
    private var speedMarks: some ChartContent {
        ForEach(samples) { sample in
            AreaMark(
                x: .value(timeAxisName, sample.time),
                y: .value(speedSeriesName, sample.speed),
                series: .value(seriesAxisName, "speed"),
                stacking: .unstacked
            )
            .interpolationMethod(.monotone)
            .foregroundStyle(gradient(Color.TS.chartSeriesSpeed))
        }
        ForEach(samples) { sample in
            LineMark(
                x: .value(timeAxisName, sample.time),
                y: .value(speedSeriesName, sample.speed),
                series: .value(seriesAxisName, "speed")
            )
            .interpolationMethod(.monotone)
            .lineStyle(StrokeStyle(lineWidth: 2))
            .foregroundStyle(Color.TS.chartSeriesSpeed)
        }
    }

    /// The power series (web `url(#powerGrad)`), projected onto the left-axis scale so it
    /// shares one y-domain; relabeled back to kW by the trailing axis.
    @ChartContentBuilder
    private var powerMarks: some ChartContent {
        ForEach(samples) { sample in
            AreaMark(
                x: .value(timeAxisName, sample.time),
                y: .value(powerSeriesName, projectedPower(sample.power)),
                series: .value(seriesAxisName, "power"),
                stacking: .unstacked
            )
            .interpolationMethod(.monotone)
            .foregroundStyle(gradient(Color.TS.chartSeriesPower))
        }
        ForEach(samples) { sample in
            LineMark(
                x: .value(timeAxisName, sample.time),
                y: .value(powerSeriesName, projectedPower(sample.power)),
                series: .value(seriesAxisName, "power")
            )
            .interpolationMethod(.monotone)
            .lineStyle(StrokeStyle(lineWidth: 2))
            .foregroundStyle(Color.TS.chartSeriesPower)
        }
    }

    /// The dashed playhead reference line (web `<ReferenceLine x={data[currentIndex].time}
    /// stroke="#00b4d8" strokeDasharray="4 2">`) + its value tooltip, shown only when the
    /// playhead maps to a sample.
    @ChartContentBuilder
    private var playheadMark: some ChartContent {
        if let cursorTime {
            RuleMark(x: .value(timeAxisName, cursorTime))
                .foregroundStyle(Color.TS.accent)
                .lineStyle(StrokeStyle(lineWidth: 2, dash: [4, 2]))
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    if let cursorSample {
                        TripReplayTimelineTooltip(sample: cursorSample, speedUnit: speedUnit, locale: locale)
                    }
                }
        }
    }

    // MARK: Axes

    @AxisContentBuilder
    private var yAxisMarks: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.35))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: TripReplayFormat.number(number, fractionDigits: 0, locale: locale))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.chartSeriesSpeed)
                }
            }
        }
        AxisMarks(position: .trailing, values: trailingPowerPositions) { value in
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: powerAxisLabel(atPlotted: number))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.chartSeriesPower)
                }
            }
        }
    }

    @AxisContentBuilder
    private var xAxisMarks: some AxisContent {
        AxisMarks(values: TripReplayChartsProjection.evenlySpacedValues(in: timeRange)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.2))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: TripReplayFormat.minutesAxisLabel(number, locale: locale))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    // MARK: Helpers

    private var timeAxisName: String {
        TripReplayChartsStrings.string("replay.timeline.timeAxis", "Time")
    }

    private var speedSeriesName: String {
        TripReplayChartsStrings.string("replay.timeline.speed", "Speed")
    }

    private var powerSeriesName: String {
        TripReplayChartsStrings.string("replay.timeline.power", "Power")
    }

    private var seriesAxisName: String {
        TripReplayChartsStrings.string("replay.timeline.series", "Series")
    }

    private var accessibilitySummary: String {
        TripReplayChartsAccessibility.chartSummary(
            samples: samples,
            speedUnit: speedUnit,
            localize: TripReplayChartsStrings.string,
            locale: locale
        )
    }

    /// Speed/power gradient (web `areaGradient`): a token tint fading to near-transparent.
    private func gradient(_ color: Color) -> LinearGradient {
        LinearGradient(
            colors: [color.opacity(0.28), color.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// Evenly spaced positions on the primary (speed) scale where the trailing kW axis
    /// places its ticks; each is relabeled to its true power value.
    private var trailingPowerPositions: [Double] {
        TripReplayChartsProjection.evenlySpacedValues(in: primary, count: 5)
    }

    private func projectedPower(_ value: Double) -> Double {
        TripReplayChartsProjection.rescale(power: value, from: powerRange, onto: primary)
    }

    private func powerAxisLabel(atPlotted plotted: Double) -> String {
        let kilowatts = TripReplayChartsProjection.power(forPlotted: plotted, primary: primary, power: powerRange)
        return TripReplayFormat.number(kilowatts, fractionDigits: 0, locale: locale)
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The playhead tooltip: the sample's minute header over its speed + power values — the
/// native parity of the web `Tooltip` payload (`labelFormatter` + the two series).
struct TripReplayTimelineTooltip: View {
    let sample: TripReplaySample
    let speedUnit: String
    let locale: Locale

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: TripReplayFormat.minutesTooltip(sample.time, locale: locale))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            row(
                color: Color.TS.chartSeriesSpeed,
                key: "replay.timeline.speed",
                fallback: "Speed",
                value: TripReplayFormat.speed(sample.speed, unit: speedUnit, locale: locale)
            )
            row(
                color: Color.TS.chartSeriesPower,
                key: "replay.timeline.power",
                fallback: "Power",
                value: TripReplayFormat.power(sample.power, locale: locale)
            )
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(minWidth: 168, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func row(color: Color, key: String, fallback: String, value: String) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Circle().fill(color).frame(width: 7, height: 7)
            TripReplayChartsStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: value)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
    }
}
