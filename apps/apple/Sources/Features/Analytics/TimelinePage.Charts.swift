import SwiftUI

// The Daily-Breakdown stacked bar chart for the Timeline surface (web GlassPanel6 `BarChart`),
// built on the P3 native Swift Charts wrapper (never a WKWebView). Transition counts per UTC day
// are stacked into the four user-facing buckets (driving / charging / idle / sleeping). Renders the
// no-daily-data empty (never a blank region) and an accessible summary.

// MARK: - Daily breakdown (web GlassPanel6 — ChartContainer + stacked BarChart)

/// The per-day transition-count stacked bar chart (web `BarChart` with the driving/charging/idle/
/// sleeping stacked bars). Below the chart, a color legend and the per-day category axis mirror the
/// web recharts `<Legend />` and `<XAxis dataKey="day" />`.
struct TimelineDailyBreakdownSection: View {
    let buckets: [TimelineDayBucket]

    var body: some View {
        TSChartContainer("timeline.dailyBreakdown") {
            if buckets.isEmpty {
                TSEmptyState(title: "timeline.noDailyData", systemImage: "chart.bar")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                VStack(spacing: TSSpacing.sm) {
                    TSBarChart(series: series, stacked: true)
                        .frame(height: 240)
                    TimelineDailyLegend()
                    dayAxis
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("timeline.dailyBreakdown"))
            }
        }
    }

    /// One stacked series per bucket, keyed by day index (web `<Bar dataKey=… stackId="a" />`).
    private var series: [TSChartSeries] {
        TimelineStateCategory.allCases.map { category in
            let points = buckets.enumerated().map { index, bucket in
                TSChartPoint(
                    x: Double(index),
                    y: Double(bucket.count(for: category)),
                    id: "\(category.rawValue)-\(bucket.day)"
                )
            }
            return TSChartSeries(
                id: category.rawValue,
                name: Self.seriesKey(category),
                nameText: Self.seriesName(category),
                points: points,
                colorIndex: TimelineStateColor.colorIndex(for: category)
            )
        }
    }

    /// Per-day label row beneath the bars (the bar chart's category axis is index-based, so the day
    /// labels are surfaced here, mirroring the web X-axis ticks). Shows the `MM-DD` suffix to fit.
    private var dayAxis: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(buckets) { bucket in
                Text(verbatim: String(bucket.day.suffix(5)))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }

    static func seriesKey(_ category: TimelineStateCategory) -> LocalizedStringKey {
        LocalizedStringKey("timeline.\(category.rawValue)")
    }

    /// Plain-text localized series name for the legend / VoiceOver (web `t('timeline.driving')` …).
    static func seriesName(_ category: TimelineStateCategory) -> String {
        switch category {
        case .driving: String(localized: "timeline.driving", defaultValue: "Driving")
        case .charging: String(localized: "timeline.charging", defaultValue: "Charging")
        case .idle: String(localized: "timeline.idle", defaultValue: "Idle")
        case .sleeping: String(localized: "timeline.sleeping", defaultValue: "Sleeping")
        }
    }
}

/// The four-series legend for the daily chart (web recharts `<Legend />`): driving / charging /
/// idle / sleeping, each colored from its state palette slot.
struct TimelineDailyLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(TimelineStateCategory.allCases, id: \.rawValue) { category in
                HStack(spacing: TSSpacing.xs) {
                    Circle()
                        .fill(TSChartPalette.color(at: TimelineStateColor.colorIndex(for: category)))
                        .frame(width: 8, height: 8)
                    Text(TimelineDailyBreakdownSection.seriesKey(category))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }
}
