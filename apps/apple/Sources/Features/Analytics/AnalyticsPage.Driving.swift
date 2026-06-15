import SwiftUI

// MARK: - Driving tab (web `DrivingTab` + `DrivingPerformanceCards` + `DrivingTemperatureStats`)

/// The Driving tab (web `DrivingTab`): the six performance cards, the speed / trip-distance / duration
/// distributions, the hourly pattern, the temperature-vs-efficiency scatter, the daily and efficiency
/// trends, and the inside/outside temperature stats. SI values (m/s, W, m, °C, Wh/km) convert to the
/// user's units at this boundary; every section renders its own empty state.
struct AnalyticsDrivingTab: View {
    let data: FleetAnalyticsData
    let units: UnitPreferences

    private var drive: AnalyticsDriveSection {
        data.driveAnalytics
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            performanceCards
            speedDistribution
            distanceDistribution
            hourlyPattern
            tempVsEfficiency
            dailyTrend
            durationDistribution
            efficiencyTrend
            temperatureStats
        }
    }

    // MARK: Performance cards (web `DrivingPerformanceCards`)

    private var performanceCards: some View {
        AnalyticsMetricGrid(minimum: 150) {
            AnalyticsMetricCard(
                title: "analytics.driving.topSpeed",
                value: AnalyticsFormat.speed(drive.speedStats.max, units),
                systemImage: "gauge.with.dots.needle.bottom.50percent",
                tone: .accent
            )
            AnalyticsMetricCard(
                title: "analytics.driving.avgSpeed",
                value: AnalyticsFormat.speed(drive.speedStats.avg, units),
                systemImage: "chart.line.uptrend.xyaxis",
                tone: .info
            )
            AnalyticsMetricCard(
                title: "analytics.driving.peakPower",
                value: "\(AnalyticsFormat.powerKW(drive.powerStats.max)) kW",
                systemImage: "bolt.fill",
                tone: .warning
            )
            AnalyticsMetricCard(
                title: "analytics.driving.peakRegen",
                value: "\(AnalyticsFormat.powerKW(drive.regenStats.max)) kW",
                systemImage: "minus.plus.batteryblock",
                tone: .success
            )
            AnalyticsMetricCard(
                title: "analytics.driving.avgDriveDist",
                value: AnalyticsFormat.distance(drive.distanceStats.avg, units, decimals: 1),
                systemImage: "mappin.and.ellipse",
                tone: .accent
            )
            AnalyticsMetricCard(
                title: "analytics.driving.longestDrive",
                value: AnalyticsFormat.distance(drive.distanceStats.max, units, decimals: 1),
                systemImage: "car.fill",
                tone: .info
            )
        }
    }

    // MARK: Distributions (web single-series BarCharts)

    private var speedDistribution: some View {
        AnalyticsChartPanel(
            title: "analytics.driving.speedDist",
            summary: "analytics.driving.speedDist.aria",
            isEmpty: drive.speedDistribution.isEmpty,
            emptyTitle: "analytics.driving.noSpeed"
        ) {
            AnalyticsSingleBars(
                series: AnalyticsSeries.counts(
                    drive.speedDistribution,
                    id: "speed",
                    name: String(localized: "analytics.driving.trips", defaultValue: "Trips"),
                    colorIndex: 0
                ),
                labels: drive.speedDistribution.map(\.label),
                height: 220
            )
        }
    }

    private var distanceDistribution: some View {
        AnalyticsChartPanel(
            title: "analytics.driving.distDist",
            summary: "analytics.driving.distDist.aria",
            isEmpty: drive.distanceDistribution.isEmpty,
            emptyTitle: "analytics.driving.noDistDist"
        ) {
            AnalyticsSingleBars(
                series: AnalyticsSeries.counts(
                    drive.distanceDistribution,
                    id: "tripDist",
                    name: String(localized: "analytics.driving.trips", defaultValue: "Trips"),
                    colorIndex: 2
                ),
                labels: drive.distanceDistribution.map(\.label),
                height: 220
            )
        }
    }

    // MARK: Hourly pattern (web dual-axis ComposedChart: drives + distance)

    private var hourlyPattern: some View {
        AnalyticsChartPanel(
            title: "analytics.driving.hourlyPattern",
            summary: "analytics.driving.hourlyPattern.aria",
            isEmpty: drive.hourlyPattern.isEmpty,
            emptyTitle: "analytics.driving.noHourly"
        ) {
            AnalyticsTrendPair(
                barSeries: AnalyticsSeries.values(
                    drive.hourlyPattern.map { Double($0.drives) },
                    id: "drives",
                    name: String(localized: "analytics.driving.drives", defaultValue: "Drives"),
                    colorIndex: 0
                ),
                lineSeries: AnalyticsSeries.values(
                    drive.hourlyPattern.map { AnalyticsFormat.distanceValue($0.distanceM, units) },
                    id: "distance",
                    name: String(localized: "analytics.driving.distance", defaultValue: "Distance"),
                    colorIndex: 3
                ),
                labels: drive.hourlyPattern.map { "\($0.hour):00" }
            )
        }
    }

    // MARK: Temp vs Efficiency (web ScatterChart)

    private var tempVsEfficiency: some View {
        AnalyticsChartPanel(
            title: "analytics.driving.tempVsEff",
            summary: "analytics.driving.tempVsEff.aria",
            isEmpty: drive.tempVsEfficiency.isEmpty,
            emptyTitle: "analytics.driving.noTempEff",
            emptyIcon: "thermometer.medium"
        ) {
            TSScatterChart(series: [
                TSChartSeries(
                    id: "tempEff",
                    name: "analytics.driving.tempVsEff",
                    nameText: String(
                        localized: "analytics.driving.tempVsEff",
                        defaultValue: "Temperature vs Efficiency"
                    ),
                    points: drive.tempVsEfficiency.map { point in
                        TSChartPoint(
                            x: AnalyticsFormat.temperatureValue(point.tempC, units),
                            y: AnalyticsFormat.efficiencyValue(point.efficiencyWhKm, units),
                            id: "tempEff-\(point.id)"
                        )
                    },
                    colorIndex: 1
                )
            ])
            .frame(height: 260)
        }
    }

    // MARK: Daily trend (web dual-axis ComposedChart: distance area + drives line)

    private var dailyTrend: some View {
        AnalyticsChartPanel(
            title: "analytics.driving.dailyTrend",
            summary: "analytics.driving.dailyTrend.aria",
            isEmpty: drive.dailyTrend.isEmpty,
            emptyTitle: "analytics.driving.noDailyTrend"
        ) {
            AnalyticsTrendPair(
                barSeries: AnalyticsSeries.values(
                    drive.dailyTrend.map { AnalyticsFormat.distanceValue($0.distanceM, units) },
                    id: "distance",
                    name: units.distance,
                    colorIndex: 0
                ),
                lineSeries: AnalyticsSeries.values(
                    drive.dailyTrend.map { Double($0.drives) },
                    id: "drives",
                    name: String(localized: "analytics.driving.drives", defaultValue: "Drives"),
                    colorIndex: 3
                ),
                labels: drive.dailyTrend.map { String($0.date.suffix(5)) }
            )
        }
    }

    // MARK: Duration distribution (web single-series BarChart)

    private var durationDistribution: some View {
        AnalyticsChartPanel(
            title: "analytics.driving.durationDist",
            summary: "analytics.driving.durationDist.aria",
            isEmpty: drive.durationDistribution.isEmpty,
            emptyTitle: "analytics.driving.noDurationData"
        ) {
            AnalyticsSingleBars(
                series: AnalyticsSeries.counts(
                    drive.durationDistribution,
                    id: "duration",
                    name: String(localized: "analytics.driving.drives", defaultValue: "Drives"),
                    colorIndex: 4
                ),
                labels: drive.durationDistribution.map(\.label),
                height: 220
            )
        }
    }
}

