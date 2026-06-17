//
//  TeslaChargingSessionsCharts.swift
//  TeslaSync — P4 feature view · P7 · charging/TeslaChargingSessions (Apple) — Swift Charts
//
//  The native Swift Charts surface (never a WKWebView): the monthly charging-cost
//  bar chart (web Recharts `BarChart` inside a `ChartContainer`). Drawn with
//  `BarMark`, one bar per `YYYY-MM` bucket, the brand-accent gradient fill the web
//  uses (`#22d3ee`), the X axis labelled by month and the Y axis formatted as
//  currency. The panel wrapper reproduces the web `ChartContainer` (titled,
//  aria-labelled, fixed height) and shows the `noChartData` empty state — never a
//  blank region. Tokens for every color/typography value.
//

import Charts
import SwiftUI

// MARK: - Chart — Monthly cost (web `BarChart`)

/// The monthly charging-cost bar chart. Each `YYYY-MM` bucket is a `BarMark`
/// tinted with the brand-accent gradient; the caller renders the empty state when
/// there is no data, so this view always has bars to plot.
struct ChargingSessionsCostBarChart: View {
    let points: [ChargingMonthlyCostPoint]
    let currencyCode: String

    var body: some View {
        Chart(points) { point in
            BarMark(
                x: .value(monthAxisLabel, point.month),
                y: .value(totalAxisLabel, point.total)
            )
            .foregroundStyle(barGradient)
            .cornerRadius(4)
        }
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(height: 280)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(String(
            localized: "translation.tesla_sessions.monthlyCost.aria",
            defaultValue: "Monthly Tesla charging cost bar chart"
        )))
        .accessibilityValue(Text(accessibilityValue))
    }

    // MARK: Axes

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: .automatic) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let month = value.as(String.self) {
                    Text(month)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let amount = value.as(Double.self) {
                    Text(ChargingSessionsFormat.currency(amount, code: currencyCode, fractionDigits: 0))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    // MARK: Style + a11y

    /// Web `ChartGradient` `#22d3ee` at 0.6 opacity → solid accent.
    private var barGradient: LinearGradient {
        LinearGradient(
            colors: [Color.TS.chartSeriesRegen, Color.TS.chartSeriesRegen.opacity(0.55)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var monthAxisLabel: String {
        String(localized: "translation.tesla_sessions.col.month", defaultValue: "Month")
    }

    private var totalAxisLabel: String {
        String(localized: "translation.tesla_sessions.col.total", defaultValue: "Total ($)")
    }

    private var accessibilityValue: String {
        let total = points.reduce(0) { $0 + $1.total }
        let bars = "\(points.count)"
        let sum = ChargingSessionsFormat.currency(total, code: currencyCode, fractionDigits: 0)
        return "\(bars) · \(sum)"
    }
}

// MARK: - GlassPanel 8 — Monthly Charging Cost (web ChartContainer)

/// The monthly-cost chart panel (web `ChartContainer`): the titled, aria-labelled
/// header over the bar chart, with a redacted skeleton while the slice loads and
/// the `noChartData` `ContentUnavailableView` when there is no cost data.
struct ChargingSessionsMonthlyCostPanel: View {
    let points: [ChargingMonthlyCostPoint]
    let currencyCode: String
    let isLoading: Bool

    var body: some View {
        ChargingSessionsCard {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                ChargingSessionsSectionHeader(
                    systemImage: "chart.bar.fill",
                    title: String(
                        localized: "translation.tesla_sessions.monthlyCost",
                        defaultValue: "Monthly Charging Cost"
                    )
                )

                if isLoading {
                    chartSkeleton
                } else if points.isEmpty {
                    emptyState
                } else {
                    ChargingSessionsCostBarChart(points: points, currencyCode: currencyCode)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label(
                String(
                    localized: "translation.tesla_sessions.noChartData",
                    defaultValue: "No cost data yet. Click \"Refresh from Tesla\" to sync."
                ),
                systemImage: "dollarsign.circle"
            )
        }
        .frame(height: 280)
        .frame(maxWidth: .infinity)
    }

    private var chartSkeleton: some View {
        RoundedRectangle(cornerRadius: TSRadius.md)
            .fill(Color.TS.surface)
            .frame(height: 280)
            .redacted(reason: .placeholder) // parity:allow native shimmer for the chart loading state
    }
}
