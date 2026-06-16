import SwiftUI

// The side-by-side comparison bar chart (web "Side-by-Side Comparison" `GlassPanel` + recharts
// `BarChart` — GlassPanel3), built on the P3 native Swift Charts wrapper (`TSBarChart`, never a
// WKWebView). Two grouped series (Period A / Period B) span the six metric categories, with the
// metric labels rendered beneath the bars and a two-series legend. Renders its own empty state
// (never a blank region) and an accessible summary.

/// The metric comparison bar chart (web `ChartTitle` "Side-by-Side Comparison" + `BarChart`):
/// grouped Period A vs Period B bars across all six metrics. Display-converted values come from
/// the bound metric values, so the chart, cards, and table never disagree.
struct PeriodCompareChartSection: View {
    let values: [PeriodCompareMetricValue]

    var body: some View {
        TSChartContainer("compare.chartTitle") {
            if values.isEmpty {
                TSEmptyState(title: "compare.empty", systemImage: "chart.bar.xaxis")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                VStack(spacing: TSSpacing.sm) {
                    TSBarChart(series: series)
                        .frame(height: 280)
                    categoryAxis
                    PeriodComparePeriodLegend()
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("compare.chartTitle"))
            }
        }
    }

    /// Two grouped series — Period A (palette 0) and Period B (palette 1) — one bar per metric.
    private var series: [TSChartSeries] {
        let nameA = String(localized: "compare.periodA", defaultValue: "Period A")
        let nameB = String(localized: "compare.periodB", defaultValue: "Period B")
        let pointsA = values.enumerated().map { index, value in
            TSChartPoint(x: Double(index), y: value.valueA, id: "a-\(value.metric.rawValue)")
        }
        let pointsB = values.enumerated().map { index, value in
            TSChartPoint(x: Double(index), y: value.valueB, id: "b-\(value.metric.rawValue)")
        }
        return [
            TSChartSeries(id: "a", name: "compare.periodA", nameText: nameA, points: pointsA, colorIndex: 0),
            TSChartSeries(id: "b", name: "compare.periodB", nameText: nameB, points: pointsB, colorIndex: 1)
        ]
    }

    /// Per-metric category labels beneath the bars (web X-axis ticks = metric names).
    private var categoryAxis: some View {
        HStack(alignment: .top, spacing: TSSpacing.xs) {
            ForEach(values) { value in
                Text(value.metric.titleKey)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Two-series legend for the comparison chart (web recharts `<Legend />`): Period A + Period B.
struct PeriodComparePeriodLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            legendItem(colorIndex: 0, label: "compare.periodA")
            legendItem(colorIndex: 1, label: "compare.periodB")
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func legendItem(colorIndex: Int, label: LocalizedStringKey) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(TSChartPalette.color(at: colorIndex))
                .frame(width: 8, height: 8)
            Text(label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
    }
}
