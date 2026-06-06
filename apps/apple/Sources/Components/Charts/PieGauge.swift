import Charts
import SwiftUI

/// Donut/pie chart (web `PieChart`) using `SectorMark`.
public struct TSPieChart: View {
    private let slices: [TSChartSlice]
    private let showsLegend: Bool

    public init(slices: [TSChartSlice], showsLegend: Bool = true) {
        self.slices = slices
        self.showsLegend = showsLegend
    }

    public var body: some View {
        Chart(slices) { slice in
            SectorMark(
                angle: .value("value", slice.value),
                innerRadius: .ratio(0.6),
                angularInset: 1.5
            )
            .cornerRadius(4)
            .foregroundStyle(by: .value("slice", slice.nameText))
        }
        .chartForegroundStyleScale(domain: slices.map(\.nameText), range: slices.map(\.color))
        .chartLegend(showsLegend ? .visible : .hidden)
        .accessibilityLabel(Text("chart.pie"))
    }
}

/// Circular progress gauge (web `RadialGauge`) for a 0...1 fraction.
public struct TSRadialGauge: View {
    private let value: Double
    private let label: LocalizedStringKey
    private let colorIndex: Int

    public init(value: Double, label: LocalizedStringKey, colorIndex: Int = 0) {
        self.value = value
        self.label = label
        self.colorIndex = colorIndex
    }

    private var clamped: Double {
        min(max(value, 0), 1)
    }

    private var percent: Int {
        Int((clamped * 100).rounded())
    }

    public var body: some View {
        ZStack {
            Circle()
                .stroke(Color.TS.border.opacity(0.3), lineWidth: 10)
            Circle()
                .trim(from: 0, to: clamped)
                .stroke(
                    TSChartPalette.color(at: colorIndex),
                    style: StrokeStyle(lineWidth: 10, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            VStack(spacing: TSSpacing.xs) {
                TSMetricValue("\(percent)%")
                TSMetricLabel(label)
            }
        }
        .frame(width: 120, height: 120)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text("chart.gauge.percent \(percent)"))
    }
}
