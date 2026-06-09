//
//  ClimateHistoryWidget.Chart.swift
//  TeslaSync — P4 dashboard widget · 0027 · ClimateHistoryWidget (Apple)
//
//  The Swift Charts composition (web Recharts `AreaChart`): two temperature areas
//  (Cabin / Outside) over time, each a gradient fill under a 2-pt stroke, bridging
//  null gaps (web `connectNulls`) with monotone interpolation. Pure presentation —
//  it receives the projection + layout flags and renders, with no data access of its
//  own. Colors come from the design tokens (web hex → chart-series token).
//

import Charts
import SwiftUI

/// One plotted point in a single series' line/area.
private struct ClimateMark: Identifiable {
    let id: String
    let time: Date
    let value: Double
}

/// The climate-history Swift Charts surface.
struct ClimateHistoryChart: View {
    let projection: ClimateHistoryProjection
    let showAxisTitles: Bool
    var timeLabel: (Date) -> String = { $0.formatted(date: .omitted, time: .shortened) }

    private var data: [ClimateChartDatum] {
        projection.data
    }

    var body: some View {
        Chart {
            ForEach(ClimateSeries.allCases, id: \.self) { series in
                areaSeries(series)
            }
            ForEach(ClimateSeries.allCases, id: \.self) { series in
                lineSeries(series)
            }
        }
        .chartXScale(domain: xDomain)
        .chartYScale(domain: projection.yDomain)
        .chartForegroundStyleScale(domain: seriesNames, range: seriesColors)
        .chartLegend(.hidden)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .overlay(alignment: .topTrailing) { unitTitle }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ClimateHistoryStrings.string(
            "widget.climateHistory.a11yChart",
            "Climate history chart"
        )))
        .accessibilityValue(Text(verbatim: ClimateHistoryAccessibility.summary(for: projection)))
    }

    // MARK: Series

    /// The translucent gradient fill under a series (web `<Area fill="url(#grad…)">`,
    /// 0.3 → 0 opacity). Drawn unstacked so Cabin and Outside overlap rather than
    /// sum, matching the web two-line composition.
    private func areaSeries(_ series: ClimateSeries) -> some ChartContent {
        ForEach(marks(for: series)) { mark in
            AreaMark(
                x: .value("time", mark.time),
                y: .value("temperature", mark.value),
                stacking: .unstacked
            )
            .foregroundStyle(gradient(for: series))
            .interpolationMethod(.monotone)
        }
    }

    /// The 2-pt stroke on top of the fill (web `<Area strokeWidth={2}>`). Uses the
    /// `by:` style so the color scale (and the a11y/legend identity) tracks the series.
    private func lineSeries(_ series: ClimateSeries) -> some ChartContent {
        let name = seriesName(series)
        return ForEach(marks(for: series)) { mark in
            LineMark(
                x: .value("time", mark.time),
                y: .value("temperature", mark.value)
            )
            .foregroundStyle(by: .value("series", name))
            .lineStyle(StrokeStyle(lineWidth: 2))
            .interpolationMethod(.monotone)
        }
    }

    // MARK: Axes

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: .automatic(desiredCount: showAxisTitles ? 5 : 3)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let date = value.as(Date.self) {
                    Text(verbatim: timeLabel(date)).foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let temperature = value.as(Double.self) {
                    Text(verbatim: "\(ClimateNumberFormat.integer(temperature))°")
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private var unitTitle: some View {
        Group {
            if showAxisTitles {
                Text(verbatim: projection.temperatureUnitLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .padding(2)
            }
        }
    }

    // MARK: Derived data

    private func marks(for series: ClimateSeries) -> [ClimateMark] {
        data.compactMap { datum in
            series.value(in: datum).map { ClimateMark(id: datum.id, time: datum.time, value: $0) }
        }
    }

    private var xDomain: ClosedRange<Date> {
        guard let first = data.first?.time, let last = data.last?.time else {
            let now = Date()
            return now.addingTimeInterval(-60) ... now
        }
        guard first < last else {
            return first.addingTimeInterval(-60) ... last.addingTimeInterval(60)
        }
        return first ... last
    }

    // MARK: Series identity + color tokens

    private func seriesName(_ series: ClimateSeries) -> String {
        ClimateHistoryStrings.string(series.labelKey, series.labelFallback)
    }

    private var seriesNames: [String] {
        ClimateSeries.allCases.map(seriesName)
    }

    /// Web hex → design token: Cabin #f97316 (orange) → chartSeriesEnergy (the amber
    /// energy token, the nearest hue in the palette); Outside #3b82f6 → chartSeriesSpeed
    /// (an EXACT-hex match). The warm/cool contrast of the web source is preserved.
    private func seriesColor(_ series: ClimateSeries) -> Color {
        switch series {
        case .cabin: Color.TS.chartSeriesEnergy
        case .outside: Color.TS.chartSeriesSpeed
        }
    }

    private var seriesColors: [Color] {
        ClimateSeries.allCases.map(seriesColor)
    }

    private func gradient(for series: ClimateSeries) -> LinearGradient {
        let color = seriesColor(series)
        return LinearGradient(
            colors: [color.opacity(0.30), color.opacity(0.0)],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}
