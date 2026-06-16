import SwiftUI

// The daily charts on the Energy-Flow surface, built on the P3 native Swift Charts wrappers (never
// a WKWebView): the Daily-Energy-Usage area chart (web Section 3), and the paired Daily-Distance /
// Daily-Efficiency bar charts (web Section 4). Each renders its own empty state (never a blank
// region) and an accessible summary; SI watt-hours / metres convert to the user's units at this
// boundary (ADR-005). The date X-axis labels reuse the sibling `EnergyDateAxis` chrome since the
// wrappers plot a numeric x.

// MARK: - Chart panel header

/// The header row each daily-chart glass panel shows (web tinted icon + bold title).
private struct EnergyFlowChartHeader: View {
    let systemImage: String
    let colorIndex: Int
    let title: LocalizedStringKey

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .foregroundStyle(TSChartPalette.color(at: colorIndex))
                .accessibilityHidden(true)
            TSSubhead(title)
        }
    }
}

// MARK: - Daily Energy Usage (web Section 3 — GlassPanel15 + AreaChart)

/// The Daily-Energy-Usage panel (web Section 3 `GlassPanel` + `AreaChart`): the daily energy added
/// as a gradient area, or the no-daily-energy empty state.
struct EnergyFlowDailyEnergySection: View {
    let rows: [EnergyFlowDailyPoint]
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                EnergyFlowChartHeader(systemImage: "waveform.path.ecg", colorIndex: 0, title: "Daily Energy Usage")
                if rows.isEmpty {
                    TSEmptyState(title: "No daily energy data available.", systemImage: "bolt.slash")
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else {
                    TSAreaChart(series: [series])
                        .frame(height: 240)
                        .accessibilityLabel(Text("Daily Energy Usage"))
                    EnergyChartLegend(items: legendItems)
                    EnergyDateAxis(labels: rows.map(\.date))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var series: TSChartSeries {
        let points = rows.enumerated().map { index, row in
            TSChartPoint(x: Double(index), y: Units.convertEnergy(row.energyWh, units), id: "e-\(row.date)")
        }
        return TSChartSeries(id: "energy", name: "Energy", nameText: "Energy", points: points, colorIndex: 0)
    }

    private var legendItems: [EnergyLegendItem] {
        [EnergyLegendItem(id: "energy", name: "Energy", color: TSChartPalette.color(at: 0))]
    }
}

// MARK: - Daily Distance (web Section 4 left — GlassPanel16 + BarChart)

/// The Daily-Distance panel (web Section 4 left `GlassPanel` + `BarChart`): the daily distance
/// bars in the user's distance unit, or the no-daily-distance empty state.
struct EnergyFlowDailyDistanceSection: View {
    let rows: [EnergyFlowDailyPoint]
    let units: UnitPreferences

    private var seriesName: LocalizedStringKey {
        LocalizedStringKey(EnergyStrings.distanceSeriesName(units.distance))
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                EnergyFlowChartHeader(systemImage: "chart.bar.fill", colorIndex: 1, title: "Daily Distance")
                if rows.isEmpty {
                    TSEmptyState(title: "No daily distance data available.", systemImage: "chart.bar")
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else {
                    TSBarChart(series: [series])
                        .frame(height: 240)
                        .accessibilityLabel(Text("Daily Distance"))
                    EnergyChartLegend(items: legendItems)
                    EnergyDateAxis(labels: rows.map(\.date))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var series: TSChartSeries {
        let points = rows.enumerated().map { index, row in
            TSChartPoint(x: Double(index), y: Units.convertDistance(row.distanceM, units), id: "d-\(row.date)")
        }
        return TSChartSeries(id: "dist", name: seriesName, nameText: "Distance", points: points, colorIndex: 1)
    }

    private var legendItems: [EnergyLegendItem] {
        [EnergyLegendItem(id: "dist", name: seriesName, color: TSChartPalette.color(at: 1))]
    }
}

// MARK: - Daily Efficiency (web Section 4 right — GlassPanel17 + BarChart)

/// The Daily-Efficiency panel (web Section 4 right `GlassPanel` + `BarChart`): the daily efficiency
/// (filtered to days with a positive value, web `efficiencyChartData`) in Wh per display distance,
/// or the no-efficiency-data empty state.
struct EnergyFlowDailyEfficiencySection: View {
    let rows: [EnergyFlowDailyPoint]
    let units: UnitPreferences

    private var unit: String { EnergyFormat.efficiencyUnit(units) }

    private var efficiencyRows: [EnergyFlowDailyPoint] {
        rows.filter { $0.efficiencyWhPerM > 0 }
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                EnergyFlowChartHeader(
                    systemImage: "chart.line.uptrend.xyaxis",
                    colorIndex: 3,
                    title: "Daily Efficiency"
                )
                if efficiencyRows.isEmpty {
                    TSEmptyState(title: "No efficiency data available.", systemImage: "chart.bar")
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else {
                    TSBarChart(series: [series])
                        .frame(height: 240)
                        .accessibilityLabel(Text("Daily Efficiency"))
                    EnergyChartLegend(items: legendItems)
                    EnergyDateAxis(labels: efficiencyRows.map(\.date))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var series: TSChartSeries {
        let points = efficiencyRows.enumerated().map { index, row in
            let value = EnergyFormat.efficiencyDisplay(row.efficiencyWhPerM, units)
            return TSChartPoint(x: Double(index), y: value, id: "f-\(row.date)")
        }
        return TSChartSeries(id: "eff", name: LocalizedStringKey(unit), nameText: unit, points: points, colorIndex: 3)
    }

    private var legendItems: [EnergyLegendItem] {
        [EnergyLegendItem(id: "eff", name: LocalizedStringKey(unit), color: TSChartPalette.color(at: 3))]
    }
}
