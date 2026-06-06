import SwiftUI

/// A switchable metric for `TSMetricSwitcherChart`.
public struct TSMetricOption: Identifiable {
    public let id: String
    public let name: LocalizedStringKey
    public let series: TSChartSeries

    public init(id: String, name: LocalizedStringKey, series: TSChartSeries) {
        self.id = id
        self.name = name
        self.series = series
    }
}

/// Line chart with a segmented metric switcher (web `MetricSwitcherChart`).
public struct TSMetricSwitcherChart: View {
    private let metrics: [TSMetricOption]
    @State private var selectedID: String

    public init(metrics: [TSMetricOption]) {
        self.metrics = metrics
        _selectedID = State(initialValue: metrics.first?.id ?? "")
    }

    private var selected: TSMetricOption? {
        metrics.first { $0.id == selectedID } ?? metrics.first
    }

    public var body: some View {
        VStack(spacing: TSSpacing.md) {
            Picker(selection: $selectedID) {
                ForEach(metrics) { metric in
                    Text(metric.name).tag(metric.id)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.segmented)

            if let selected {
                TSLineChart(series: [selected.series])
                    .frame(minHeight: 180)
            } else {
                TSCaption("chart.noData")
                    .frame(maxWidth: .infinity, minHeight: 180)
            }
        }
    }
}
