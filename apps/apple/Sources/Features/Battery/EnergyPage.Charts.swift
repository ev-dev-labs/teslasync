import SwiftUI

// The charts on the Energy surface, built on the P3 native Swift Charts wrappers (never a
// WKWebView): the four hero `EnergyGauge`s, the Energy-&-Cost-Daily composed chart (energy
// bars + efficiency line), the Efficiency-Trend area chart (efficiency + distance), the
// Charging-by-Time-of-Day bar chart (energy + session count), and the Charger-Type-Breakdown
// donut + legend list. Each renders its own empty state (never a blank region) and an
// accessible summary; SI watt-hours / metres convert to the user's units at this boundary
// (ADR-005). The web uses dual Y-axes; the native single-axis wrappers convert both series to
// display units so they share a comparable scale and both stay visible.

// MARK: - Hero gauges (web Hero GlassPanel — 4 RadialGauges, or the empty hero)

/// The hero panel (web Hero GlassPanel): four gauges (Energy Used, Efficiency, CO₂ Saved,
/// Total Cost), or — when the vehicle has produced no energy data at all — an honest empty
/// state instead of four misleading zeros (web `hasNoEnergyData`).
struct EnergyHeroSection: View {
    let model: EnergyPageModel
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.lg)]

    var body: some View {
        TSGlassPanel {
            if model.hasNoEnergyData {
                TSEmptyState(
                    title: "energy.empty.hero",
                    systemImage: "bolt.fill"
                )
                .frame(maxWidth: .infinity, minHeight: 140)
            } else {
                LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
                    energyGauge
                    efficiencyGauge
                    co2Gauge
                    costGauge
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var energyGauge: some View {
        let value = Units.convertEnergy(model.totalEnergyWh, units)
        return EnergyGauge(
            value: value,
            max: Swift.max(value * 1.3, 100),
            unit: units.energy,
            label: "energy.gauge.energyUsed",
            colorIndex: 4
        )
    }

    private var efficiencyGauge: some View {
        // Web `max={toEfficiencyDisplay(300)}` is ported verbatim, including its magnitude.
        let value = EnergyFormat.efficiencyDisplay(model.efficiencyWhPerM, units)
        return EnergyGauge(
            value: value,
            max: EnergyFormat.efficiencyDisplay(300, units),
            unit: EnergyFormat.efficiencyUnit(units),
            label: "energy.gauge.efficiency",
            colorIndex: 2
        )
    }

    private var co2Gauge: some View {
        EnergyGauge(
            value: model.co2SavedKg,
            max: Swift.max(model.co2SavedKg * 1.5, 50),
            unit: "kg",
            label: "energy.gauge.co2Saved",
            colorIndex: 6
        )
    }

    private var costGauge: some View {
        EnergyGauge(
            value: model.totalCost,
            max: Swift.max(model.totalCost * 1.5, 50),
            unit: "$",
            label: "energy.gauge.totalCost",
            colorIndex: 1
        )
    }
}

// MARK: - Energy & Cost Daily (web ChartContainer + ComposedChart)

/// The Energy-&-Cost-Daily panel (web `ChartContainer` + `ComposedChart`): daily energy bars
/// with the efficiency trend overlaid as a line, or the no-energy-data empty state. Energy is
/// shown in the display energy unit and efficiency in Wh per display distance so both series
/// share a comparable single-axis scale.
struct EnergyCostDailySection: View {
    let rows: [EnergyUsagePoint]
    let units: UnitPreferences

    var body: some View {
        TSChartContainer("energy.chart.energyCostDaily", summary: "energy.chart.energyCostDaily.aria") {
            if rows.isEmpty {
                TSEmptyState(title: "energy.chart.noEnergyData", systemImage: "bolt.fill")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSComposedChart(bars: energyBars, line: efficiencyLine)
                        .frame(height: 220)
                        .accessibilityLabel(Text("energy.chart.energyCostDaily.aria"))
                    EnergyChartLegend(items: legend)
                    EnergyDateAxis(labels: rows.map(\.date))
                }
            }
        }
    }

    private var energyBars: TSChartSeries {
        let points = rows.enumerated().map { index, row in
            TSChartPoint(x: Double(index), y: Units.convertEnergy(row.energyWh, units), id: "e-\(row.date)")
        }
        return TSChartSeries(
            id: "energy", name: "energy.chart.energy", nameText: "Energy", points: points, colorIndex: 4
        )
    }

    private var efficiencyLine: TSChartSeries {
        let points = rows.enumerated().map { index, row in
            let value = EnergyFormat.efficiencyDisplay(row.efficiencyWhPerM, units)
            return TSChartPoint(x: Double(index), y: value, id: "f-\(row.date)")
        }
        let unit = EnergyFormat.efficiencyUnit(units)
        return TSChartSeries(id: "eff", name: LocalizedStringKey(unit), nameText: unit, points: points, colorIndex: 2)
    }

    private var legend: [EnergyLegendItem] {
        [
            EnergyLegendItem(id: "energy", name: "energy.chart.energy", color: TSChartPalette.color(at: 4)),
            EnergyLegendItem(
                id: "eff",
                name: LocalizedStringKey(EnergyFormat.efficiencyUnit(units)),
                color: TSChartPalette.color(at: 2)
            )
        ]
    }
}

// MARK: - Efficiency Trend (web ChartContainer + AreaChart)

/// The Efficiency-Trend panel (web `ChartContainer` + `AreaChart`): the daily efficiency and
/// distance areas, or the no-efficiency-data empty state. SI metres convert to the user's
/// distance unit at this boundary.
struct EnergyEfficiencyTrendSection: View {
    let rows: [EnergyUsagePoint]
    let units: UnitPreferences

    var body: some View {
        TSChartContainer("energy.chart.efficiencyTrend", summary: "energy.chart.efficiencyTrend.aria") {
            if rows.isEmpty {
                TSEmptyState(title: "energy.chart.noEfficiencyData", systemImage: "waveform.path.ecg")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSAreaChart(series: series)
                        .frame(height: 220)
                        .accessibilityLabel(Text("energy.chart.efficiencyTrend.aria"))
                    EnergyChartLegend(items: legend)
                    EnergyDateAxis(labels: rows.map(\.date))
                }
            }
        }
    }

    private var series: [TSChartSeries] {
        let unit = EnergyFormat.efficiencyUnit(units)
        let efficiency = rows.enumerated().map { index, row in
            let value = EnergyFormat.efficiencyDisplay(row.efficiencyWhPerM, units)
            return TSChartPoint(x: Double(index), y: value, id: "f-\(row.date)")
        }
        let distance = rows.enumerated().map { index, row in
            TSChartPoint(x: Double(index), y: Units.convertDistance(row.distanceM, units), id: "d-\(row.date)")
        }
        return [
            TSChartSeries(id: "eff", name: LocalizedStringKey(unit), nameText: unit, points: efficiency, colorIndex: 2),
            TSChartSeries(id: "dist", name: distanceName, nameText: "Distance", points: distance, colorIndex: 4)
        ]
    }

    private var distanceName: LocalizedStringKey {
        LocalizedStringKey(EnergyStrings.distanceSeriesName(units.distance))
    }

    private var legend: [EnergyLegendItem] {
        [
            EnergyLegendItem(
                id: "eff",
                name: LocalizedStringKey(EnergyFormat.efficiencyUnit(units)),
                color: TSChartPalette.color(at: 2)
            ),
            EnergyLegendItem(id: "dist", name: distanceName, color: TSChartPalette.color(at: 4))
        ]
    }
}

