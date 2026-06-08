//
//  DrivingTab.Charts.swift
//  TeslaSync — P4 feature view · 0056 · DrivingTab (Apple)
//
//  The seven Swift Charts panels that are the body of the surface, the native parity of
//  the web source's Recharts charts (mapped through the P3 `@/components/charts` layer):
//
//    1. Speed Distribution         — bar histogram (web `BarChart`, CHART_COLORS[0])
//    2. Trip Distance Distribution — bar histogram (web `BarChart`, CHART_COLORS[2])
//    3. Hourly Driving Pattern     — bars + line  (web `ComposedChart`, [0] + [3])
//    4. Temperature vs Efficiency  — bubble scatter (web `ScatterChart` + ZAxis, [1])
//    5. Daily Driving Trend        — area + line  (web `ComposedChart`, [0] + [3])
//    6. Drive Duration Distribution— bar histogram (web `BarChart`, CHART_COLORS[4])
//    7. Efficiency Trend           — area          (web `AreaChart`, CHART_COLORS[1])
//
//  Palette indices match the web `CHART_COLORS` (Okabe-Ito) through `TSChartPalette`. Per
//  Apple HIG (and the repo's `TSComposedChart`), the composed charts share a single value
//  scale rather than cloning Recharts' twin axes; a legend names both series. Every panel
//  renders its own per-series empty row (web `EmptyState`) and carries a VoiceOver value.
//

import Charts
import SwiftUI

// MARK: - Shared chart chrome

