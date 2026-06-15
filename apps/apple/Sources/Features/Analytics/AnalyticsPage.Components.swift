import SwiftUI

// Shared building blocks for the Fleet-Analytics tabs (web `MetricCard`, `GlassPanel` + `SectionTitle`,
// the recharts chart frames, and the horizontal leaderboard bars). Each value formats from raw SI via
// `AnalyticsFormat` at this display boundary; every chart frame renders its own empty state (never a
// blank region), built on the P3 native Swift Charts wrappers — no WKWebView.

// MARK: - Metric card (web `MetricCard` — label + value + tinted icon)

/// One labeled metric with a tinted SF Symbol (web `MetricCard` with its `color` prop). Composes the
/// shared `TSCard` + `TSIconBox` + typography; the value is pre-formatted (unit baked in) so it
/// renders verbatim, matching the sibling `StatisticsMetricCard`.
struct AnalyticsMetricCard: View {
    let title: LocalizedStringKey
    let value: String
    let systemImage: String
    let tone: TSTone

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    TSMetricLabel(title)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: systemImage, tone: tone)
                }
                TSMetricValue(value)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

/// An adaptive metric-card grid (web responsive `grid-cols-2 … lg:grid-cols-6`). Reflows from two
/// columns on compact iPhone to as many as fit on iPad/macOS.
struct AnalyticsMetricGrid<Content: View>: View {
    var minimum: CGFloat = 150
    @ViewBuilder var content: () -> Content

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: minimum), spacing: TSSpacing.md)],
            spacing: TSSpacing.md,
            content: content
        )
    }
}

// MARK: - Panel (web `GlassPanel` + `SectionTitle`)

/// A titled glass panel (web `GlassPanel` wrapping a `SectionTitle` + body). Used for the non-chart
/// sections (leaderboards, temperature stats, quick links).
struct AnalyticsPanel<Content: View>: View {
    let title: LocalizedStringKey
    @ViewBuilder var content: () -> Content

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle(title)
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Chart panel (web `GlassPanel` + `SectionTitle` + chart / EmptyState)

/// A titled chart frame (web `GlassPanel` + `SectionTitle` + recharts `ResponsiveContainer`, or its
/// `EmptyState` when the series is empty). Wraps the P3 `TSChartContainer`; when `isEmpty` it shows
/// the source's specific empty message rather than a blank region.
struct AnalyticsChartPanel<Content: View>: View {
    let title: LocalizedStringKey
    var summary: LocalizedStringKey?
    let isEmpty: Bool
    let emptyTitle: LocalizedStringKey
    var emptyIcon: String = "chart.xyaxis.line"
    @ViewBuilder var content: () -> Content

    var body: some View {
        TSChartContainer(title, summary: summary) {
            if isEmpty {
                TSEmptyState(title: emptyTitle, systemImage: emptyIcon)
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                content()
            }
        }
    }
}

// MARK: - Category axis (index-based chart X labels, web recharts `XAxis` ticks)

/// The category labels beneath an index-based bar/line chart (web recharts `XAxis` ticks). The P3
/// chart wrappers plot on a numeric index axis, so the category names are surfaced here, evenly
/// spaced, mirroring the web axis.
struct AnalyticsCategoryAxis: View {
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

// MARK: - Leaderboard / proportion row (web flex row + neon progress bar)

/// One horizontal proportion row (web leaderboard / cost-by-type rows: a label, a trailing value, and
/// a token-tinted fill bar). Replaces the web `bg-neon-*` inline-width bars with the design-token
/// `tone` color and a SwiftUI `GeometryReader` fill.
struct AnalyticsBarRow: View {
    let leading: String
    let trailing: String
    let fraction: Double
    var tone: TSTone = .accent

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(verbatim: leading)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: trailing)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .monospacedDigit()
            }
            TSMetricBar(fraction: fraction, tone: tone)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(leading), \(trailing)"))
    }
}

// MARK: - Chart series builders (web recharts data → P3 `TSChartSeries`)