// MARK: - Charging by Time of Day (web ChartContainer + BarChart)

/// The Charging-by-Time-of-Day panel (web `ChartContainer` + `BarChart`): energy and session
/// count grouped into the four six-hour buckets, with the off-peak / solar tips beneath, or
/// the no-data empty state.
struct EnergyTimeOfDaySection: View {
    let buckets: [EnergyTimeOfDayBucket]
    let units: UnitPreferences

    var body: some View {
        TSChartContainer("energy.chart.chargingByTime", summary: "energy.chart.chargingByTime.aria") {
            if buckets.isEmpty {
                TSEmptyState(title: "common.noData", systemImage: "waveform.path.ecg")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSBarChart(series: series)
                        .frame(height: 200)
                        .accessibilityLabel(Text("energy.chart.chargingByTime.aria"))
                    EnergyChartLegend(items: legend)
                    EnergyBucketAxis(labels: buckets.map(\.name))
                    tips
                }
            }
        }
    }

    private var series: [TSChartSeries] {
        let energy = buckets.map { bucket in
            TSChartPoint(x: Double(bucket.id), y: Units.convertEnergy(bucket.energyWh, units), id: "e-\(bucket.id)")
        }
        let count = buckets.map { bucket in
            TSChartPoint(x: Double(bucket.id), y: Double(bucket.count), id: "c-\(bucket.id)")
        }
        return [
            TSChartSeries(
                id: "energy", name: "energy.chart.energyKwh", nameText: "Energy", points: energy, colorIndex: 1
            ),
            TSChartSeries(
                id: "count", name: "energy.chart.sessions", nameText: "Sessions", points: count, colorIndex: 6
            )
        ]
    }

    private var legend: [EnergyLegendItem] {
        [
            EnergyLegendItem(id: "energy", name: "energy.chart.energyKwh", color: TSChartPalette.color(at: 1)),
            EnergyLegendItem(id: "count", name: "energy.chart.sessions", color: TSChartPalette.color(at: 6))
        ]
    }

    private var tips: some View {
        HStack(spacing: TSSpacing.lg) {
            Label("energy.tip.offPeak", systemImage: "moon.fill")
            Label("energy.tip.solar", systemImage: "sun.max.fill")
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .labelStyle(.titleAndIcon)
    }
}

