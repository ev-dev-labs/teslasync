//
//  OverviewTab.Charts.swift
//  TeslaSync — P4 feature view · 0059 · OverviewTab (Apple)
//
//  The Swift Charts surfaces split out of the view chrome (kept under the per-file length
//  budget): the Distance-by-Vehicle bars, the Day-of-Week and Monthly-Cost composed
//  bars+line charts with their Recharts-style dual axis (via `OverviewAxisScale`), and the
//  color-dot legend. Shared P1/S9 tokens; no networking, no Tailwind ports.
//

import Charts
import SwiftUI

// MARK: - Custom legend (color dot + localized series name)

/// A horizontal color-dot legend for the composed charts (web Recharts `<Legend/>`).
struct OverviewChartLegend: View {
    struct Item: Identifiable {
        let id: String
        let name: String
        let color: Color
    }

    let items: [Item]

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ForEach(items) { item in
                HStack(spacing: TSSpacing.xs) {
                    Circle().fill(item.color).frame(width: 8, height: 8)
                    Text(verbatim: item.name)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Distance by Vehicle (web `BarChart`)

/// The "Distance by Vehicle" bar chart: one bar per vehicle, the SI distance already
/// converted into the user's display unit by `OverviewProjection`.
struct OverviewDistanceChart: View {
    let bars: [OverviewVehicleBar]
    let accessibilitySummary: String

    var body: some View {
        Chart(bars) { bar in
            BarMark(
                x: .value("vehicle", bar.name),
                y: .value("distance", bar.distance)
            )
            .foregroundStyle(TSChartPalette.color(at: 0))
            .cornerRadius(4)
        }
        .chartXAxis {
            AxisMarks { _ in
                AxisValueLabel().foregroundStyle(Color.TS.textMuted)
            }
        }
        .chartYAxis { overviewLeadingAxis() }
        .frame(height: 260)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }
}

// MARK: - Day of Week Pattern (web `ComposedChart` bars + line)

/// The "Day of Week Pattern" composed chart: weekday drive counts as bars (left axis) and the
/// average distance as a line (right axis), overlaid on one Swift Charts plot via
/// `OverviewAxisScale`.
struct OverviewDayChart: View {
    let data: [OverviewDayDatum]
    let scale: OverviewAxisScale
    let drivesName: String
    let avgName: String
    let accessibilitySummary: String

    var body: some View {
        Chart {
            ForEach(data) { datum in
                BarMark(
                    x: .value("day", datum.day),
                    y: .value("drives", datum.drives)
                )
                .foregroundStyle(TSChartPalette.color(at: 2))
                .cornerRadius(3)
            }
            ForEach(data) { datum in
                LineMark(
                    x: .value("day", datum.day),
                    y: .value("avgDistance", scale.scaleSecondary(datum.avgDistance))
                )
                .foregroundStyle(TSChartPalette.color(at: 3))
                .interpolationMethod(.catmullRom)
                .lineStyle(StrokeStyle(lineWidth: 2))
            }
        }
        .chartYAxis { overviewDualAxis(scale: scale) }
        .chartXAxis {
            AxisMarks { _ in
                AxisValueLabel().foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(height: 260)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }
}

// MARK: - Monthly Cost Comparison (web `ComposedChart` grouped bars + line)

/// The "Monthly Cost Comparison" composed chart: electric vs gas cost as grouped bars (left
/// axis) and savings as a line (right axis), overlaid via `OverviewAxisScale`.
struct OverviewMonthChart: View {
    let data: [OverviewMonthDatum]
    let scale: OverviewAxisScale
    let electricName: String
    let gasName: String
    let savingsName: String
    let accessibilitySummary: String

    var body: some View {
        Chart {
            ForEach(data) { datum in
                BarMark(
                    x: .value("month", datum.month),
                    y: .value("cost", datum.cost)
                )
                .position(by: .value("series", electricName))
                .foregroundStyle(TSChartPalette.color(at: 0))
                .cornerRadius(3)

                BarMark(
                    x: .value("month", datum.month),
                    y: .value("cost", datum.gasCost)
                )
                .position(by: .value("series", gasName))
                .foregroundStyle(TSChartPalette.color(at: 5))
                .cornerRadius(3)
            }
            ForEach(data) { datum in
                LineMark(
                    x: .value("month", datum.month),
                    y: .value("savings", scale.scaleSecondary(datum.savings))
                )
                .foregroundStyle(TSChartPalette.color(at: 1))
                .interpolationMethod(.catmullRom)
                .lineStyle(StrokeStyle(lineWidth: 2))
            }
        }
        .chartYAxis { overviewDualAxis(scale: scale) }
        .chartXAxis {
            AxisMarks { _ in
                AxisValueLabel().foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(height: 280)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }
}

// MARK: - Shared axis builders

/// A single leading (left) numeric axis with the token grid + abbreviated labels.
@AxisContentBuilder
private func overviewLeadingAxis() -> some AxisContent {
    AxisMarks(position: .leading) { value in
        AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
        AxisValueLabel {
            if let number = value.as(Double.self) {
                Text(OverviewFormat.axisLabel(number)).foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}

/// A Recharts-style dual axis: the leading axis shows the primary series in its own units;
/// the trailing axis recovers the secondary series' values from the shared scale.
@AxisContentBuilder
private func overviewDualAxis(scale: OverviewAxisScale) -> some AxisContent {
    AxisMarks(position: .leading) { value in
        AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
        AxisValueLabel {
            if let number = value.as(Double.self) {
                Text(OverviewFormat.axisLabel(number)).foregroundStyle(Color.TS.textMuted)
            }
        }
    }
    AxisMarks(position: .trailing) { value in
        AxisValueLabel {
            if let number = value.as(Double.self) {
                Text(OverviewFormat.axisLabel(scale.unscale(number))).foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}