/// Pure helpers that turn the SI model arrays into the P3 chart wrappers' `TSChartSeries` /
/// `TSChartPoint` / `TSChartSlice`, converting to the user's units at this boundary.
enum AnalyticsSeries {
    /// A single index-keyed bar/line series from category buckets (web single-series `BarChart`).
    static func counts(
        _ buckets: [AnalyticsBucket],
        id: String,
        name: String,
        colorIndex: Int
    ) -> TSChartSeries {
        TSChartSeries(
            id: id,
            name: LocalizedStringKey(name),
            nameText: name,
            points: buckets.enumerated().map { index, bucket in
                TSChartPoint(x: Double(index), y: Double(bucket.count), id: "\(id)-\(bucket.id)")
            },
            colorIndex: colorIndex
        )
    }

    /// A series from arbitrary index-keyed values (web composed-chart bar/line dataKeys).
    static func values(
        _ values: [Double],
        id: String,
        name: String,
        colorIndex: Int
    ) -> TSChartSeries {
        TSChartSeries(
            id: id,
            name: LocalizedStringKey(name),
            nameText: name,
            points: values.enumerated().map { index, value in
                TSChartPoint(x: Double(index), y: value, id: "\(id)-\(index)")
            },
            colorIndex: colorIndex
        )
    }

    /// Donut slices from category buckets (web `PieChart`).
    static func slices(_ buckets: [AnalyticsBucket]) -> [TSChartSlice] {
        buckets.enumerated().map { index, bucket in
            TSChartSlice(
                id: bucket.id,
                name: LocalizedStringKey(bucket.label),
                nameText: bucket.label,
                value: Double(bucket.count),
                colorIndex: index
            )
        }
    }
}

/// A count-plus-trend pair (web recharts dual-axis `ComposedChart`: bars on the left axis, a line on
/// the right). The P3 wrappers plot on a single shared axis, so the two metrics — which live on very
/// different scales (counts vs. magnitudes) — are stacked as two independently auto-scaled charts
/// over a shared category axis, with a two-item legend. This keeps both series readable rather than
/// flattening the smaller one, while staying SwiftUI-native (no WKWebView).
struct AnalyticsTrendPair: View {
    let barSeries: TSChartSeries
    let lineSeries: TSChartSeries
    let labels: [String]

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            TSBarChart(series: [barSeries])
                .frame(height: 160)
            TSLineChart(series: [lineSeries])
                .frame(height: 110)
            AnalyticsCategoryAxis(labels: labels)
            AnalyticsChartLegend(items: [
                (barSeries.colorIndex, barSeries.nameText),
                (lineSeries.colorIndex, lineSeries.nameText)
            ])
        }
        .accessibilityElement(children: .contain)
    }
}

/// A grouped bar chart with its shared category axis + legend (web multi-series `BarChart`).
struct AnalyticsGroupedBars: View {
    let series: [TSChartSeries]
    let labels: [String]
    var height: CGFloat = 240

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            TSBarChart(series: series)
                .frame(height: height)
            AnalyticsCategoryAxis(labels: labels)
            AnalyticsChartLegend(items: series.map { ($0.colorIndex, $0.nameText) })
        }
        .accessibilityElement(children: .contain)
    }
}

/// A single-series bar chart with its shared category axis (web single-series `BarChart`).
struct AnalyticsSingleBars: View {
    let series: TSChartSeries
    let labels: [String]
    var height: CGFloat = 240

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            TSBarChart(series: [series])
                .frame(height: height)
            AnalyticsCategoryAxis(labels: labels)
        }
        .accessibilityElement(children: .contain)
    }
}

/// A simple two-color legend row for grouped/composed charts (web recharts `<Legend />`).
struct AnalyticsChartLegend: View {
    let items: [(colorIndex: Int, text: String)]

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(spacing: TSSpacing.xs) {
                    Circle()
                        .fill(TSChartPalette.color(at: item.colorIndex))
                        .frame(width: 8, height: 8)
                    Text(verbatim: item.text)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityHidden(true)
    }
}
