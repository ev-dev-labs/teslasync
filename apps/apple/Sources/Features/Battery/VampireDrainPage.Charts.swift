import SwiftUI

// The two native Swift Charts on the Vampire Drain surface (web `VampireDrainPage`), built on
// the P3 wrappers (never a WKWebView): the Drain-Rate-Trend line (web `ChartContainer` +
// `LineChart`, GlassPanel6) and the Daily-Drain-While-Parked grouped bars (web
// `ChartContainer` + `BarChart` with Drain% + Parked-Hours series, GlassPanel7). Each renders
// its own empty state (never a blank region) and an accessible label; the series legend is
// shared with the sibling Battery charts (`BatteryChartLegend` / `BatteryLegendItem`).

// MARK: - Drain rate trend (web Drain Rate Trend — ChartContainer + LineChart, panel 6)

/// The drain-rate-trend line (web GlassPanel6 + `LineChart`): a `TSChartContainer` framing the
/// native `TSLineChart` of each session's %/hr drain rate over time, with a single-series
/// legend. Renders the no-sessions empty state when there are no entries.
struct VampireDrainTrendSection: View {
    let data: VampireDrainData

    var body: some View {
        TSChartContainer("Drain Rate Trend") {
            if data.hasEntries {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSLineChart(series: series)
                        .frame(height: 220)
                        .accessibilityLabel(Text("Drain Rate Trend"))
                    BatteryChartLegend(items: legend)
                }
            } else {
                TSEmptyState(title: "No drain sessions recorded yet.", systemImage: "chart.xyaxis.line")
                    .frame(maxWidth: .infinity, minHeight: 200)
            }
        }
    }

    /// Web `<Line dataKey="drain_rate_pct_hr" name={t('Drain Rate')} stroke={CHART_COLORS[2]} />`
    /// — the rate series, positioned by session index on the numeric x-axis.
    private var series: [TSChartSeries] {
        let points = data.entries.enumerated().map { index, entry in
            TSChartPoint(x: Double(index), y: entry.drainRatePctHr, id: "rate-\(entry.id)")
        }
        return [
            TSChartSeries(id: "rate", name: "Drain Rate", nameText: "Drain Rate", points: points, colorIndex: 2)
        ]
    }

    private var legend: [BatteryLegendItem] {
        [BatteryLegendItem(id: "rate", name: "Drain Rate", color: TSChartPalette.color(at: 2))]
    }
}

// MARK: - Daily drain (web Daily Drain While Parked — ChartContainer + BarChart, panel 7)

/// The daily-drain grouped bars (web GlassPanel7 + `BarChart`): a `TSChartContainer` framing
/// the native `TSBarChart` grouping each day's drain percent and parked hours, with a series
/// legend. Renders the no-data empty state when there are no daily buckets.
struct VampireDailyDrainSection: View {
    let data: VampireDrainData

    var body: some View {
        TSChartContainer("Daily Drain While Parked") {
            if data.hasDaily {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSBarChart(series: series)
                        .frame(height: 260)
                        .accessibilityLabel(Text("Daily Drain While Parked"))
                    BatteryChartLegend(items: legend)
                }
            } else {
                TSEmptyState(title: "No drain sessions recorded yet.", systemImage: "chart.bar.xaxis")
                    .frame(maxWidth: .infinity, minHeight: 200)
            }
        }
    }

    /// Web `<Bar dataKey="drain_pct" name={t('Drain %')} fill={CHART_COLORS[5]} />` +
    /// `<Bar dataKey="hours_parked" name={t('Parked Hours')} fill={CHART_COLORS[0]} />`,
    /// grouped per day on the numeric x-axis.
    private var series: [TSChartSeries] {
        let drainPoints = data.daily.enumerated().map { index, day in
            TSChartPoint(x: Double(index), y: day.drainPct, id: "drain-\(day.date)")
        }
        let parkedPoints = data.daily.enumerated().map { index, day in
            TSChartPoint(x: Double(index), y: day.hoursParked, id: "parked-\(day.date)")
        }
        return [
            TSChartSeries(
                id: "drain", name: "Drain %", nameText: "Drain %", points: drainPoints, colorIndex: 5
            ),
            TSChartSeries(
                id: "parked", name: "Parked Hours", nameText: "Parked Hours", points: parkedPoints, colorIndex: 0
            )
        ]
    }

    private var legend: [BatteryLegendItem] {
        [
            BatteryLegendItem(id: "drain", name: "Drain %", color: TSChartPalette.color(at: 5)),
            BatteryLegendItem(id: "parked", name: "Parked Hours", color: TSChartPalette.color(at: 0))
        ]
    }
}
