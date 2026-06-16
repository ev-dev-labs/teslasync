import SwiftUI

// The charts on the Efficiency surface, built on the P3 native Swift Charts wrappers (never a
// WKWebView): the hero average-consumption gauge (web `RadialGauge`), the daily-efficiency area chart
// (web `ChartContainer` + `AreaChart`), the efficiency-by-speed-range bar chart (web `ChartContainer`
// + `BarChart`), and the speed-vs-efficiency / temperature-vs-efficiency scatter plots (web
// `ChartContainer` + `ScatterChart`). Each renders its own not-enough-data empty state (never a blank
// region) and an accessible summary. SI values convert to the user's unit at this render boundary via
// `EfficiencyPageFormat` / `Units`.

// MARK: - Average consumption gauge (web `RadialGauge`)

/// The hero average-consumption gauge (web `RadialGauge value max label color`). Wraps the P3
/// `TSRadialGauge`, trimming the ring to `displayValue / 300` (web `max={300}`) and tinting it from the
/// efficiency tier of the raw Wh/km. The numeric value + unit are surfaced beside it by the hero
/// section (web shows the value inside the gauge).
struct EfficiencyGauge: View {
    let whPerKm: Double
    let units: UnitPreferences

    private var displayValue: Double {
        EfficiencyPageFormat.efficiencyValue(whPerKm, units)
    }

    private var fraction: Double {
        min(max(displayValue / 300, 0), 1)
    }

    private var label: LocalizedStringKey {
        LocalizedStringKey("\(String(localized: "efficiency.avg")) \(EfficiencyPageFormat.efficiencyUnit(units))")
    }

    var body: some View {
        TSRadialGauge(
            value: fraction,
            label: label,
            colorIndex: EfficiencyTier.from(whPerKm: whPerKm).colorIndex
        )
        .accessibilityValue(Text(verbatim: EfficiencyPageFormat.efficiency(whPerKm, units)))
    }
}

// MARK: - First/last date caption (web AreaChart X-axis ticks)

/// A first/last date caption beneath the numeric-x area chart (the wrapper uses a numeric x-axis, so
/// the date span is surfaced here, mirroring the web X-axis ticks).
struct EfficiencyTrendAxis: View {
    let points: [EfficiencyTrendPoint]

    var body: some View {
        if let first = points.first, let last = points.last {
            HStack {
                Text(verbatim: EfficiencyPageFormat.dateShort(first.date))
                Spacer()
                Text(verbatim: EfficiencyPageFormat.dateShort(last.date))
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
        }
    }
}

// MARK: - Daily efficiency trend (web efficiency-dailyTrend — ChartContainer + AreaChart)

/// The daily-efficiency trend panel (web `efficiency-dailyTrend` `ChartContainer` + `AreaChart`): a
/// native area chart of the per-drive display efficiency over the period (first 30, oldest→newest),
/// the date axis, and the not-enough-data empty when there are ≤ 2 plottable drives (web
/// `dailyTrend.length > 2`).
struct EfficiencyDailyTrendSection: View {
    let points: [EfficiencyTrendPoint]
    let units: UnitPreferences

    private var hasData: Bool {
        points.count > 2
    }

    /// Web `t('efficiency.dailyTrend', { unit })` → "Daily Efficiency (Wh/km)".
    private var title: LocalizedStringKey {
        let template = String(localized: "efficiency.dailyTrend")
        return LocalizedStringKey(String(format: template, EfficiencyPageFormat.efficiencyUnit(units)))
    }

    var body: some View {
        TSChartContainer(
            title,
            summary: "efficiency.dailyTrend.aria",
            isEmpty: !hasData,
            csv: csv
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSAreaChart(series: series)
                    .frame(height: 240)
                    .accessibilityLabel(Text("efficiency.dailyTrend.aria"))
                EfficiencyTrendAxis(points: points)
            }
        }
    }

    private var series: [TSChartSeries] {
        [
            TSChartSeries(
                id: "efficiency",
                name: LocalizedStringKey(EfficiencyPageFormat.efficiencyUnit(units)),
                nameText: EfficiencyPageFormat.efficiencyUnit(units),
                points: points.map { point in
                    TSChartPoint(x: Double(point.index), y: point.efficiencyDisplay, id: "eff-\(point.index)")
                },
                colorIndex: 4
            )
        ]
    }

    /// Web `ChartContainer` `dataColumns` (Date / efficiencyUnit) surfaced as the exportable CSV.
    private var csv: String? {
        guard hasData else { return nil }
        let header = "\(String(localized: "efficiency.col.date")),\(EfficiencyPageFormat.efficiencyUnit(units))"
        let rows = points.map { "\(EfficiencyPageFormat.dateShort($0.date)),\(Int($0.efficiencyDisplay))" }
        return ([header] + rows).joined(separator: "\n")
    }
}

// MARK: - Efficiency by speed range (web Efficiency-by-Speed-Range — ChartContainer + BarChart)

/// The efficiency-by-speed-range panel (web `Efficiency-by-Speed-Range` `ChartContainer` + `BarChart`):
/// a native bar chart with one tier-colored bar per non-empty display-speed band, each labeled with
/// its band + unit beneath. Renders the empty state when there are no populated bands.
struct EfficiencySpeedRangeSection: View {
    let buckets: [EfficiencySpeedBucket]
    let units: UnitPreferences

    private var hasData: Bool {
        !buckets.isEmpty
    }

