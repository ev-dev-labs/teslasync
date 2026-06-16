import SwiftUI

// The distribution + breakdown charts on the Battery Health surface, built on the P3 native
// Swift Charts wrappers (never a WKWebView): the charge-level distribution (web GlassPanel18
// — `BarChart` of start/end SOC) with its habit tiles, and the AC/DC energy breakdown (web
// AC-DC-Energy-Breakdown — `PieChart`) beside the charging-statistics panel. Each renders its
// own empty state (never a blank region) and an accessible summary. The hero gauges + the
// capacity/range trend charts live in `BatteryHealthPage.Charts.swift`.

// MARK: - Charge level distribution (web GlassPanel18 — BarChart + habit tiles)

/// The charge-level distribution panel (web GlassPanel18): a `TSBarChart` of how many
/// sessions started vs ended in each 10 % band, with the four charging-habit tiles beneath,
/// or the no-sessions empty state.
struct BatteryHealthChargeDistSection: View {
    let buckets: [BatteryHealthChargeBucket]
    let habits: BatteryHealthHabits?

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if buckets.isEmpty {
                    TSEmptyState(title: "battery.chart.noSessions", systemImage: "bolt.fill")
                        .frame(maxWidth: .infinity, minHeight: 180)
                } else {
                    TSBarChart(series: series)
                        .frame(height: 200)
                        .accessibilityLabel(Text("battery.chart.chargeDist"))
                    BatteryChartLegend(items: legend)
                    BatteryHealthBucketAxis(labels: buckets.map(\.rangeLabel))
                    if let habits { habitTiles(habits) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            TSSubhead("battery.chart.chargeDist")
            TSCaption("battery.chart.chargeDistSub")
        }
    }

    private var series: [TSChartSeries] {
        let start = buckets.map { TSChartPoint(x: Double($0.bucket), y: Double($0.startCount), id: "s-\($0.bucket)") }
        let end = buckets.map { TSChartPoint(x: Double($0.bucket), y: Double($0.endCount), id: "e-\($0.bucket)") }
        return [
            TSChartSeries(
                id: "start", name: "battery.chart.chargeStarted", nameText: "Charge Started",
                points: start, colorIndex: 5
            ),
            TSChartSeries(
                id: "end", name: "battery.chart.chargeEnded", nameText: "Charge Ended", points: end, colorIndex: 2
            )
        ]
    }

    private var legend: [BatteryLegendItem] {
        [
            BatteryLegendItem(id: "start", name: "battery.chart.chargeStarted", color: TSChartPalette.color(at: 5)),
            BatteryLegendItem(id: "end", name: "battery.chart.chargeEnded", color: TSChartPalette.color(at: 2))
        ]
    }

    /// Web habit tiles: avg start / avg end / Supercharger sessions / home charges.
    private func habitTiles(_ habits: BatteryHealthHabits) -> some View {
        let columns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md)]
        return LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            BatteryHealthHabitTile(
                value: BatteryHealthFormat.percent(habits.avgStart, decimals: 0),
                label: "battery.habit.avgStart",
                colorIndex: nil
            )
            BatteryHealthHabitTile(
                value: BatteryHealthFormat.percent(habits.avgEnd, decimals: 0),
                label: "battery.habit.avgEnd",
                colorIndex: 2
            )
            BatteryHealthHabitTile(
                value: "\(habits.superchargerCount)",
                label: "battery.habit.supercharger",
                colorIndex: 1
            )
            BatteryHealthHabitTile(
                value: "\(habits.homeCharges)",
                label: "battery.habit.home",
                colorIndex: 4
            )
        }
    }
}

/// One charging-habit tile (web centred figure + caption).
struct BatteryHealthHabitTile: View {
    let value: String
    let label: LocalizedStringKey
    let colorIndex: Int?

    private var valueColor: Color {
        colorIndex.map { TSChartPalette.color(at: $0) } ?? Color.TS.textPrimary
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(valueColor)
            TSCaption(label)
        }
        .frame(maxWidth: .infinity)
        .multilineTextAlignment(.center)
        .accessibilityElement(children: .combine)
    }
}

/// A compact category axis surfacing the web bar-chart bucket labels (the wrapper uses a
/// numeric x-axis, so the band labels are rendered evenly beneath the bars).
struct BatteryHealthBucketAxis: View {
    let labels: [String]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(labels.enumerated()), id: \.offset) { _, label in
                Text(verbatim: label)
                    .font(.system(size: 9))
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - AC / DC energy breakdown (web AC-DC-Energy-Breakdown — PieChart + statistics)

/// The AC/DC energy breakdown row (web section 9): a donut of AC vs DC energy share beside
/// the charging-statistics list. Each renders its own empty state.
struct BatteryHealthAcdcSection: View {
    let breakdown: BatteryHealthEnergyBreakdown?
    let totalCycles: Int

    private let columns = [GridItem(.adaptive(minimum: 280), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            breakdownChart
            statisticsPanel
        }
    }

    private var breakdownChart: some View {
        TSChartContainer("battery.chart.acdc", summary: "battery.chart.acdc.aria") {
            if let breakdown {
                TSPieChart(slices: slices(breakdown))
                    .frame(height: 200)
                    .accessibilityLabel(Text("battery.chart.acdc.aria"))
            } else {
                TSEmptyState(title: "battery.chart.noBreakdown", systemImage: "bolt.fill")
                    .frame(maxWidth: .infinity, minHeight: 200)
            }
        }
    }

    private func slices(_ breakdown: BatteryHealthEnergyBreakdown) -> [TSChartSlice] {
        [
            TSChartSlice(id: "ac", name: "AC", nameText: "AC", value: breakdown.acEnergyKwh, colorIndex: 2),
            TSChartSlice(id: "dc", name: "DC", nameText: "DC", value: breakdown.dcEnergyKwh, colorIndex: 1)
        ]
    }

    private var statisticsPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "gauge.with.dots.needle.bottom.50percent")
                        .foregroundStyle(TSChartPalette.color(at: 6))
                        .accessibilityHidden(true)
                    TSSubhead("battery.stats.title")
                }
                if let breakdown {
                    TSKVList(rows: statRows(breakdown))
                } else {
                    TSEmptyState(title: "battery.stats.empty", systemImage: "waveform.path.ecg")
                        .frame(maxWidth: .infinity, minHeight: 160)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private func statRows(_ breakdown: BatteryHealthEnergyBreakdown) -> [TSKVRow] {
        [
            TSKVRow(id: "total", key: "battery.stats.totalSessions", value: "\(breakdown.totalSessions)"),
            TSKVRow(id: "ac", key: "battery.stats.acSessions", value: "\(breakdown.acCount)"),
            TSKVRow(id: "dc", key: "battery.stats.dcSessions", value: "\(breakdown.dcCount)"),
            TSKVRow(
                id: "energy",
                key: "battery.stats.totalEnergy",
                value: BatteryHealthFormat.kilowattHours(breakdown.totalEnergyKwh)
            ),
            TSKVRow(id: "cycles", key: "battery.stats.cycles", value: BatteryHealthFormat.integer(Double(totalCycles)))
        ]
    }
}
