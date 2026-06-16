import Charts
import SwiftUI

// The "Most Frequent Anomalies" panel (web GlassPanel7) for the Anomaly Detection surface, built on
// the native Swift Charts `BarMark` (never a WKWebView): a horizontal ranked bar chart of the top
// signals by anomaly count. Renders its own empty state (web `noFrequency`); the count values feed
// the chart from the model's derived `signalFrequency`.

// MARK: - Frequency panel (web GlassPanel7 — BarChart, or empty)

/// The signal-frequency panel (web "Most Frequent Anomalies" `GlassPanel` + `BarChart`): a
/// horizontal bar per signal, ordered with the most frequent on top, or a no-frequency empty state.
struct AnomalyDashboardFrequencySection: View {
    let items: [AnomalySignalCount]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle("anomaly.frequency")
                if items.isEmpty {
                    TSEmptyState(title: "anomaly.noFrequency", systemImage: "chart.bar")
                        .frame(maxWidth: .infinity)
                } else {
                    AnomalyFrequencyLegend()
                    AnomalyFrequencyChart(items: items)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// The single-series legend (web recharts `Bar name={t('anomaly.count')}`): the bar color swatch
/// plus the "Anomalies" series label.
struct AnomalyFrequencyLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(TSChartPalette.color(at: 3))
                .frame(width: 8, height: 8)
            Text("anomaly.count")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The horizontal ranked bar chart (web `BarChart layout="vertical"`): the signal categories run
/// down the Y axis (most frequent on top) and the anomaly count runs along the X axis. The bar
/// height scales with the number of signals (web `height = max(200, n * 35)`).
struct AnomalyFrequencyChart: View {
    let items: [AnomalySignalCount]

    /// Y-axis domain ordered so the highest-count signal sits at the top (Swift Charts places the
    /// first domain entry at the bottom; the model hands us the list already sorted descending).
    private var orderedSignals: [String] {
        items.map(\.signal).reversed()
    }

    private var chartHeight: CGFloat {
        max(180, CGFloat(items.count) * 34)
    }

    var body: some View {
        Chart(items) { item in
            BarMark(
                x: .value("count", item.count),
                y: .value("signal", item.signal)
            )
            .foregroundStyle(TSChartPalette.color(at: 3))
            .cornerRadius(4)
            .annotation(position: .trailing, alignment: .leading) {
                Text(verbatim: AnomalyDashboardFormat.integer(item.count))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .chartYScale(domain: orderedSignals)
        .chartXAxis {
            AxisMarks { _ in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel().foregroundStyle(Color.TS.textMuted)
            }
        }
        .chartYAxis {
            AxisMarks { _ in
                AxisValueLabel()
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .frame(height: chartHeight)
        .accessibilityLabel(Text("anomaly.frequency"))
    }
}
