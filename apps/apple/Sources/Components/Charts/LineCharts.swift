import Charts
import SwiftUI

/// Shared TeslaSync axis styling for Swift Charts (token grid + muted labels).
private struct TSChartAxesModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .chartXAxis {
                AxisMarks { _ in
                    AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                    AxisValueLabel()
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .chartYAxis {
                AxisMarks { value in
                    AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                    AxisValueLabel {
                        if let number = value.as(Double.self) {
                            Text(TSChartFormat.axisLabel(number))
                                .foregroundStyle(Color.TS.textMuted)
                        }
                    }
                }
            }
    }
}

extension View {
    func tsChartAxes() -> some View {
        modifier(TSChartAxesModifier())
    }

    /// Hides axes entirely (for sparklines / mini charts).
    func tsChartNoAxes() -> some View {
        chartXAxis(.hidden).chartYAxis(.hidden)
    }
}

/// Multi-series line chart (web `LineChart`).
public struct TSLineChart: View {
    private let series: [TSChartSeries]
    private let hidden: Set<String>
    private let smooth: Bool

    public init(series: [TSChartSeries], hidden: Set<String> = [], smooth: Bool = true) {
        self.series = series
        self.hidden = hidden
        self.smooth = smooth
    }

    private var visible: [TSChartSeries] {
        series.filter { !hidden.contains($0.id) }
    }

    public var body: some View {
        Chart(visible) { item in
            ForEach(item.points) { point in
                LineMark(x: .value("x", point.xValue), y: .value("y", point.yValue))
                    .interpolationMethod(smooth ? .catmullRom : .linear)
            }
            .foregroundStyle(by: .value("series", item.nameText))
        }
        .chartForegroundStyleScale(domain: visible.map(\.nameText), range: visible.map(\.color))
        .chartLegend(.hidden)
        .tsChartAxes()
        .accessibilityLabel(Text("chart.line"))
    }
}

/// Gradient-filled area chart (web `AreaChart`).
public struct TSAreaChart: View {
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
                AreaMark(x: .value("x", point.xValue), y: .value("y", point.yValue))
                    .interpolationMethod(.catmullRom)
            }
            .foregroundStyle(TSChartGradient.fill(colorIndex: item.colorIndex))
        }
        .tsChartAxes()
        .accessibilityLabel(Text("chart.area"))
    }
}

/// Distance/elevation profile (web `ElevationProfile`): downsampled area + line.
public struct TSElevationProfile: View {
    private let points: [TSChartPoint]
    private let colorIndex: Int

    public init(points: [TSChartPoint], colorIndex: Int = 4) {
        self.points = points
        self.colorIndex = colorIndex
    }

    private var downsampled: [TSChartPoint] {
        TSChartFormat.downsample(points, maxCount: 300)
    }

    public var body: some View {
        Chart {
            ForEach(downsampled) { point in
                AreaMark(x: .value("distance", point.xValue), y: .value("elevation", point.yValue))
                    .foregroundStyle(TSChartGradient.fill(colorIndex: colorIndex))
                LineMark(x: .value("distance", point.xValue), y: .value("elevation", point.yValue))
                    .foregroundStyle(TSChartPalette.color(at: colorIndex))
                    .interpolationMethod(.catmullRom)
            }
        }
        .tsChartAxes()
        .accessibilityLabel(Text("chart.elevation"))
    }
}