/// Token-styled Y axis (grid + abbreviated muted labels) for the non-categorical charts,
/// the inline equivalent of `tsChartAxes()`'s Y axis when a custom X axis is also needed.
private func driveTokenYAxis() -> some AxisContent {
    AxisMarks { value in
        AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
        AxisValueLabel {
            if let number = value.as(Double.self) {
                Text(TSChartFormat.axisLabel(number)).foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}

/// VoiceOver value for a histogram panel ("{n} ranges, {total} {noun}").
private func distributionA11yValue(_ bars: [DriveBar], totalKey: String, totalFallback: String) -> String {
    DriveAnalyticsAccessibility.distributionSummary(
        bars: bars,
        rangesNoun: DrivingTabStrings.string("analytics.driving.a11yRanges", "ranges"),
        totalNoun: DrivingTabStrings.string(totalKey, totalFallback),
        emptyFallback: DrivingTabStrings.string("analytics.driving.a11yNoData", "No data")
    )
}

/// VoiceOver value for a non-histogram series ("{n} {noun}").
private func countA11yValue(_ count: Int, nounKey: String, nounFallback: String) -> String {
    DriveAnalyticsAccessibility.countSummary(
        count,
        noun: DrivingTabStrings.string(nounKey, nounFallback),
        emptyFallback: DrivingTabStrings.string("analytics.driving.a11yNoData", "No data")
    )
}

/// Builds a "{word} ({unit})" scatter axis title (web `name` + `unit`); the explicit
/// `String` return keeps the call sites free of a `LocalizedStringKey` literal ambiguity.
private func axisTitle(_ word: String, unit: String) -> String {
    "\(word) (\(unit))"
}

private let driveChartHeight: CGFloat = 260
private let driveComposedHeight: CGFloat = 280

// MARK: - Reusable single-series histogram (web `BarChart`)

/// A single-series categorical bar histogram (web `BarChart` with a `range` x-axis).
private struct DistributionBarChart: View {
    let bars: [DriveBar]
    let colorIndex: Int

    var body: some View {
        Chart(bars) { bar in
            BarMark(
                x: .value("range", bar.range),
                y: .value("count", bar.count)
            )
            .foregroundStyle(TSChartPalette.color(at: colorIndex))
        }
        .chartLegend(.hidden)
        .tsChartAxes()
        .frame(height: driveChartHeight)
    }
}

// MARK: - 1. Speed Distribution

struct SpeedDistributionChart: View {
    let bars: [DriveBar]

    var body: some View {
        DriveAnalyticsPanel(titleKey: "analytics.driving.speedDist", titleFallback: "Speed Distribution") {
            if bars.isEmpty {
                DriveAnalyticsEmptyRow(key: "analytics.driving.noSpeed", fallback: "No speed data")
            } else {
                DistributionBarChart(bars: bars, colorIndex: 0)
                    .accessibilityLabel(DrivingTabStrings.text("analytics.driving.speedDist", "Speed Distribution"))
                    .accessibilityValue(Text(verbatim: distributionA11yValue(
                        bars,
                        totalKey: "analytics.driving.trips",
                        totalFallback: "Trips"
                    )))
            }
        }
    }
}

// MARK: - 2. Trip Distance Distribution

struct TripDistanceDistributionChart: View {
    let bars: [DriveBar]

    var body: some View {
        DriveAnalyticsPanel(titleKey: "analytics.driving.distDist", titleFallback: "Trip Distance Distribution") {
            if bars.isEmpty {
                DriveAnalyticsEmptyRow(key: "analytics.driving.noDistDist", fallback: "No distance distribution data")
            } else {
                DistributionBarChart(bars: bars, colorIndex: 2)
                    .accessibilityLabel(DrivingTabStrings.text(
                        "analytics.driving.distDist",
                        "Trip Distance Distribution"
                    ))
                    .accessibilityValue(Text(verbatim: distributionA11yValue(
                        bars,
                        totalKey: "analytics.driving.trips",
                        totalFallback: "Trips"
                    )))
            }
        }
    }
}

// MARK: - 3. Hourly Driving Pattern (web `ComposedChart`)

struct HourlyPatternChart: View {
    let points: [DriveHourlyPoint]

    var body: some View {
        DriveAnalyticsPanel(titleKey: "analytics.driving.hourlyPattern", titleFallback: "Hourly Driving Pattern") {
            if points.isEmpty {
                DriveAnalyticsEmptyRow(key: "analytics.driving.noHourly", fallback: "No hourly data")
            } else {
                chart
                    .frame(height: driveComposedHeight)
                    .accessibilityLabel(DrivingTabStrings.text(
                        "analytics.driving.hourlyPattern",
                        "Hourly Driving Pattern"
                    ))
                    .accessibilityValue(Text(verbatim: countA11yValue(
                        points.count,
                        nounKey: "analytics.driving.a11yHours",
                        nounFallback: "hours"
                    )))
            }
        }
    }

    private var chart: some View {
        let drivesName = DrivingTabStrings.string("analytics.driving.drives", "Drives")
        let distanceName = DrivingTabStrings.string("analytics.driving.distance", "Distance")
        return Chart {
            ForEach(points) { point in
                BarMark(x: .value("hour", point.hour), y: .value("drives", point.drives))
                    .foregroundStyle(by: .value("series", drivesName))
            }
            ForEach(points) { point in
                LineMark(x: .value("hour", point.hour), y: .value("distance", point.distance))
                    .foregroundStyle(by: .value("series", distanceName))
                    .interpolationMethod(.catmullRom)
            }
        }
        .chartForegroundStyleScale([
            drivesName: TSChartPalette.color(at: 0),
            distanceName: TSChartPalette.color(at: 3)
        ])
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 6)) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let hour = value.as(Int.self) {
                        Text(verbatim: DriveAnalyticsUnits.hourLabel(hour)).foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis { driveTokenYAxis() }
        .chartLegend(position: .bottom, spacing: TSSpacing.sm)
    }
}

// MARK: - 4. Temperature vs Efficiency (web `ScatterChart` + ZAxis bubbles)

struct TemperatureEfficiencyChart: View {
    let points: [DriveTempEffPoint]
    let labels: DriveUnitLabels

    var body: some View {
        DriveAnalyticsPanel(titleKey: "analytics.driving.tempVsEff", titleFallback: "Temperature vs Efficiency") {
            if points.isEmpty {
                DriveAnalyticsEmptyRow(key: "analytics.driving.noTempEff", fallback: "No temperature data")
            } else {
                chart
                    .frame(height: driveComposedHeight)
                    .accessibilityLabel(DrivingTabStrings.text(
                        "analytics.driving.tempVsEff",
                        "Temperature vs Efficiency"
                    ))
                    .accessibilityValue(Text(verbatim: countA11yValue(
                        points.count,
                        nounKey: "analytics.driving.a11ySamples",
                        nounFallback: "samples"
                    )))
            }
        }
    }

    private var chart: some View {
        // Web ScatterChart `name={t('…temp')} unit={tempUnit}` → "{word} ({unit})" axis title.
        let tempWord = DrivingTabStrings.string("analytics.driving.temp", "Temp")
        let effWord = DrivingTabStrings.string("analytics.driving.efficiency", "Efficiency")
        let xTitle = axisTitle(tempWord, unit: labels.temperature)
        let yTitle = axisTitle(effWord, unit: labels.efficiency)
        return Chart(points) { point in
            PointMark(
                x: .value("temp", point.temp),
                y: .value("efficiency", point.efficiency)
            )
            .symbolSize(CGFloat(point.bubbleSize))
            .foregroundStyle(TSChartPalette.color(at: 1).opacity(0.7))
        }
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(TSChartFormat.axisLabel(number)).foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis { driveTokenYAxis() }
        .chartXAxisLabel(xTitle, alignment: .center)
        .chartYAxisLabel(yTitle, alignment: .center)
    }
}

// MARK: - 5. Daily Driving Trend (web `ComposedChart`)

struct DailyTrendChart: View {
    let points: [DriveDailyPoint]
    let labels: DriveUnitLabels

    var body: some View {
        DriveAnalyticsPanel(titleKey: "analytics.driving.dailyTrend", titleFallback: "Daily Driving Trend") {
            if points.isEmpty {
                DriveAnalyticsEmptyRow(key: "analytics.driving.noDailyTrend", fallback: "No daily trend data")
            } else {
                chart
                    .frame(height: driveComposedHeight)
                    .accessibilityLabel(DrivingTabStrings.text("analytics.driving.dailyTrend", "Daily Driving Trend"))
                    .accessibilityValue(Text(verbatim: countA11yValue(
                        points.count,
                        nounKey: "analytics.driving.a11yDays",
                        nounFallback: "days"
                    )))
            }
        }
    }

    private var chart: some View {
        let distanceName = labels.distance
        let drivesName = DrivingTabStrings.string("analytics.driving.drives", "Drives")
        let shortDates = points.map(\.shortDate)
        return Chart {
            ForEach(points.indices, id: \.self) { index in
                let point = points[index]
                AreaMark(x: .value("day", index), y: .value("distance", point.distance))
                    .foregroundStyle(by: .value("series", distanceName))
                    .interpolationMethod(.catmullRom)
                    .opacity(0.45)
            }
            ForEach(points.indices, id: \.self) { index in
                let point = points[index]
                LineMark(x: .value("day", index), y: .value("drives", point.drives))
                    .foregroundStyle(by: .value("series", drivesName))
                    .interpolationMethod(.catmullRom)
            }
        }
        .chartForegroundStyleScale([
            distanceName: TSChartPalette.color(at: 0),
            drivesName: TSChartPalette.color(at: 3)
        ])
        .chartXAxis { trendDateAxis(shortDates) }
        .chartYAxis { driveTokenYAxis() }
        .chartLegend(position: .bottom, spacing: TSSpacing.sm)
    }
}

// MARK: - 6. Drive Duration Distribution

struct DurationDistributionChart: View {
    let bars: [DriveBar]

    var body: some View {
        DriveAnalyticsPanel(titleKey: "analytics.driving.durationDist", titleFallback: "Drive Duration Distribution") {
            if bars.isEmpty {
                DriveAnalyticsEmptyRow(
                    key: "analytics.driving.noDurationData",
                    fallback: "Not enough drive data for distribution chart"
                )
            } else {
                DistributionBarChart(bars: bars, colorIndex: 4)
                    .accessibilityLabel(DrivingTabStrings.text(
                        "analytics.driving.durationDist",
                        "Drive Duration Distribution"
                    ))
                    .accessibilityValue(Text(verbatim: distributionA11yValue(
                        bars,
                        totalKey: "analytics.driving.drives",
                        totalFallback: "Drives"
                    )))
            }
        }
    }
}

// MARK: - 7. Efficiency Trend (web `AreaChart`)

struct EfficiencyTrendChart: View {
    let points: [DriveEffPoint]
    let labels: DriveUnitLabels

    var body: some View {
        DriveAnalyticsPanel(titleKey: "analytics.driving.effTrend", titleFallback: "Efficiency Trend") {
            if points.isEmpty {
                DriveAnalyticsEmptyRow(key: "analytics.driving.noEffTrend", fallback: "No efficiency trend data")
            } else {
                chart
                    .frame(height: driveChartHeight)
                    .accessibilityLabel(DrivingTabStrings.text("analytics.driving.effTrend", "Efficiency Trend"))
                    .accessibilityValue(Text(verbatim: countA11yValue(
                        points.count,
                        nounKey: "analytics.driving.a11yDays",
                        nounFallback: "days"
                    )))
            }
        }
    }

    private var chart: some View {
        let shortDates = points.map(\.shortDate)
        return Chart {
            ForEach(points.indices, id: \.self) { index in
                let point = points[index]
                AreaMark(x: .value("day", index), y: .value("efficiency", point.efficiency))
                    .foregroundStyle(TSChartGradient.fill(colorIndex: 1))
                    .interpolationMethod(.catmullRom)
            }
            ForEach(points.indices, id: \.self) { index in
                let point = points[index]
                LineMark(x: .value("day", index), y: .value("efficiency", point.efficiency))
                    .foregroundStyle(TSChartPalette.color(at: 1))
                    .interpolationMethod(.catmullRom)
            }
        }
        .chartLegend(.hidden)
        .chartXAxis { trendDateAxis(shortDates) }
        .chartYAxis { driveTokenYAxis() }
        .chartYAxisLabel(labels.efficiency, alignment: .center)
    }
}

// MARK: - Shared trend date axis

/// A token-styled, index-keyed date axis: maps the numeric sample index back to its
/// `shortDate` label (web `tickFormatter={(v) => v.slice(5)}`) while letting Swift Charts
/// thin the tick count so dense windows stay legible.
private func trendDateAxis(_ labels: [String]) -> some AxisContent {
    AxisMarks(values: .automatic(desiredCount: 6)) { value in
        AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
        AxisValueLabel {
            if let index = value.as(Int.self), index >= 0, index < labels.count {
                Text(verbatim: labels[index]).foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}
