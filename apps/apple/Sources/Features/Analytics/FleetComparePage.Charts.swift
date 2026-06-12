import SwiftUI

// The two overlaid comparison charts (web Monthly-Distance `ChartContainer` + `LineChart` and
// Drives-per-Month `ChartContainer` + `BarChart`), built on the P3 Swift Charts wrappers. Each
// renders its own empty state (never a blank region) and an accessible summary.

// MARK: - Monthly distance line chart (web Monthly-Distance ChartContainer + LineChart)

/// Overlaid monthly-distance line chart for both vehicles (web `ChartContainer` + `LineChart`).
/// Distances convert from SI meters to the user's distance unit at this display boundary.
struct FleetCompareMonthlyDistanceSection: View {
    let points: [FleetCompareMonthlyPoint]
    let nameA: String
    let nameB: String
    let units: UnitPreferences

    var body: some View {
        TSChartContainer("comparison.monthlyDistance", summary: "comparison.monthlyDistance.aria") {
            if points.isEmpty {
                TSEmptyState(title: "comparison.noMonthlyData", systemImage: "chart.line.uptrend.xyaxis")
            } else {
                VStack(spacing: TSSpacing.sm) {
                    TSLineChart(series: series)
                        .frame(height: 240)
                    FleetCompareChartLegend(nameA: nameA, nameB: nameB)
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("comparison.monthlyDistance.aria"))
            }
        }
    }

    private var series: [TSChartSeries] {
        let pointsA = points.enumerated().map { index, point in
            TSChartPoint(x: Double(index), y: Units.convertDistance(point.distanceAM, units), id: "a-\(point.month)")
        }
        let pointsB = points.enumerated().map { index, point in
            TSChartPoint(x: Double(index), y: Units.convertDistance(point.distanceBM, units), id: "b-\(point.month)")
        }
        return [
            TSChartSeries(id: "a", name: LocalizedStringKey(nameA), nameText: nameA, points: pointsA, colorIndex: 0),
            TSChartSeries(id: "b", name: LocalizedStringKey(nameB), nameText: nameB, points: pointsB, colorIndex: 1)
        ]
    }
}

// MARK: - Drives per month bar chart (web Drives-per-Month ChartContainer + BarChart)

/// Grouped drives-per-month bar chart for both vehicles (web `ChartContainer` + `BarChart`).
struct FleetCompareDrivesSection: View {
    let points: [FleetCompareMonthlyPoint]
    let nameA: String
    let nameB: String

    var body: some View {
        TSChartContainer("comparison.drivesPerMonth", summary: "comparison.drivesPerMonth.aria") {
            if points.isEmpty {
                TSEmptyState(title: "comparison.noDrivesData", systemImage: "chart.bar.xaxis")
            } else {
                VStack(spacing: TSSpacing.sm) {
                    TSBarChart(series: series)
                        .frame(height: 220)
                    FleetCompareChartLegend(nameA: nameA, nameB: nameB)
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("comparison.drivesPerMonth.aria"))
            }
        }
    }

    private var series: [TSChartSeries] {
        let pointsA = points.enumerated().map { index, point in
            TSChartPoint(x: Double(index), y: Double(point.drivesA), id: "a-\(point.month)")
        }
        let pointsB = points.enumerated().map { index, point in
            TSChartPoint(x: Double(index), y: Double(point.drivesB), id: "b-\(point.month)")
        }
        return [
            TSChartSeries(id: "a", name: LocalizedStringKey(nameA), nameText: nameA, points: pointsA, colorIndex: 0),
            TSChartSeries(id: "b", name: LocalizedStringKey(nameB), nameText: nameB, points: pointsB, colorIndex: 1)
        ]
    }
}
