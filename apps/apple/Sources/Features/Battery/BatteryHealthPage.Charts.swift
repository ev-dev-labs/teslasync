import SwiftUI

// The charts on the Battery Health surface, built on the P3 native Swift Charts wrappers
// (never a WKWebView): the four hero gauges (web `RadialGauge`s reproduced as the shared
// `EnergyGauge` value+unit ring), the capacity-trend projection (web `ChartContainer` +
// `ComposedChart` → a native multi-series line of actual + projected SOH), the
// estimated-range trend (web `ChartContainer` + `AreaChart`), the charge-level distribution
// (web `BarChart` of start/end SOC) with its habit tiles, and the AC/DC energy breakdown
// (web `ChartContainer` + `PieChart`) beside the charging-statistics panel. Each renders its
// own empty state (never a blank region) and an accessible summary; SI kilometres convert to
// the user's distance unit at this boundary (ADR-005). The shared chrome helpers
// (`BatteryChartLegend` / `BatteryReferenceRow` / `BatteryDegradationTimeAxis`) are reused
// from the sibling Battery charts.

// MARK: - Health score hero (web GlassPanel1 — 4 RadialGauges + band badge + years-to-80)

/// The health-score hero panel (web Hero `GlassPanel`): the SOH gauge with its
/// Excellent / Good / Degraded band badge, the capacity / degradation / cycles gauges,
/// and the years-to-80 % warranty figure.
struct BatteryHealthHeroSection: View {
    let analytics: BatteryHealthAnalytics
    let yearsTo80: String

    private let columns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.lg)]

    var body: some View {
        TSGlassPanel {
            LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.lg) {
                healthGauge
                EnergyGauge(
                    value: analytics.capacityPercent,
                    max: 100,
                    unit: "%",
                    label: "battery.gauge.capacity",
                    colorIndex: 4
                )
                EnergyGauge(
                    value: analytics.degradationRateYr,
                    max: 10,
                    unit: "%/yr",
                    label: "battery.gauge.degradation",
                    colorIndex: analytics.degradationColorIndex
                )
                EnergyGauge(
                    value: Double(analytics.totalCycles),
                    max: 1500,
                    unit: "",
                    label: "battery.gauge.cycles",
                    colorIndex: 6
                )
                yearsBlock
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var healthGauge: some View {
        VStack(spacing: TSSpacing.sm) {
            EnergyGauge(
                value: analytics.currentSoh,
                max: 100,
                unit: "/100",
                label: "battery.gauge.health",
                colorIndex: analytics.healthColorIndex
            )
            TSBadge(LocalizedStringKey(analytics.healthBandKey), tone: analytics.healthSeverity.tone)
        }
    }

    /// Web years-to-80 % figure + "Years to 80%" + "warranty threshold" captions.
    private var yearsBlock: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: yearsTo80)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            TSCaption("battery.yearsTo80")
            TSCaption("battery.warrantyNote")
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Capacity trend & prediction (web Capacity-Trend-Prediction — ComposedChart)

/// The capacity-trend projection (web `ChartContainer` + `ComposedChart`): a native
/// multi-series line of the actual SOH history plus the projected future, with the 80 %
/// warranty + 70 % threshold reference values surfaced beneath and the dashed-projection
/// note. Renders the not-enough-data empty state when there is nothing to plot.
struct BatteryHealthCapacityTrendSection: View {
    let rows: [BatteryHealthTrendRow]

    var body: some View {
        TSChartContainer("battery.chart.capacityTrend", summary: "battery.chart.capacityTrend.aria") {
            if rows.isEmpty {
                TSEmptyState(title: "battery.chart.noTrend", systemImage: "chart.line.uptrend.xyaxis")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSLineChart(series: series, smooth: false)
                        .frame(height: 260)
                        .accessibilityLabel(Text("battery.chart.capacityTrend.aria"))
                    BatteryChartLegend(items: legend)
                    BatteryReferenceRow(items: references)
                    TSCaption("battery.chart.dashedProjected")
                    BatteryDegradationTimeAxis(labels: rows.map(\.label))
                }
            }
        }
    }

    private var series: [TSChartSeries] {
        [
            lineSeries(id: "actual", name: "battery.chart.actual", text: "Actual %", color: 4) { $0.actual },
            lineSeries(id: "predicted", name: "battery.chart.predicted", text: "Predicted %", color: 6) { $0.predicted }
        ]
    }

    private func lineSeries(
        id: String,
        name: LocalizedStringKey,
        text: String,
        color: Int,
        value: (BatteryHealthTrendRow) -> Double?
    ) -> TSChartSeries {
        let points = rows.compactMap { row -> TSChartPoint? in
            guard let yValue = value(row) else { return nil }
            return TSChartPoint(x: Double(row.index), y: yValue, id: "\(id)-\(row.index)")
        }
        return TSChartSeries(id: id, name: name, nameText: text, points: points, colorIndex: color)
    }

    private var legend: [BatteryLegendItem] {
        [
            BatteryLegendItem(id: "actual", name: "battery.chart.actual", color: TSChartPalette.color(at: 4)),
            BatteryLegendItem(id: "predicted", name: "battery.chart.predicted", color: TSChartPalette.color(at: 6))
        ]
    }

    /// Web `ReferenceLine` labels: the 80 % warranty threshold and the 70 % critical line.
    private var references: [BatteryReferenceItem] {
        [
            BatteryReferenceItem(
                id: "warranty",
                label: "battery.degradation.warranty",
                value: "80%",
                color: TSChartPalette.color(at: 1)
            ),
            BatteryReferenceItem(
                id: "critical",
                label: "battery.health.degraded",
                value: "70%",
                color: TSChartPalette.color(at: 5)
            )
        ]
    }
}

// MARK: - Estimated range over time (web Estimated-Range-Over-Time — AreaChart)

/// The estimated-range trend (web `ChartContainer` + `AreaChart`): the per-snapshot range
/// area, or the no-range empty state. SI kilometres convert to the user's distance unit here.
struct BatteryHealthRangeTrendSection: View {
    let rows: [BatteryHealthRangeRow]
    let units: UnitPreferences

    var body: some View {
        TSChartContainer("battery.chart.rangeTrend", summary: "battery.chart.rangeTrend.aria") {
            if rows.isEmpty {
                TSEmptyState(title: "battery.chart.noRange", systemImage: "minus.plus.batteryblock")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSAreaChart(series: [series])
                        .frame(height: 220)
                        .accessibilityLabel(Text("battery.chart.rangeTrend.aria"))
                    BatteryChartLegend(items: legend)
                    BatteryDegradationTimeAxis(labels: rows.map(\.label))
                }
            }
        }
    }

    private var rangeName: LocalizedStringKey {
        LocalizedStringKey("\(String(localized: "battery.chart.range")) (\(units.distance))")
    }

    private var series: TSChartSeries {
        let points = rows.map { row in
            TSChartPoint(
                x: Double(row.index),
                y: (Units.convertDistance(row.rangeKm * 1000, units)).rounded(),
                id: "r-\(row.index)"
            )
        }
        return TSChartSeries(id: "range", name: rangeName, nameText: "Range", points: points, colorIndex: 2)
    }

    private var legend: [BatteryLegendItem] {
        [BatteryLegendItem(id: "range", name: rangeName, color: TSChartPalette.color(at: 2))]
    }
}
