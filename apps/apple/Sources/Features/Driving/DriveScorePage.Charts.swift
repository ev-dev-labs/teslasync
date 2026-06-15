import SwiftUI

// The charts on the Drive Score surface, built on the P3 native Swift Charts wrappers (never a
// WKWebView): the radial score gauges (web `RadialGauge`), the score-trend multi-series line chart
// (web `ChartContainer` + `LineChart`), the category-breakdown bars (web `ChartContainer` +
// `BarChart`), and the score-distribution histogram (web `ChartContainer` + `BarChart`). Each renders
// its own empty state (never a blank region) and an accessible summary.

// MARK: - Radial score gauge (web `RadialGauge`)

/// A score gauge (web `RadialGauge value max label color`). Wraps the P3 `TSRadialGauge`, trimming
/// the ring to `value / maxValue` and tinting it from the supplied brand-palette slot. The raw
/// `value/maxValue` number is surfaced by the host section (web `AnimatedNumber` beside the gauge).
struct DriveScoreGauge: View {
    let value: Int
    let maxValue: Int
    let label: LocalizedStringKey
    let colorIndex: Int

    private var fraction: Double {
        guard maxValue > 0 else { return 0 }
        return min(max(Double(value) / Double(maxValue), 0), 1)
    }

    var body: some View {
        TSRadialGauge(value: fraction, label: label, colorIndex: colorIndex)
            .accessibilityLabel(Text(label))
            .accessibilityValue(Text(verbatim: "\(value)/\(maxValue)"))
    }
}

// MARK: - Static chart legend (web recharts `<Legend />`)

/// One legend entry (a colored swatch + a localized series name).
struct DriveScoreLegendItem: Identifiable {
    let id: String
    let name: LocalizedStringKey
    let colorIndex: Int
}

