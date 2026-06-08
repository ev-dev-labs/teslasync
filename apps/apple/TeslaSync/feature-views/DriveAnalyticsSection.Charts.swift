//
//  DriveAnalyticsSection.Charts.swift
//  TeslaSync — P4 feature view · 0166 · DriveAnalyticsSection (Apple)
//
//  The three Swift Charts panels that are the body of the "Drive Analytics" surface, the native parity
//  of the web Recharts charts (mapped through the P3 `@/components/charts` layer):
//
//    1. Speed Distribution   — bar histogram   (web `BarChart`)
//    2. Acceleration Patterns— scatter + avg    (web `ScatterChart` + `ReferenceLine`)
//    3. Power Profile        — dual area + zero  (web `AreaChart`, max + regen series)
//
//  Chrome is token-driven (P1/S9); copy resolves through the P1/S10 facade. Each panel renders its own
//  inner empty state (web `EmptyState`) and carries a VoiceOver summary. No networking lives here.
//

import Charts
import SwiftUI

// MARK: - Shared chart chrome

private let driveAnalyticsChartHeight: CGFloat = 280

/// Token-styled Y axis (grid + abbreviated muted labels).
private func driveAnalyticsYAxis() -> some AxisContent {
    AxisMarks(position: .leading) { value in
        AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
        AxisValueLabel {
            if let number = value.as(Double.self) {
                Text(verbatim: DriveAnalyticsSectionFormat.integer(number)).foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}

/// Builds a "{word} ({unit})" axis title (web `name` + `unit`).
private func driveAnalyticsAxisTitle(_ word: String, unit: String) -> String {
    "\(word) (\(unit))"
}

/// The compact inner empty row (web `EmptyState`): never a blank box, sized to the chart envelope.
struct DriveAnalyticsSectionEmptyRow: View {
    let key: String
    let fallback: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.dots.scatter")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            DriveAnalyticsSectionStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: driveAnalyticsChartHeight)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - 1. Speed Distribution (web `BarChart`)

/// The speed-distribution histogram: one bar per speed bucket, with a tap-to-reveal value tooltip (web
/// `ChartTooltip`) and its own inner empty state when no drive has a recorded speed.
struct DriveAnalyticsSectionSpeedChart: View {
    let buckets: [DriveAnalyticsSectionSpeedBucket]
    let accessibilitySummary: String

    @State private var selectedRange: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var hasData: Bool {
        buckets.reduce(0) { $0 + $1.count } > 0
    }

    private var selectedBucket: DriveAnalyticsSectionSpeedBucket? {
        guard let selectedRange else { return nil }
        return buckets.first { $0.range == selectedRange }
    }

    var body: some View {
        DriveAnalyticsSectionPanel(
            titleKey: "dynamics.speedDistribution",
            titleFallback: "Speed Distribution",
            subtitleKey: "dynamics.speedDistDesc",
            subtitleFallback: "Drives grouped by average speed"
        ) {
            if hasData {
                chart
                    .frame(height: driveAnalyticsChartHeight)
                    .accessibilityLabel(DriveAnalyticsSectionStrings.text(
                        "dynamics.speedDistribution.aria",
                        "Speed-bucket drive count distribution bar chart"
                    ))
                    .accessibilityValue(Text(verbatim: accessibilitySummary))
            } else {
                DriveAnalyticsSectionEmptyRow(key: "dynamics.noSpeed", fallback: "No speed data")
            }
        }
    }

    private var chart: some View {
        Chart {
            ForEach(buckets) { bucket in
                BarMark(
                    x: .value("range", bucket.range),
                    y: .value("count", bucket.count)
                )
                .foregroundStyle(TSChartPalette.color(at: 0))
                .cornerRadius(4)
                .accessibilityLabel(Text(verbatim: bucket.range))
                .accessibilityValue(Text(verbatim: "\(bucket.count)"))
            }
            if let selectedBucket {
                RuleMark(x: .value("range", selectedBucket.range))
                    .foregroundStyle(Color.TS.border)
                    .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        DriveAnalyticsSectionSpeedTooltip(bucket: selectedBucket)
                    }
            }
        }
        .chartXScale(domain: buckets.map(\.range))
        .chartXSelection(value: $selectedRange)
        .chartXAxis { speedXAxis }
        .chartYAxis { driveAnalyticsYAxis() }
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: buckets)
    }

    private var speedXAxis: some AxisContent {
        AxisMarks { value in
            AxisValueLabel {
                if let range = value.as(String.self) {
                    Text(verbatim: range).font(Font.TS.label).foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }
}

/// The speed-bucket selection tooltip: the bucket range over its drive count.
struct DriveAnalyticsSectionSpeedTooltip: View {
    let bucket: DriveAnalyticsSectionSpeedBucket

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: bucket.range)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle().fill(TSChartPalette.color(at: 0)).frame(width: 7, height: 7)
                DriveAnalyticsSectionStrings.text("dynamics.drives", "Drives")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: "\(bucket.count)")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(minWidth: 140, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - 2. Acceleration Patterns (web `ScatterChart` + `ReferenceLine`)

/// The acceleration scatter: one point per drive (display distance × peak power) with a dashed average
/// reference line (web `ReferenceLine` labelled "Avg") and its own inner empty state.
struct DriveAnalyticsSectionAccelChart: View {
    let points: [DriveAnalyticsSectionAccelPoint]
    let average: Double?
    let distanceUnit: String
    let accessibilitySummary: String

    var body: some View {
        DriveAnalyticsSectionPanel(
            titleKey: "dynamics.accelPatterns",
            titleFallback: "Acceleration Patterns",
            subtitleKey: "dynamics.accelPatternsDesc",
            subtitleFallback: "Peak power vs trip distance"
        ) {
            if points.isEmpty {
                DriveAnalyticsSectionEmptyRow(key: "dynamics.noAccel", fallback: "No power data")
            } else {
                chart
                    .frame(height: driveAnalyticsChartHeight)
                    .accessibilityLabel(DriveAnalyticsSectionStrings.text(
                        "dynamics.accelPatterns.aria",
                        "Per-drive scatter chart of peak power versus trip distance"
                    ))
                    .accessibilityValue(Text(verbatim: accessibilitySummary))
            }
        }
    }

    private var chart: some View {
        let distanceWord = DriveAnalyticsSectionStrings.string("dynamics.distance", "Distance")
        let peakWord = DriveAnalyticsSectionStrings.string("dynamics.peakPower", "Peak Power")
        let kilowatt = DriveAnalyticsSectionStrings.string("dynamics.kwUnit", "kW")
        return Chart {
            ForEach(points) { point in
                PointMark(
                    x: .value("distance", point.distance),
                    y: .value("powerMax", point.powerMax)
                )
                .symbolSize(80)
                .foregroundStyle(Color.TS.chartSeriesPower.opacity(0.7))
            }
            if let average {
                RuleMark(y: .value("avg", average))
                    .foregroundStyle(Color.TS.statusWarning)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    .annotation(position: .top, alignment: .leading) {
                        DriveAnalyticsSectionStrings.text("dynamics.avg", "Avg")
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.statusWarning)
                    }
            }
        }
        .chartXAxis {
            AxisMarks { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: DriveAnalyticsSectionFormat.integer(number))
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis { driveAnalyticsYAxis() }
        .chartXAxisLabel(driveAnalyticsAxisTitle(distanceWord, unit: distanceUnit), alignment: .center)
        .chartYAxisLabel(driveAnalyticsAxisTitle(peakWord, unit: kilowatt), alignment: .center)
    }
}

// MARK: - 3. Power Profile (web `AreaChart`, max + regen series)

/// The power-profile dual-area chart: the recent drives' peak power and regen power, a named legend (web
/// `Legend`), a zero baseline (web `ReferenceLine y={0}`), a tap-to-reveal tooltip, and its own inner
/// empty state.
struct DriveAnalyticsSectionPowerChart: View {
    let points: [DriveAnalyticsSectionPowerPoint]
    let accessibilitySummary: String

    @State private var selectedIndex: Int?

    private var maxSeries: String {
        DriveAnalyticsSectionStrings.string("dynamics.maxPower", "Max Power (kW)")
    }

    private var regenSeries: String {
        DriveAnalyticsSectionStrings.string("dynamics.regenPower", "Regen Power (kW)")
    }

    private var selectedPoint: DriveAnalyticsSectionPowerPoint? {
        guard let selectedIndex else { return nil }
        return points.first { $0.index == selectedIndex }
    }

    var body: some View {
        DriveAnalyticsSectionPanel(
            titleKey: "dynamics.powerProfile",
            titleFallback: "Power Profile",
            subtitleKey: "dynamics.powerProfileDesc",
            subtitleFallback: "Peak & regen power for recent drives"
        ) {
            if points.isEmpty {
                DriveAnalyticsSectionEmptyRow(key: "dynamics.noPower", fallback: "No power profile data")
            } else {
                chart
                    .frame(height: driveAnalyticsChartHeight)
                    .accessibilityLabel(DriveAnalyticsSectionStrings.text(
                        "dynamics.powerProfile.aria",
                        "Recent-drives peak and regen power dual-area chart"
                    ))
                    .accessibilityValue(Text(verbatim: accessibilitySummary))
            }
        }
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                AreaMark(x: .value("drive", point.index), y: .value("kw", point.powerMax))
                    .foregroundStyle(by: .value("series", maxSeries))
                    .interpolationMethod(.monotone)
                    .opacity(0.5)
            }
            ForEach(points) { point in
                AreaMark(x: .value("drive", point.index), y: .value("kw", point.powerMin))
                    .foregroundStyle(by: .value("series", regenSeries))
                    .interpolationMethod(.monotone)
                    .opacity(0.5)
            }
            RuleMark(y: .value("zero", 0))
                .foregroundStyle(Color.TS.border.opacity(0.4))
            powerSelection
        }
        .chartForegroundStyleScale([
            maxSeries: Color.TS.chartSeriesSpeed,
            regenSeries: Color.TS.chartSeriesTemperature
        ])
        .chartXSelection(value: $selectedIndex)
        .chartXAxis { powerXAxis }
        .chartYAxis { driveAnalyticsYAxis() }
        .chartYAxisLabel(DriveAnalyticsSectionStrings.string("dynamics.kwUnit", "kW"), alignment: .center)
        .chartLegend(position: .bottom, spacing: TSSpacing.sm)
    }

    @ChartContentBuilder
    private var powerSelection: some ChartContent {
        if let selectedPoint {
            RuleMark(x: .value("drive", selectedPoint.index))
                .foregroundStyle(Color.TS.border)
                .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                    DriveAnalyticsSectionPowerTooltip(
                        point: selectedPoint,
                        maxLabel: maxSeries,
                        regenLabel: regenSeries
                    )
                }
        }
    }

    private var powerXAxis: some AxisContent {
        AxisMarks(values: .automatic(desiredCount: 6)) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let index = value.as(Int.self), let match = points.first(where: { $0.index == index }) {
                    Text(verbatim: match.label).font(Font.TS.label).foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }
}

/// The power-profile selection tooltip: the drive's short date over its peak + regen power.
struct DriveAnalyticsSectionPowerTooltip: View {
    let point: DriveAnalyticsSectionPowerPoint
    let maxLabel: String
    let regenLabel: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: point.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            row(color: Color.TS.chartSeriesSpeed, label: maxLabel, value: point.powerMax)
            row(color: Color.TS.chartSeriesTemperature, label: regenLabel, value: point.powerMin)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(minWidth: 168, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func row(color: Color, label: String, value: Double) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: DriveAnalyticsSectionFormat.number(value, decimals: 1))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
    }
}
