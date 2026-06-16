import Charts
import SwiftUI

// The two Top-Locations charts on the Locations surface, built on native Swift Charts (never a
// WKWebView). The web renders horizontal `BarChart`s (`layout="vertical"`): the place names on the
// category axis and the metric (visits / hours) along the value axis. The P3 `TSBarChart` wrapper
// plots vertical numeric series, so this categorical horizontal bar — the faithful port of the web
// layout — uses `Chart` directly while staying inside the design tokens (the sibling
// `ChargingHeatmapLocationsChart` convention). Each panel renders its own empty state, never a
// blank region.

// MARK: - Top Locations by Visits (web GlassPanel7 — "Top Locations by Visits" BarChart)

/// The most-visited places panel (web GlassPanel7): a horizontal bar chart of the top 15 places by
/// visit count, or the no-data empty state. Bars are ordered highest-first to match the web's
/// descending `visitsChartData`.
struct LocationsVisitsChartSection: View {
    let bars: [LocationsChartBar]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSubhead("Top Locations by Visits")
                if bars.isEmpty {
                    LocationsChartEmpty(message: "No visited location data", systemImage: "mappin.slash")
                } else {
                    LocationsRankedBarChart(
                        bars: bars,
                        seriesName: "Visits",
                        colorIndex: 0,
                        valueLabel: { LocationsFormat.integer(Int($0.rounded())) }
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Top Locations by Time (web GlassPanel8 — "Top Locations by Time Spent (hours)" BarChart)

/// The most-dwelt places panel (web GlassPanel8): a horizontal bar chart of the top 10 places by
/// hours spent, or the no-data empty state. The hours value is the SI duration ÷ 3600 (web
/// `timeChartData`), so it is unit-independent and needs no conversion.
struct LocationsTimeChartSection: View {
    let bars: [LocationsChartBar]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSubhead("Top Locations by Time Spent (hours)")
                if bars.isEmpty {
                    LocationsChartEmpty(message: "No time-spent data available", systemImage: "clock.badge.xmark")
                } else {
                    LocationsRankedBarChart(
                        bars: bars,
                        seriesName: "Hours",
                        colorIndex: 2,
                        valueLabel: { LocationsFormat.hoursLabel($0) }
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Shared ranked horizontal bar (web BarChart layout="vertical")

/// A horizontal, descending ranked bar chart of `LocationsChartBar`s, framed for a Locations panel.
/// Each bar is annotated with its formatted value and the brand palette fills it; the category axis
/// carries the (already truncated) place labels. Ordered highest-first to match the web, where the
/// API returns places in descending rank.
private struct LocationsRankedBarChart: View {
    let bars: [LocationsChartBar]
    let seriesName: LocalizedStringKey
    let colorIndex: Int
    let valueLabel: (Double) -> String

    /// Web `height={Math.max(300, data.length * 36)}` (visits) / `Math.max(280, …)` (time).
    private var chartHeight: CGFloat {
        max(240, CGFloat(bars.count) * 34 + 24)
    }

    /// Category order so the highest-ranked place sits at the top (Swift Charts puts the first
    /// domain entry at the bottom, so the descending list is reversed). Labels are disambiguated by
    /// id to survive duplicate truncated names.
    private var domain: [String] {
        bars.map(\.axisKey).reversed()
    }

    var body: some View {
        Chart(bars) { bar in
            BarMark(
                x: .value("locations.chart.value", bar.value),
                y: .value("locations.chart.place", bar.axisKey)
            )
            .foregroundStyle(TSChartPalette.color(at: colorIndex).opacity(0.75))
            .cornerRadius(4)
            .annotation(position: .trailing, alignment: .leading) {
                Text(verbatim: valueLabel(bar.value))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .monospacedDigit()
            }
        }
        .chartYScale(domain: domain)
        .chartXAxis {
            AxisMarks(position: .bottom) { value in
                AxisGridLine().foregroundStyle(Color.TS.border)
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: valueLabel(number))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisValueLabel {
                    if let key = value.as(String.self) {
                        Text(verbatim: LocationsChartBar.label(fromAxisKey: key))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                            .lineLimit(1)
                    }
                }
            }
        }
        .frame(height: chartHeight)
        .accessibilityLabel(Text(seriesName))
        .accessibilityValue(Text(verbatim: accessibilitySummary))
    }

    /// A concise VoiceOver summary (leader + count), since the bars themselves are decorative.
    private var accessibilitySummary: String {
        guard let leader = bars.first else { return "" }
        return "\(LocationsChartBar.label(fromAxisKey: leader.axisKey)) \(valueLabel(leader.value))"
    }
}

// MARK: - Chart empty state (web per-chart "No … data" message)

/// The self-contained empty message shown inside a chart panel when there is no series to plot
/// (web `visitsChartData.length === 0` / `timeChartData.length === 0`), never a blank region.
private struct LocationsChartEmpty: View {
    let message: LocalizedStringKey
    let systemImage: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.textMuted)
            Text(message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Axis key disambiguation

extension LocationsChartBar {
    /// A unique category key (`label` + id) so Swift Charts keeps duplicate truncated labels as
    /// distinct bars; the visible axis label is recovered with `label(fromAxisKey:)`.
    var axisKey: String {
        "\(label)\u{2063}\(id)"
    }

    /// Recovers the human label from an `axisKey` (strips the invisible id suffix).
    static func label(fromAxisKey key: String) -> String {
        String(key.split(separator: "\u{2063}", maxSplits: 1).first ?? "")
    }
}

extension LocationsFormat {
    /// The hours value with one decimal for the time-chart annotations + axis (web `fmtNumber(h, 1)`
    /// already rounded the series; this just renders it).
    static func hoursLabel(_ hours: Double) -> String {
        guard hours.isFinite else { return emptyValue }
        return String(format: "%.1f", hours)
    }
}