/// A compact static legend for the multi-series charts (web recharts `<Legend />`).
struct DriveScoreLegend: View {
    let items: [DriveScoreLegendItem]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.md) {
                ForEach(items) { item in
                    HStack(spacing: TSSpacing.xs) {
                        Circle()
                            .fill(TSChartPalette.color(at: item.colorIndex))
                            .frame(width: 8, height: 8)
                        Text(item.name)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                            .lineLimit(1)
                    }
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// A first/last date caption beneath a numeric-x chart (the line wrapper uses a numeric x-axis, so the
/// date span is surfaced here, mirroring the web X-axis ticks).
struct DriveScoreTimeAxis: View {
    let labels: [String]

    var body: some View {
        if let first = labels.first, let last = labels.last {
            HStack {
                Text(verbatim: first)
                Spacer()
                Text(verbatim: last)
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
        }
    }
}

// MARK: - Score trend (web GlassPanel6 — Score-Trend ChartContainer + LineChart)

/// The score-trend panel (web GlassPanel6 + Score-Trend `ChartContainer` + `LineChart`): a native
/// multi-series line chart of the total score and the three category scores over the last 20 drives,
/// the 80-point "A" reference (web `ReferenceLine`), a legend, and the date axis. Renders the
/// not-enough-data empty state when there is nothing to plot.
struct DriveScoreTrendSection: View {
    let points: [DriveScoreTrendPoint]
    let gradeColorIndex: Int

    var body: some View {
        TSChartContainer("driveScore.scoreTrend", summary: "driveScore.scoreTrend.aria", csv: csv) {
            if points.isEmpty {
                TSEmptyState(title: "driveScore.noDrives", systemImage: "chart.xyaxis.line")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSLineChart(series: series, smooth: false)
                        .frame(height: 280)
                        .accessibilityLabel(Text("driveScore.scoreTrend.aria"))
                    DriveScoreLegend(items: legend)
                    referenceRow
                    DriveScoreTimeAxis(labels: points.map { DriveScoreFormat.dateShort($0.date) })
                }
            }
        }
    }

    private var series: [TSChartSeries] {
        [
            lineSeries(id: "score", name: "driveScore.totalScore", text: "Total Score", color: gradeColorIndex) {
                $0.score
            },
            lineSeries(id: "efficiency", name: "driveScore.efficiency", text: "Efficiency", color: 2) {
                $0.efficiency
            },
            lineSeries(id: "smoothness", name: "driveScore.smoothness", text: "Smoothness", color: 4) {
                $0.smoothness
            },
            lineSeries(id: "speed", name: "driveScore.speedDiscipline", text: "Speed", color: 6) {
                $0.speed
            }
        ]
    }

    /// Web `ChartContainer` `dataColumns` (Date / Score / Efficiency / Smoothness / Speed) surfaced
    /// as the exportable CSV header + rows.
    private var csv: String? {
        guard !points.isEmpty else { return nil }
        let header = [
            String(localized: "driveScore.col.date"),
            String(localized: "driveScore.col.score"),
            String(localized: "driveScore.col.efficiency"),
            String(localized: "driveScore.col.smoothness"),
            String(localized: "driveScore.col.speed")
        ].joined(separator: ",")
        let rows = points.map { point in
            let date = DriveScoreFormat.dateShort(point.date)
            return "\(date),\(point.score),\(point.efficiency),\(point.smoothness),\(point.speed)"
        }
        return ([header] + rows).joined(separator: "\n")
    }

    private func lineSeries(
        id: String,
        name: LocalizedStringKey,
        text: String,
        color: Int,
        value: (DriveScoreTrendPoint) -> Int
    ) -> TSChartSeries {
        let mapped = points.map { point in
            TSChartPoint(x: Double(point.index), y: Double(value(point)), id: "\(id)-\(point.index)")
        }
        return TSChartSeries(id: id, name: name, nameText: text, points: mapped, colorIndex: color)
    }

    private var legend: [DriveScoreLegendItem] {
        [
            DriveScoreLegendItem(id: "score", name: "driveScore.totalScore", colorIndex: gradeColorIndex),
            DriveScoreLegendItem(id: "efficiency", name: "driveScore.efficiency", colorIndex: 2),
            DriveScoreLegendItem(id: "smoothness", name: "driveScore.smoothness", colorIndex: 4),
            DriveScoreLegendItem(id: "speed", name: "driveScore.speedDiscipline", colorIndex: 6)
        ]
    }

    /// Web `ReferenceLine y={80}` labeled "A" — the A-grade threshold.
    private var referenceRow: some View {
        HStack(spacing: TSSpacing.xs) {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(Color.TS.statusSuccess)
                .frame(width: 16, height: 2)
            Text("driveScore.gradeALine")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            TSCode("80")
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Category breakdown (web GlassPanel8 — Category-Breakdown ChartContainer + BarChart)

/// The category-breakdown panel (web GlassPanel8 + Category-Breakdown `ChartContainer` + `BarChart`):
/// a native bar chart with one colored bar per scored category (efficiency / smoothness / speed),
/// each labeled with its max beneath. Renders the empty state when there are no categories.
struct DriveScoreCategoryBreakdownSection: View {
    let bars: [DriveScoreCategoryBar]

    var body: some View {
        TSChartContainer("driveScore.categoryBreakdown", summary: "driveScore.categoryBreakdown.aria", csv: csv) {
            if bars.isEmpty {
                TSEmptyState(title: "driveScore.noDrives", systemImage: "chart.bar")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSBarChart(series: series)
                        .frame(height: 240)
                        .accessibilityLabel(Text("driveScore.categoryBreakdown.aria"))
                    categoryAxis
                }
            }
        }
    }

    /// One single-point series per category so each bar carries its own category color (web `Cell`
    /// fills) while sitting at its own x position.
    private var series: [TSChartSeries] {
        bars.enumerated().map { index, bar in
            TSChartSeries(
                id: bar.category.rawValue,
                name: bar.category.titleKey,
                nameText: bar.category.rawValue,
                points: [TSChartPoint(x: Double(index), y: Double(bar.value), id: bar.category.rawValue)],
                colorIndex: bar.category.colorIndex
            )
        }
    }

    /// Web `ChartContainer` `dataColumns` (Category / Value / Max) surfaced as the exportable CSV.
    private var csv: String? {
        guard !bars.isEmpty else { return nil }
        let header = [
            String(localized: "driveScore.col.category"),
            String(localized: "driveScore.col.value"),
            String(localized: "driveScore.col.max")
        ].joined(separator: ",")
        let rows = bars.map { "\($0.category.rawValue),\($0.value),\($0.maxValue)" }
        return ([header] + rows).joined(separator: "\n")
    }

    /// The category labels + max beneath the bars (the bar wrapper uses a numeric x-axis).
    private var categoryAxis: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(bars) { bar in
                VStack(spacing: 2) {
                    Text(bar.category.titleKey)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                    Text(verbatim: "\(bar.value)/\(bar.maxValue)")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                .frame(maxWidth: .infinity)
                .lineLimit(1)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Score distribution (web GlassPanel10 — Score-Distribution ChartContainer + BarChart)

/// The score-distribution panel (web GlassPanel10 + Score-Distribution `ChartContainer` + `BarChart`):
/// a native histogram of drive counts across five score buckets, each tinted by the web bucket color.
/// Renders the empty state when there are no scored drives.
struct DriveScoreDistributionSection: View {
    let bins: [DriveScoreHistogramBin]

    private var isEmpty: Bool {
        bins.allSatisfy { $0.driveCount == 0 }
    }

    var body: some View {
        TSChartContainer("driveScore.scoreDistribution", summary: "driveScore.scoreDistribution.aria", csv: csv) {
            if isEmpty {
                TSEmptyState(title: "driveScore.noDrives", systemImage: "chart.bar.xaxis")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSBarChart(series: series)
                        .frame(height: 220)
                        .accessibilityLabel(Text("driveScore.scoreDistribution.aria"))
                    DriveScoreLegend(items: [DriveScoreLegendItem(
                        id: "drives",
                        name: "driveScore.drives",
                        colorIndex: 4
                    )])
                    rangeAxis
                }
            }
        }
    }

    /// One single-point series per bucket so each bar carries its own range color (web `Cell` fills).
    private var series: [TSChartSeries] {
        bins.enumerated().map { index, bin in
            TSChartSeries(
                id: bin.rangeLabel,
                name: LocalizedStringKey(bin.rangeLabel),
                nameText: bin.rangeLabel,
                points: [TSChartPoint(x: Double(index), y: Double(bin.driveCount), id: bin.rangeLabel)],
                colorIndex: bin.colorIndex
            )
        }
    }

    /// Web `ChartContainer` `dataColumns` (Score range / Drives) surfaced as the exportable CSV.
    private var csv: String? {
        guard !isEmpty else { return nil }
        let header = [
            String(localized: "driveScore.col.range"),
            String(localized: "driveScore.col.drives")
        ].joined(separator: ",")
        let rows = bins.map { "\($0.rangeLabel),\($0.driveCount)" }
        return ([header] + rows).joined(separator: "\n")
    }

    /// The range labels beneath the bars (web X-axis ticks).
    private var rangeAxis: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(bins) { bin in
                Text(verbatim: bin.rangeLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity)
                    .lineLimit(1)
            }
        }
        .accessibilityHidden(true)
    }
}
