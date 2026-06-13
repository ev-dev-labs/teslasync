import SwiftUI

// The time-series charts: the imbalance trend (web GlassPanel11 — LineChart), the
// cell-voltage-over-time lines (web GlassPanel12 — LineChart), and the voltage-spread
// trend (web Voltage-Spread-Trend — ChartContainer + AreaChart). All use the P3
// native Swift Charts wrappers; each renders a visible legend + its own empty state.

/// A compact time-range caption beneath a time-series chart (the wrappers use a
/// numeric x-axis, so the sampled date span is surfaced here).
struct BatteryTimeAxis: View {
    let points: [BatteryCellHistoryPoint]

    var body: some View {
        if let first = points.first, let last = points.last {
            HStack {
                Text(verbatim: BatteryCellsFormat.shortDate(first.timestamp))
                Spacer()
                Text(verbatim: BatteryCellsFormat.shortDate(last.timestamp))
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
        }
    }
}

// MARK: - Imbalance trend (web GlassPanel11 — LineChart)

/// The imbalance trend line (web GlassPanel11): pack imbalance in millivolts over
/// time, with the nominal (5 mV) and warning (15 mV) bands surfaced as references.
struct BatteryCellsImbalanceTrendSection: View {
    let data: BatteryCellData

    private var series: [TSChartSeries] {
        let points = data.history.enumerated().map { index, point in
            TSChartPoint(x: Double(index), y: point.imbalanceMv, id: "imb-\(index)")
        }
        return [TSChartSeries(
            id: "imbalance",
            name: "Imbalance (mV)",
            nameText: "Imbalance (mV)",
            points: points,
            colorIndex: 3
        )]
    }

    private var references: [BatteryReferenceItem] {
        [
            BatteryReferenceItem(id: "nominal", label: "Nominal", value: "5 mV", color: TSChartPalette.color(at: 1)),
            BatteryReferenceItem(id: "warning", label: "Warning", value: "15 mV", color: TSChartPalette.color(at: 5))
        ]
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSubhead("Imbalance Trend")
                if data.history.isEmpty {
                    BatteryChartEmpty(height: 240)
                } else {
                    TSLineChart(series: series, smooth: false)
                        .frame(height: 240)
                        .accessibilityLabel(Text("Imbalance Trend"))
                    BatteryChartLegend(items: [BatteryLegendItem(
                        id: "imbalance",
                        name: "Imbalance (mV)",
                        color: TSChartPalette.color(at: 3)
                    )])
                    BatteryReferenceRow(items: references)
                    BatteryTimeAxis(points: data.history)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Cell voltage over time (web GlassPanel12 — LineChart)

/// The cell-voltage-over-time lines (web GlassPanel12): minimum, average, and maximum
/// cell voltage across the history window.
struct BatteryCellsVoltageOverTimeSection: View {
    let data: BatteryCellData

    private var series: [TSChartSeries] {
        [
            line(id: "min", name: "Min Voltage", colorIndex: 5) { $0.minVoltage },
            line(id: "avg", name: "Avg Voltage", colorIndex: 0) { $0.avgVoltage },
            line(id: "max", name: "Max Voltage", colorIndex: 1) { $0.maxVoltage }
        ]
    }

    private var legend: [BatteryLegendItem] {
        [
            BatteryLegendItem(id: "min", name: "Min Voltage", color: TSChartPalette.color(at: 5)),
            BatteryLegendItem(id: "avg", name: "Avg Voltage", color: TSChartPalette.color(at: 0)),
            BatteryLegendItem(id: "max", name: "Max Voltage", color: TSChartPalette.color(at: 1))
        ]
    }

    private func line(
        id: String,
        name: LocalizedStringKey,
        colorIndex: Int,
        value: (BatteryCellHistoryPoint) -> Double
    ) -> TSChartSeries {
        let nameText = id == "min" ? "Min Voltage" : id == "avg" ? "Avg Voltage" : "Max Voltage"
        let points = data.history.enumerated().map { index, point in
            TSChartPoint(x: Double(index), y: value(point), id: "\(id)-\(index)")
        }
        return TSChartSeries(id: id, name: name, nameText: nameText, points: points, colorIndex: colorIndex)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSubhead("Cell Voltage Over Time")
                if data.history.isEmpty {
                    BatteryChartEmpty(height: 280)
                } else {
                    TSLineChart(series: series)
                        .frame(height: 280)
                        .accessibilityLabel(Text("Cell Voltage Over Time"))
                    BatteryChartLegend(items: legend)
                    BatteryAxisCaption(yLabel: "Voltage (V)", xLabel: "Cell #")
                    BatteryTimeAxis(points: data.history)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Voltage spread trend (web Voltage-Spread-Trend — ChartContainer + AreaChart)

/// The voltage-spread trend (web Voltage-Spread-Trend): a `TSChartContainer` framing
/// an `TSAreaChart` of the per-sample spread, or the not-enough-history empty state.
struct BatteryCellsSpreadTrendSection: View {
    let data: BatteryCellData

    private var series: [TSChartSeries] {
        let points = data.spreadTrend.map { point in
            TSChartPoint(x: Double(point.index), y: point.spreadMv, id: "spread-\(point.index)")
        }
        return [TSChartSeries(
            id: "spread",
            name: "battery.cells.chart.voltageSpread",
            nameText: "Voltage Spread (mV)",
            points: points,
            colorIndex: 6
        )]
    }

    var body: some View {
        TSChartContainer("battery.cells.chart.spreadTrend", summary: "battery.cells.chart.spreadTrend.aria") {
            if data.spreadTrend.isEmpty {
                TSEmptyState(title: "battery.cells.chart.noSpreadTrend", systemImage: "waveform.path.ecg")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSAreaChart(series: series)
                        .frame(height: 220)
                        .accessibilityLabel(Text("battery.cells.chart.spreadTrend.aria"))
                    BatteryChartLegend(items: [BatteryLegendItem(
                        id: "spread",
                        name: "battery.cells.chart.voltageSpread",
                        color: TSChartPalette.color(at: 6)
                    )])
                    BatteryTimeAxis(points: data.history)
                }
            }
        }
    }
}
