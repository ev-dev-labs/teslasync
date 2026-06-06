import Charts
import SwiftUI

/// Grouped or stacked bar chart (web `BarChart`).
public struct TSBarChart: View {
    private let series: [TSChartSeries]
    private let hidden: Set<String>
    private let stacked: Bool

    public init(series: [TSChartSeries], hidden: Set<String> = [], stacked: Bool = false) {
        self.series = series
        self.hidden = hidden
        self.stacked = stacked
    }

    private var visible: [TSChartSeries] {
        series.filter { !hidden.contains($0.id) }
    }

    public var body: some View {
        chart
            .chartForegroundStyleScale(domain: visible.map(\.nameText), range: visible.map(\.color))
            .chartLegend(.hidden)
            .tsChartAxes()
            .accessibilityLabel(Text("chart.bar"))
    }

    @ViewBuilder private var chart: some View {
        if stacked {
            Chart(visible) { item in
                ForEach(item.points) { point in
                    BarMark(x: .value("x", point.xValue), y: .value("y", point.yValue))
                }
                .foregroundStyle(by: .value("series", item.nameText))
            }
        } else {
            Chart(visible) { item in
                ForEach(item.points) { point in
                    BarMark(x: .value("x", point.xValue), y: .value("y", point.yValue))
                }
                .foregroundStyle(by: .value("series", item.nameText))
                .position(by: .value("series", item.nameText))
            }
        }
    }
}

/// Bars + line overlay (web `ComposedChart`).
public struct TSComposedChart: View {
    private let bars: TSChartSeries
    private let line: TSChartSeries

    public init(bars: TSChartSeries, line: TSChartSeries) {
        self.bars = bars
        self.line = line
    }

    public var body: some View {
        Chart {
            ForEach(bars.points) { point in
                BarMark(x: .value("x", point.xValue), y: .value("y", point.yValue))
                    .foregroundStyle(bars.color.opacity(0.6))
            }
            ForEach(line.points) { point in
                LineMark(x: .value("x", point.xValue), y: .value("y", point.yValue))
                    .foregroundStyle(line.color)
                    .interpolationMethod(.catmullRom)
            }
        }
        .tsChartAxes()
        .accessibilityLabel(Text("chart.composed"))
    }
}

/// Scatter plot (web `ScatterChart`).
public struct TSScatterChart: View {
    private let series: [TSChartSeries]
    private let hidden: Set<String>

    public init(series: [TSChartSeries], hidden: Set<String> = []) {
        self.series = series
        self.hidden = hidden
    }

    private var visible: [TSChartSeries] {
        series.filter { !hidden.contains($0.id) }
    }

    public var body: some View {
        Chart(visible) { item in
            ForEach(item.points) { point in
                PointMark(x: .value("x", point.xValue), y: .value("y", point.yValue))
                    .symbolSize(50)
            }
            .foregroundStyle(by: .value("series", item.nameText))
        }
        .chartForegroundStyleScale(domain: visible.map(\.nameText), range: visible.map(\.color))
        .chartLegend(.hidden)
        .tsChartAxes()
        .accessibilityLabel(Text("chart.scatter"))
    }
}
