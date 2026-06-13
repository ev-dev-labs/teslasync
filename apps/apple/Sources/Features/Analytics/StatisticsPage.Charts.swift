import SwiftUI

// The three charts on the Statistics surface, built on the P3 native Swift Charts wrappers
// (never a WKWebView): the battery state-of-health `RadialGauge`, the state-distribution
// `PieChart` inside a `ChartContainer`, and the fleet vehicle-comparison `BarChart` inside a
// `ChartContainer`. Each renders its own empty state (never a blank region) and an accessible
// summary; SI values convert to the user's unit at the boundary.

// MARK: - Battery state-of-health radial gauge (web RadialGauge)

/// State-of-health radial gauge (web `RadialGauge value={round(soh)} … label="Health"`). Wraps
/// the P3 `TSRadialGauge`, colored from the success/green palette slot to match the web `#10b981`.
struct StatisticsBatteryGauge: View {
    let fraction: Double

    var body: some View {
        TSRadialGauge(value: fraction, label: "statistics.health", colorIndex: 2)
            .frame(maxWidth: .infinity)
            .accessibilityLabel(Text("statistics.health"))
    }
}

// MARK: - State distribution pie (web State-Distribution ChartContainer + PieChart)

/// The vehicle state-distribution pie chart (web `ChartContainer` + `PieChart`). Each slice is a
/// state's share of total time; renders the no-states empty when there is no data.
struct StatisticsStateDistributionSection: View {
    let slices: [StatisticsStateSlice]

    var body: some View {
        TSChartContainer("statistics.stateDistribution", summary: "statistics.stateDistribution.aria") {
            if slices.isEmpty {
                TSEmptyState(title: "statistics.noStates", systemImage: "clock")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                TSPieChart(slices: chartSlices)
                    .frame(height: 240)
                    .accessibilityLabel(Text("statistics.stateDistribution.aria"))
            }
        }
    }

    private var chartSlices: [TSChartSlice] {
        slices.map { slice in
            TSChartSlice(
                id: slice.state,
                name: LocalizedStringKey(slice.state),
                nameText: slice.state,
                value: Double(slice.percent),
                colorIndex: slice.colorIndex
            )
        }
    }
}

// MARK: - Vehicle comparison bars (web Vehicle-Comparison ChartContainer + BarChart)

/// The fleet vehicle-comparison bar chart (web `ChartContainer` + `BarChart`): per-vehicle
/// distance and energy bars. Distance converts from SI meters to the user's unit and energy from
/// SI watt-hours to kWh at this boundary. Below two vehicles it shows the single-vehicle empty.
struct StatisticsComparisonSection: View {
    let items: [StatisticsVehicleComparison]
    let showsComparison: Bool
    let units: UnitPreferences

    var body: some View {
        TSChartContainer("statistics.vehicleComparison", summary: "statistics.vehicleComparison.aria") {
            if showsComparison {
                VStack(spacing: TSSpacing.sm) {
                    TSBarChart(series: series)
                        .frame(height: 280)
                    StatisticsComparisonLegend(distanceUnit: units.distance)
                    vehicleAxis
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("statistics.vehicleComparison.aria"))
            } else {
                TSEmptyState(title: "statistics.singleVehicle", systemImage: "car")
                    .frame(maxWidth: .infinity, minHeight: 200)
            }
        }
    }

    /// Two grouped series — distance (converted) and energy (kWh) — keyed by vehicle index
    /// (web `BarChart` with `distance` + `energy` bars).
    private var series: [TSChartSeries] {
        let distancePoints = items.enumerated().map { index, item in
            TSChartPoint(x: Double(index), y: Units.convertDistance(item.distanceM, units), id: "d-\(item.id)")
        }
        let energyPoints = items.enumerated().map { index, item in
            TSChartPoint(x: Double(index), y: item.energyWh / 1000, id: "e-\(item.id)")
        }
        return [
            TSChartSeries(
                id: "distance",
                name: LocalizedStringKey(distanceSeriesName),
                nameText: distanceSeriesName,
                points: distancePoints,
                colorIndex: 0
            ),
            TSChartSeries(
                id: "energy",
                name: LocalizedStringKey(energySeriesName),
                nameText: energySeriesName,
                points: energyPoints,
                colorIndex: 1
            )
        ]
    }

    /// Web `${t('statistics.distance')} (${distanceUnit})`.
    private var distanceSeriesName: String {
        "\(String(localized: "statistics.distance", defaultValue: "Distance")) (\(units.distance))"
    }

    /// Web `t('statistics.energy', 'Energy (kWh)')`.
    private var energySeriesName: String {
        String(localized: "statistics.energy", defaultValue: "Energy (kWh)")
    }

    /// Per-vehicle name row beneath the bars (the bar chart's category axis is index-based, so the
    /// vehicle labels are surfaced here, mirroring the web X-axis ticks).
    private var vehicleAxis: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(items) { item in
                Text(verbatim: item.name)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Two-series legend for the comparison chart (web recharts `<ChartLegend />`): distance + energy.
struct StatisticsComparisonLegend: View {
    let distanceUnit: String

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            legendItem(
                colorIndex: 0,
                text: "\(String(localized: "statistics.distance", defaultValue: "Distance")) (\(distanceUnit))"
            )
            legendItem(colorIndex: 1, text: String(localized: "statistics.energy", defaultValue: "Energy (kWh)"))
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func legendItem(colorIndex: Int, text: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(TSChartPalette.color(at: colorIndex)).frame(width: 8, height: 8)
            Text(verbatim: text)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
    }
}
