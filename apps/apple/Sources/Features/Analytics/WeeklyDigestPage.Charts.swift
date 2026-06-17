import SwiftUI

// The Weekly Digest charts — the SwiftUI parity of the web recharts `BarChart` (daily distance /
// energy) and `PieChart` (alert distribution), built on the P3 native Swift Charts wrappers
// (`TSChartContainer` / `TSBarChart` / `TSPieChart`) — never a WKWebView. The wrappers plot on a
// numeric index axis, so the Mon…Sun category labels are surfaced beneath the bars (web recharts
// `XAxis` ticks).

// MARK: - Daily bar chart (web `BarChart` of `DailyDistanceEntry` / `DailyEnergyEntry`)

/// A single-series day-of-week bar chart inside a titled chart panel (web inner `GlassPanel` →
/// `ResponsiveContainer` → `BarChart`).
struct WeeklyDigestDailyBarChart: View {
    let titleKey: LocalizedStringKey
    let titleText: String
    let bars: [DigestDailyBar]
    let colorIndex: Int

    private var series: TSChartSeries {
        TSChartSeries(
            id: "weekly-digest-daily",
            name: titleKey,
            nameText: titleText,
            points: bars.enumerated().map { index, bar in
                TSChartPoint(x: Double(index), y: bar.value, id: bar.day)
            },
            colorIndex: colorIndex
        )
    }

    var body: some View {
        TSChartContainer(titleKey) {
            VStack(spacing: TSSpacing.sm) {
                TSBarChart(series: [series])
                    .frame(height: 240)
                WeeklyDigestCategoryAxis(labels: bars.map(\.day))
            }
        }
    }
}

// MARK: - Category axis (web recharts `XAxis` ticks)

/// The evenly-spaced category labels beneath an index-based bar chart (web recharts `XAxis` `dataKey`
/// ticks). Hidden from VoiceOver — the chart wrapper already summarizes the series.
struct WeeklyDigestCategoryAxis: View {
    let labels: [String]

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(Array(labels.enumerated()), id: \.offset) { _, label in
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Alert distribution donut (web `PieChart`)

/// The alert-by-severity donut (web `PieChart` of `alertPieData`), built on the P3 `TSPieChart`
/// wrapper with its legend.
struct WeeklyDigestAlertPie: View {
    let slices: [DigestAlertSlice]

    var body: some View {
        TSPieChart(
            slices: slices.map { slice in
                TSChartSlice(
                    id: slice.severity,
                    name: LocalizedStringKey(slice.name),
                    nameText: slice.name,
                    value: Double(slice.value),
                    colorIndex: slice.colorIndex
                )
            },
            showsLegend: true
        )
        .frame(minHeight: 240)
    }
}
