//
//  FSMTimelineChart.Chart.swift
//  TeslaSync — P4 feature view · 0231 · FSMTimelineChart (Apple)
//
//  The Swift Charts composition for the "Transitions Over Time" surface — the native
//  counterpart of the web Recharts stacked `AreaChart` in
//  features/system/components/FSMTimelineChart.tsx. One translucent, monotone-
//  interpolated `AreaMark` band per FSM name (web `<Area type="monotone" stackId="1"
//  fillOpacity={0.3}>`) is stacked over a time grid; series colors come from the
//  brand categorical palette so their indices line up 1:1 with the web `CHART_COLORS`
//  (both are the Okabe-Ito CVD-safe set). The x is the chronological bucket index
//  rendered with its "HH:mm" label (web categorical `time` axis); the y is the
//  stacked transition count (web `allowDecimals={false}`); tapping the plot drops a
//  hover tooltip listing each FSM's count (web `<Tooltip>`). A bottom legend maps
//  color → FSM (the web chart has none — added here so touch / VoiceOver users can
//  read the stack). Token-driven (P1/S9); copy via the P1/S10 facade.
//

import Charts
import SwiftUI

// MARK: - Chart (web Recharts stacked `AreaChart`)

/// The stacked FSM-transition timeline. The y axis is the per-cell stacked count;
/// the x axis is the chronological bucket index labeled with its wall-clock "HH:mm".
struct FSMTimelineStackedChart: View {
    let buckets: [FSMTimelineBucket]
    let series: [FSMTimelineSeries]
    let points: [FSMTimelineAreaPoint]
    @Binding var selectedIndex: Int?
    let locale: Locale
    let accessibilitySummary: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Web `fillOpacity={0.3}` — the translucent stacked-band fill. The distinct
    /// CVD-safe palette colors keep the bands separable at this opacity (the web
    /// renders the same value); the grid stays readable through the stack.
    private static let fillOpacity: Double = 0.3

    private var timeAxisName: String {
        FSMTimelineChartStrings.string("fsm.timelineChart.axis.time", "Time")
    }

    private var countAxisName: String {
        FSMTimelineChartStrings.string("fsm.timelineChart.axis.count", "Transitions")
    }

    /// The sorted FSM names — the `chartForegroundStyleScale` domain (stable color +
    /// legend order, web sorted `fsmTypes`).
    private var seriesNames: [String] {
        series.map(\.name)
    }

    /// The palette color per series index (web `CHART_COLORS[i % len]`).
    private var seriesColors: [Color] {
        series.map { TSChartPalette.color(at: $0.index) }
    }

    /// The cell nearest the current selection (web `<Tooltip>` active datum).
    private var selectedBucket: FSMTimelineBucket? {
        FSMTimelineProjector.bucket(atIndex: selectedIndex, in: buckets)
    }

    var body: some View {
        Chart {
            areaMarks
            selectionRule
        }
        .chartForegroundStyleScale(domain: seriesNames, range: seriesColors)
        .chartYScale(domain: 0 ... Double(FSMTimelineProjector.maxStackHeight(buckets)))
        .chartXSelection(value: $selectedIndex)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .chartYAxisLabel(position: .leading, alignment: .center) {
            Text(verbatim: countAxisName)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
        .chartLegend(position: .bottom, alignment: .leading, spacing: TSSpacing.sm)
        .frame(height: 220)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: points)
        .accessibilityElement()
        .accessibilityLabel(
            FSMTimelineChartStrings.text(
                "fsm.timelineChart.aria",
                "FSM transitions over time stacked area chart"
            )
        )
        .accessibilityValue(Text(verbatim: accessibilitySummary))
    }

    /// One translucent, monotone-interpolated stacked band per FSM name (web
    /// `<Area type="monotone" stackId="1">`). Swift Charts stacks `AreaMark`s that
    /// share an x and differ by the `foregroundStyle(by:)` series.
    @ChartContentBuilder
    private var areaMarks: some ChartContent {
        ForEach(points) { point in
            AreaMark(
                x: .value(timeAxisName, point.bucketIndex),
                y: .value(countAxisName, point.count)
            )
            .foregroundStyle(by: .value(timeAxisName, point.series))
            .interpolationMethod(.monotone)
            .opacity(Self.fillOpacity)
        }
    }

    /// The hover tooltip reference line + card (web `<Tooltip>`).
    @ChartContentBuilder
    private var selectionRule: some ChartContent {
        if let selectedBucket {
            RuleMark(x: .value(timeAxisName, selectedBucket.index))
                .foregroundStyle(Color.TS.border)
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    FSMTimelineTooltip(bucket: selectedBucket, series: series, locale: locale)
                }
        }
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: .automatic(desiredCount: 6)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let index = value.as(Int.self), let match = buckets.first(where: { $0.index == index }) {
                    Text(verbatim: match.label)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: FSMTimelineFormat.axisCount(number, locale: locale))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }
}

// MARK: - Tooltip (web `<Tooltip>`)

/// The hover tooltip: the cell time over each active FSM's count and the column
/// total — the native parity of the web Recharts `<Tooltip>` stacked payload.
struct FSMTimelineTooltip: View {
    let bucket: FSMTimelineBucket
    let series: [FSMTimelineSeries]
    let locale: Locale

    private var activeSeries: [FSMTimelineSeries] {
        series.filter { bucket.count(for: $0.name) > 0 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: bucket.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            if activeSeries.isEmpty {
                FSMTimelineChartStrings.text("fsm.timelineChart.noneInBucket", "no transitions")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            } else {
                ForEach(activeSeries) { item in
                    row(item)
                }
                Divider().overlay(Color.TS.border)
                totalRow
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(minWidth: 148, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: FSMTimelineChartAccessibility.bucketValue(
                bucket,
                series: series,
                localize: FSMTimelineChartStrings.string,
                locale: locale
            ))
        )
    }

    private func row(_ item: FSMTimelineSeries) -> some View {
        HStack(spacing: TSSpacing.sm) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(TSChartPalette.color(at: item.index))
                .frame(width: 8, height: 8)
            Text(verbatim: item.name)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: FSMTimelineFormat.count(bucket.count(for: item.name), locale: locale))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
    }

    private var totalRow: some View {
        HStack(spacing: TSSpacing.sm) {
            FSMTimelineChartStrings.text("fsm.timelineChart.total", "total")
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: FSMTimelineFormat.count(bucket.total, locale: locale))
                .font(Font.TS.caption)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
    }
}