// MARK: - Charger Type Breakdown (web ChartContainer + PieChart + legend list)

/// The Charger-Type-Breakdown panel (web `ChartContainer` + `PieChart` + the legend list):
/// a donut of energy share by charger category, with a per-category list of sessions, energy,
/// cost, and cost-per-kWh, or the no-data empty state.
struct EnergyChargerBreakdownSection: View {
    let rows: [EnergyChargerBreakdownRow]
    let units: UnitPreferences

    var body: some View {
        TSChartContainer("energy.chart.chargerBreakdown", summary: "energy.chart.chargerBreakdown.aria") {
            if rows.isEmpty {
                TSEmptyState(title: "common.noData", systemImage: "waveform.path.ecg")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: TSSpacing.lg) {
                        donut
                        list
                    }
                    VStack(alignment: .leading, spacing: TSSpacing.lg) {
                        donut
                        list
                    }
                }
            }
        }
    }

    private var donut: some View {
        TSPieChart(slices: slices, showsLegend: false)
            .frame(width: 180, height: 180)
            .accessibilityLabel(Text("energy.chart.chargerBreakdown.aria"))
    }

    private var slices: [TSChartSlice] {
        rows.map { row in
            TSChartSlice(
                id: row.id,
                name: LocalizedStringKey(row.name),
                nameText: row.name,
                value: row.energyWh,
                colorIndex: row.colorIndex
            )
        }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(rows) { row in
                EnergyChargerRow(row: row, units: units)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One charger-category row in the breakdown list (web right-column entry): colour dot + name,
/// session count, then energy / cost / cost-per-kWh.
struct EnergyChargerRow: View {
    let row: EnergyChargerBreakdownRow
    let units: UnitPreferences

    private var perKwh: Double {
        row.energyWh > 0 ? row.cost / (row.energyWh / 1000) : 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Circle()
                    .fill(TSChartPalette.color(at: row.colorIndex))
                    .frame(width: 10, height: 10)
                Text(verbatim: row.name)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                (Text(verbatim: "\(row.count) ") + Text("energy.breakdown.sessions"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            HStack(spacing: TSSpacing.md) {
                Text(verbatim: Units.formatEnergy(row.energyWh, units))
                    .foregroundStyle(TSChartPalette.color(at: 4))
                Text(verbatim: EnergyFormat.currency(row.cost))
                    .foregroundStyle(Color.TS.statusSuccess)
                Spacer(minLength: 0)
                Text(verbatim: "\(EnergyFormat.currency(perKwh, fractionDigits: 3))/kWh")
                    .foregroundStyle(Color.TS.textMuted)
            }
            .font(Font.TS.caption)
            .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }
}