    var body: some View {
        TSChartContainer(
            "efficiency.speedDist",
            summary: "efficiency.speedDist.aria",
            isEmpty: !hasData,
            csv: csv
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSBarChart(series: series)
                    .frame(height: 240)
                    .accessibilityLabel(Text("efficiency.speedDist.aria"))
                bandAxis
            }
        }
    }

    /// One single-point series per band so each bar carries its own efficiency-tier color (web `Cell`
    /// fills) while sitting at its own x position. The bar height is the display efficiency.
    private var series: [TSChartSeries] {
        buckets.map { bucket in
            TSChartSeries(
                id: "band-\(bucket.id)",
                name: LocalizedStringKey(EfficiencyPageFormat.speedBucketLabel(bucket, units)),
                nameText: EfficiencyPageFormat.speedBucketLabel(bucket, units),
                points: [TSChartPoint(
                    x: Double(bucket.id),
                    y: EfficiencyPageFormat.efficiencyValue(bucket.avgWhPerKm, units),
                    id: "band-\(bucket.id)"
                )],
                colorIndex: EfficiencyTier.from(whPerKm: bucket.avgWhPerKm).colorIndex
            )
        }
    }

    private var bandAxis: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(buckets) { bucket in
                Text(verbatim: EfficiencyPageFormat.speedBucketLabel(bucket, units))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .accessibilityHidden(true)
    }

    /// Web `ChartContainer` `dataColumns` (Speed range / Avg efficiencyUnit) surfaced as the CSV.
    private var csv: String? {
        guard hasData else { return nil }
        let header = [
            String(localized: "efficiency.col.range"),
            "\(String(localized: "efficiency.avg")) \(EfficiencyPageFormat.efficiencyUnit(units))"
        ].joined(separator: ",")
        let rows = buckets.map { bucket -> String in
            let label = EfficiencyPageFormat.speedBucketLabel(bucket, units)
            return "\(label),\(EfficiencyPageFormat.efficiencyInt(bucket.avgWhPerKm, units))"
        }
        return ([header] + rows).joined(separator: "\n")
    }
}

// MARK: - Scatter axis legend

/// A compact "<x dimension> (unit) · <efficiencyUnit>" caption for the scatter plots (the wrapper uses
/// numeric axes, so the measured dimensions are surfaced for VoiceOver + sighted users).
private struct EfficiencyScatterAxisLegend: View {
    let xLabel: LocalizedStringKey
    let xUnit: String
    let yUnit: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(xLabel)
            Text(verbatim: "(\(xUnit))")
            Text(verbatim: "·")
            Text(verbatim: yUnit)
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityHidden(true)
    }
}

// MARK: - Speed vs efficiency (web Speed-vs-Efficiency — ChartContainer + ScatterChart)

/// The speed-vs-efficiency panel (web `Speed-vs-Efficiency` `ChartContainer` + `ScatterChart`): a
/// native per-drive scatter cloud of display speed (x) against display efficiency (y). Renders the
/// empty state when there are ≤ 3 points (web `speedVsEff.length > 3`). Per the web `chart-a11y:no-table`
/// note this per-drive cloud has no CSV; the aria summary covers it.
struct EfficiencySpeedScatterSection: View {
    let points: [EfficiencyScatterPoint]
    let units: UnitPreferences

    private var hasData: Bool {
        points.count > 3
    }

    var body: some View {
        TSChartContainer(
            "efficiency.speedVsEfficiency",
            summary: "efficiency.speedVsEfficiency.aria",
            isEmpty: !hasData
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSScatterChart(series: series)
                    .frame(height: 220)
                    .accessibilityLabel(Text("efficiency.speedVsEfficiency.aria"))
                EfficiencyScatterAxisLegend(
                    xLabel: "efficiency.speed",
                    xUnit: EfficiencyPageFormat.speedUnit(units),
                    yUnit: EfficiencyPageFormat.efficiencyUnit(units)
                )
            }
        }
    }

    private var series: [TSChartSeries] {
        [
            TSChartSeries(
                id: "speed-vs-eff",
                name: "efficiency.speedVsEfficiency",
                nameText: "speed-vs-efficiency",
                points: points.map { TSChartPoint(x: $0.xDisplay, y: $0.efficiencyDisplay, id: "sve-\($0.id)") },
                colorIndex: 1
            )
        ]
    }
}

// MARK: - Temperature vs efficiency (web Temperature-vs-Efficiency — ChartContainer + ScatterChart)

/// The temperature-vs-efficiency panel (web `Temperature-vs-Efficiency` `ChartContainer` +
/// `ScatterChart`): a native per-drive scatter cloud of display temperature (x) against display
/// efficiency (y). Renders the empty state when there are ≤ 3 points (web `tempVsEff.length > 3`).
struct EfficiencyTempScatterSection: View {
    let points: [EfficiencyScatterPoint]
    let units: UnitPreferences

    private var hasData: Bool {
        points.count > 3
    }

    var body: some View {
        TSChartContainer(
            "efficiency.tempVsEfficiency",
            summary: "efficiency.tempVsEfficiency.aria",
            isEmpty: !hasData
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSScatterChart(series: series)
                    .frame(height: 220)
                    .accessibilityLabel(Text("efficiency.tempVsEfficiency.aria"))
                EfficiencyScatterAxisLegend(
                    xLabel: "efficiency.temp",
                    xUnit: EfficiencyPageFormat.temperatureUnit(units),
                    yUnit: EfficiencyPageFormat.efficiencyUnit(units)
                )
            }
        }
    }

    private var series: [TSChartSeries] {
        [
            TSChartSeries(
                id: "temp-vs-eff",
                name: "efficiency.tempVsEfficiency",
                nameText: "temperature-vs-efficiency",
                points: points.map { TSChartPoint(x: $0.xDisplay, y: $0.efficiencyDisplay, id: "tve-\($0.id)") },
                colorIndex: 6
            )
        ]
    }
}
