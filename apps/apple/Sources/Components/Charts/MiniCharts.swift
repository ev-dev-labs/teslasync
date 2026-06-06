import Charts
import SwiftUI

/// Axis-free trend line (web `Sparkline`).
public struct TSSparkline: View {
    private let values: [Double]
    private let colorIndex: Int

    public init(values: [Double], colorIndex: Int = 0) {
        self.values = values
        self.colorIndex = colorIndex
    }

    private var points: [TSChartPoint] {
        values.enumerated().map { TSChartPoint(x: Double($0.offset), y: $0.element) }
    }

    public var body: some View {
        Chart {
            ForEach(points) { point in
                LineMark(x: .value("i", point.xValue), y: .value("v", point.yValue))
                    .foregroundStyle(TSChartPalette.color(at: colorIndex))
                    .interpolationMethod(.catmullRom)
            }
        }
        .tsChartNoAxes()
        .chartLegend(.hidden)
        .frame(height: 32)
        .accessibilityLabel(Text("chart.sparkline"))
    }
}

/// Compact metric + inline trend (web `MiniChart`).
public struct TSMiniChart: View {
    private let label: LocalizedStringKey
    private let valueText: String
    private let values: [Double]
    private let colorIndex: Int

    public init(label: LocalizedStringKey, valueText: String, values: [Double], colorIndex: Int = 0) {
        self.label = label
        self.valueText = valueText
        self.values = values
        self.colorIndex = colorIndex
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSMetricLabel(label)
            TSMetricValue(valueText)
            TSSparkline(values: values, colorIndex: colorIndex)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
    }
}

/// Grid of per-series sparklines (web `SmallMultiplesChart`).
public struct TSSmallMultiplesChart: View {
    private let series: [TSChartSeries]
    private let columns: Int

    public init(series: [TSChartSeries], columns: Int = 2) {
        self.series = series
        self.columns = columns
    }

    public var body: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: max(columns, 1)),
            spacing: TSSpacing.md
        ) {
            ForEach(series) { item in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSCaption(item.name)
                    TSSparkline(values: item.points.map(\.yValue), colorIndex: item.colorIndex)
                }
                .padding(TSSpacing.sm)
                .background(
                    Color.TS.surface,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
            }
        }
    }
}
