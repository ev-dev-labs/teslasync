import SwiftUI

/// The charging-over-time trend (web `MetricSwitcherChart`): a segmented metric switcher
/// (Sessions / Energy / Cost / Avg power) above a Swift Charts plot rendered through the P3
/// chart wrappers — a bar chart for the summed metrics, a line for average power, exactly as
/// the web per-metric `chart` type chooses. Shows its own empty when the selected metric has
/// no data in the window.
struct ChargingTrendChart: View {
    @Bindable var model: ChargingListPageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("charging.overTime")
                metricSwitcher
                chart
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("charging.overTime.aria"))
    }

    /// Web segmented `MetricSwitcher` — the four trend metrics.
    private var metricSwitcher: some View {
        Picker(selection: $model.trendMetric) {
            ForEach(ChargingTrendMetric.allCases) { metric in
                Text(LocalizedStringKey(metric.labelKey)).tag(metric)
            }
        } label: {
            Text("charging.overTime")
        }
        .pickerStyle(.segmented)
        .labelsHidden()
    }

    @ViewBuilder
    private var chart: some View {
        let points = model.trendPoints(for: model.trendMetric)
        if points.isEmpty {
            TSEmptyState(title: "charging.overTime.empty", systemImage: "chart.bar")
                .frame(maxWidth: .infinity, minHeight: 180)
        } else if model.trendMetric.isLine {
            TSLineChart(series: [series(points)])
                .frame(minHeight: 180)
        } else {
            TSBarChart(series: [series(points)])
                .frame(minHeight: 180)
        }
    }

    /// Maps the active metric's daily points into a brand-palette chart series. The x value
    /// is the day index (the wrapper styles the axis); each metric keeps its web accent.
    private func series(_ points: [ChargingTrendPoint]) -> TSChartSeries {
        let mapped = points.enumerated().map { index, point in
            TSChartPoint(x: Double(index), y: point.value, id: point.date)
        }
        return TSChartSeries(
            id: model.trendMetric.rawValue,
            name: LocalizedStringKey(model.trendMetric.labelKey),
            nameText: model.trendMetric.rawValue,
            points: mapped,
            colorIndex: model.trendMetric.colorIndex
        )
    }
}
