import SwiftUI

// The route-efficiency comparison chart for the Route Efficiency surface, built on the P3 native Swift
// Charts wrappers (never a WKWebView): web GlassPanel3 `ChartContainer` + the grouped `BarChart` of
// per-route best / average / worst consumption. Renders its own empty state (never a blank region)
// when there are fewer than two routes to compare (web `chartData.length > 1` guard).

// MARK: - Route comparison (web GlassPanel3 — Route-Efficiency-Comparison ChartContainer + BarChart)

/// The comparison panel (web `ChartContainer` + `BarChart layout="vertical"`): a grouped bar chart of
/// each plotted route's best / average / worst consumption (top ten by average), a colored legend, the
/// route-label axis, and the exportable data table (web `dataColumns`). Below two routes it shows the
/// chart's empty state, keeping the panel visible.
struct RouteEfficiencyComparisonSection: View {
    let model: RouteEfficiencyPageModel
    let units: UnitPreferences

    /// Web `chartData` — routes sorted by average, capped at ten.
    private var plotted: [RouteEfficiencyRoute] {
        model.comparisonRoutes
    }

    /// Web `chartData.length > 1` — the threshold for plotting the comparison.
    private var hasComparison: Bool {
        plotted.count > 1
    }

    var body: some View {
        TSChartContainer(
            "routeEfficiency.comparison",
            summary: "routeEfficiency.comparison.aria",
            csv: hasComparison ? csv : nil
        ) {
            if hasComparison {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSBarChart(series: series)
                        .frame(height: 280)
                        .accessibilityLabel(Text("routeEfficiency.comparison.aria"))
                    legend
                    routeAxis
                }
            } else {
                TSEmptyState(title: "common.noData", systemImage: "chart.bar")
                    .frame(maxWidth: .infinity, minHeight: 200)
            }
        }
    }

    /// One series per metric (best / avg / worst) so each route renders a grouped trio of bars, tinted
    /// green / cyan / red to match the web fills.
    private var series: [TSChartSeries] {
        [
            barSeries(id: "best", name: "routeEfficiency.best", text: "Best", colorIndex: 2) { $0.bestEfficiency },
            barSeries(id: "avg", name: "routeEfficiency.avgLabel", text: "Avg", colorIndex: 4) { $0.avgEfficiency },
            barSeries(id: "worst", name: "routeEfficiency.worst", text: "Worst", colorIndex: 5) { $0.worstEfficiency }
        ]
    }

    private func barSeries(
        id: String,
        name: LocalizedStringKey,
        text: String,
        colorIndex: Int,
        value: (RouteEfficiencyRoute) -> Double
    ) -> TSChartSeries {
        let points = plotted.enumerated().map { index, route in
            TSChartPoint(
                x: Double(index),
                y: Double(RouteEfficiencyFormat.efficiencyRounded(value(route), units)),
                id: "\(id)-\(route.id)"
            )
        }
        return TSChartSeries(id: id, name: name, nameText: text, points: points, colorIndex: colorIndex)
    }

    /// A static legend (web recharts `<Legend />`) — best / avg / worst with the active unit.
    private var legend: some View {
        let unit = RouteEfficiencyFormat.efficiencyUnit(units)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.md) {
                legendItem(key: "routeEfficiency.best", unit: unit, colorIndex: 2)
                legendItem(key: "routeEfficiency.avgLabel", unit: unit, colorIndex: 4)
                legendItem(key: "routeEfficiency.worst", unit: unit, colorIndex: 5)
            }
        }
        .accessibilityHidden(true)
    }

    private func legendItem(key: String.LocalizationValue, unit: String, colorIndex: Int) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(TSChartPalette.color(at: colorIndex))
                .frame(width: 8, height: 8)
            Text(verbatim: "\(String(localized: key)) \(unit)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
    }

    /// The route labels beneath the grouped bars (web Y-axis categories; the bar wrapper uses a numeric
    /// x-axis so the names are surfaced here).
    private var routeAxis: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(plotted) { route in
                Text(verbatim: RouteEfficiencyFormat.chartLabel(start: route.startLocation, end: route.endLocation))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity)
                    .lineLimit(1)
            }
        }
        .accessibilityHidden(true)
    }

    /// Web `ChartContainer` `dataColumns` (Route / Best / Avg / Worst) surfaced as the exportable CSV.
    private var csv: String {
        let unit = RouteEfficiencyFormat.efficiencyUnit(units)
        let header = [
            String(localized: "routeEfficiency.col.route"),
            "\(String(localized: "routeEfficiency.best")) \(unit)",
            "\(String(localized: "routeEfficiency.avgLabel")) \(unit)",
            "\(String(localized: "routeEfficiency.worst")) \(unit)"
        ].joined(separator: ",")
        let rows = plotted.map { route in
            let label = RouteEfficiencyFormat.chartLabel(start: route.startLocation, end: route.endLocation)
            let best = RouteEfficiencyFormat.efficiencyRounded(route.bestEfficiency, units)
            let avg = RouteEfficiencyFormat.efficiencyRounded(route.avgEfficiency, units)
            let worst = RouteEfficiencyFormat.efficiencyRounded(route.worstEfficiency, units)
            return "\(label),\(best),\(avg),\(worst)"
        }
        return ([header] + rows).joined(separator: "\n")
    }
}
