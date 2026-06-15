import SwiftUI

// The two charts on the Mileage surface, built on the P3 native Swift Charts wrappers (never a
// WKWebView): the odometer-over-time `AreaChart` and the daily-distance `BarChart`. Each is framed
// by a `GlassPanel` with its web title, renders its own empty state (never a blank region) and an
// accessible summary, and converts SI meters to the user's distance unit at the boundary (ADR-005).
// Both wrappers plot a numeric (index) x-axis, so the date span is surfaced beneath via
// `MileageTimeAxis`, mirroring the web X-axis ticks (the sibling Battery charts' convention).

// MARK: - Odometer over time (web GlassPanel5 — Odometer-Over-Time AreaChart)

/// The odometer-over-time panel (web GlassPanel5): a `TSAreaChart` of the end-of-day odometer
/// reading across the daily window, or the no-entries empty state. The series is the days that carry
/// a non-null odometer (web `odometerData`); the reading converts from SI meters to the user's unit.
struct MileageOdometerSection: View {
    let points: [MileageDailyPoint]
    let units: UnitPreferences

    private var seriesName: String {
        "\(String(localized: "Odometer")) (\(units.distance))"
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSubhead("Odometer Over Time")
                if points.isEmpty {
                    TSEmptyState(title: "No Entries", systemImage: "gauge.with.dots.needle.bottom.50percent")
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else {
                    TSAreaChart(series: [series])
                        .frame(height: 240)
                        .accessibilityLabel(Text("Odometer Over Time"))
                    MileageChartLegend(name: seriesName, colorIndex: 2)
                    MileageTimeAxis(labels: points.map { MileageFormat.dayLabel($0.date) })
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    /// Web `<Area dataKey="odometer" name={`${t('Odometer')} (${distanceUnit})`} />` — odometer
    /// (SI meters → user unit) keyed by day index, colored from the web `palette[2]` slot.
    private var series: TSChartSeries {
        let chartPoints = points.enumerated().map { index, point in
            TSChartPoint(
                x: Double(index),
                y: Units.convertDistance(point.endOdometerM ?? 0, units),
                id: "odo-\(index)"
            )
        }
        return TSChartSeries(
            id: "odometer",
            name: LocalizedStringKey(seriesName),
            nameText: seriesName,
            points: chartPoints,
            colorIndex: 2
        )
    }
}

// MARK: - Daily distance (web GlassPanel6 — Daily-Distance BarChart)

/// The daily-distance panel (web GlassPanel6): a `TSBarChart` of each day's driven distance across
/// the daily window, or the no-entries empty state. Distance converts from SI meters to the user's
/// unit at this boundary.
struct MileageDailyDistanceSection: View {
    let points: [MileageDailyPoint]
    let units: UnitPreferences

    private var seriesName: String {
        "\(String(localized: "Distance")) (\(units.distance))"
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSubhead("Daily Distance")
                if points.isEmpty {
                    TSEmptyState(title: "No Entries", systemImage: "chart.bar.fill")
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else {
                    TSBarChart(series: [series])
                        .frame(height: 240)
                        .accessibilityLabel(Text("Daily Distance"))
                    MileageChartLegend(name: seriesName, colorIndex: 0)
                    MileageTimeAxis(labels: points.map { MileageFormat.dayLabel($0.date) })
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    /// Web `<Bar dataKey="distance" name={`${t('Distance')} (${distanceUnit})`} />` — daily distance
    /// (SI meters → user unit) keyed by day index, colored from the web `palette[0]` slot.
    private var series: TSChartSeries {
        let chartPoints = points.enumerated().map { index, point in
            TSChartPoint(
                x: Double(index),
                y: Units.convertDistance(point.totalDistanceM, units),
                id: "day-\(index)"
            )
        }
        return TSChartSeries(
            id: "distance",
            name: LocalizedStringKey(seriesName),
            nameText: seriesName,
            points: chartPoints,
            colorIndex: 0
        )
    }
}

// MARK: - Chart chrome

/// A single-series legend chip (web recharts series `name` shown in the tooltip/legend): a palette
/// dot plus the series name + unit.
struct MileageChartLegend: View {
    let name: String
    let colorIndex: Int

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(TSChartPalette.color(at: colorIndex))
                .frame(width: 8, height: 8)
            Text(verbatim: name)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .accessibilityHidden(true)
    }
}

/// A compact first/last date caption beneath a chart (the area/bar wrappers use a numeric x-axis, so
/// the date span is surfaced here, mirroring the web X-axis ticks).
struct MileageTimeAxis: View {
    let labels: [String]

    var body: some View {
        if let first = labels.first, let last = labels.last {
            HStack {
                Text(verbatim: first)
                Spacer()
                Text(verbatim: last)
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
        }
    }
}