/// The trailing Driving sections live in an extension so the primary `View` declaration stays within
/// the type-body length budget (the sections share the struct's private state across the same file).
extension AnalyticsDrivingTab {
    // MARK: Efficiency trend (web AreaChart over days with a completed drive)

    private var efficiencyTrend: some View {
        let points = drive.dailyTrend.compactMap { row -> (date: String, value: Double)? in
            guard let efficiency = row.efficiencyWhKm, efficiency > 0 else { return nil }
            return (row.date, AnalyticsFormat.efficiencyValue(efficiency, units))
        }
        return AnalyticsChartPanel(
            title: "analytics.driving.effTrend",
            summary: "analytics.driving.effTrend.aria",
            isEmpty: points.isEmpty,
            emptyTitle: "analytics.driving.noEffTrend"
        ) {
            VStack(spacing: TSSpacing.sm) {
                TSAreaChart(series: [
                    AnalyticsSeries.values(
                        points.map(\.value),
                        id: "efficiency",
                        name: AnalyticsFormat.efficiencyUnit(units),
                        colorIndex: 1
                    )
                ])
                .frame(height: 220)
                AnalyticsCategoryAxis(labels: points.map { String($0.date.suffix(5)) })
            }
        }
    }

    // MARK: Temperature stats (web `DrivingTemperatureStats` — 6 MetricCards)

    private var temperatureStats: some View {
        AnalyticsPanel(title: "analytics.driving.tempStats") {
            let temperature = drive.temperature
            AnalyticsMetricGrid(minimum: 130) {
                AnalyticsMetricCard(
                    title: "analytics.driving.insideMin",
                    value: AnalyticsFormat.temperature(temperature.inside.min, units),
                    systemImage: "thermometer.low",
                    tone: .accent
                )
                AnalyticsMetricCard(
                    title: "analytics.driving.insideAvg",
                    value: AnalyticsFormat.temperature(temperature.inside.avg, units),
                    systemImage: "thermometer.medium",
                    tone: .success
                )
                AnalyticsMetricCard(
                    title: "analytics.driving.insideMax",
                    value: AnalyticsFormat.temperature(temperature.inside.max, units),
                    systemImage: "thermometer.high",
                    tone: .warning
                )
                AnalyticsMetricCard(
                    title: "analytics.driving.outsideMin",
                    value: AnalyticsFormat.temperature(temperature.outside.min, units),
                    systemImage: "thermometer.low",
                    tone: .accent
                )
                AnalyticsMetricCard(
                    title: "analytics.driving.outsideAvg",
                    value: AnalyticsFormat.temperature(temperature.outside.avg, units),
                    systemImage: "thermometer.medium",
                    tone: .success
                )
                AnalyticsMetricCard(
                    title: "analytics.driving.outsideMax",
                    value: AnalyticsFormat.temperature(temperature.outside.max, units),
                    systemImage: "thermometer.high",
                    tone: .warning
                )
            }
        }
    }
}
