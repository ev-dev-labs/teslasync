import SwiftUI

// MARK: - Battery tab (web `BatteryTab`)

/// The Battery tab (web `BatteryTab`): the five battery-health cards plus the health, capacity, range,
/// and degradation/cycles trends — or a single no-data empty when there is no battery trend (web
/// `trend.length === 0`). Capacity (Wh → kWh) and range (m → distance) convert at this boundary.
struct AnalyticsBatteryTab: View {
    let data: FleetAnalyticsData
    let units: UnitPreferences

    private var trend: [AnalyticsBatteryPoint] {
        data.batteryTrend
    }

    private var labels: [String] {
        trend.map { String($0.date.suffix(5)) }
    }

    /// Web `${t('analytics.battery.range')} (${distanceUnit})` — the range line's unit-suffixed name.
    private var rangeSeriesName: String {
        "\(String(localized: "analytics.battery.range", defaultValue: "Range")) (\(units.distance))"
    }

    var body: some View {
        if trend.isEmpty {
            TSGlassPanel {
                TSEmptyState(
                    title: "analytics.battery.noData",
                    systemImage: "minus.plus.batteryblock"
                )
                .frame(maxWidth: .infinity, minHeight: 200)
            }
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                healthCards
                healthTimeline
                AnalyticsTwoColumn {
                    capacityTrend
                } trailing: {
                    rangeTrend
                }
                degradationCycles
            }
        }
    }

    private var latest: AnalyticsBatteryPoint? {
        trend.last
    }

    // MARK: Battery health cards (web 5 MetricCards from the latest point)

    private var healthCards: some View {
        AnalyticsMetricGrid(minimum: 150) {
            AnalyticsMetricCard(
                title: "analytics.battery.healthScore",
                value: AnalyticsFormat.percent(latest?.healthScore ?? 0, decimals: 1),
                systemImage: "heart.fill",
                tone: .success
            )
            AnalyticsMetricCard(
                title: "analytics.battery.capacity",
                value: "\(AnalyticsFormat.energyKWh(latest?.capacityWh ?? 0, decimals: 1)) kWh",
                systemImage: "battery.100",
                tone: .accent
            )
            AnalyticsMetricCard(
                title: "analytics.battery.degradation",
                value: AnalyticsFormat.percent(latest?.degradationPct ?? 0, decimals: 2),
                systemImage: "chart.line.uptrend.xyaxis",
                tone: .warning
            )
            AnalyticsMetricCard(
                title: "analytics.battery.estRange",
                value: AnalyticsFormat.distance(latest?.rangeM ?? 0, units, decimals: 0),
                systemImage: "mappin.and.ellipse",
                tone: .info
            )
            AnalyticsMetricCard(
                title: "analytics.battery.cycles",
                value: AnalyticsFormat.integer(Double(latest?.cycleCount ?? 0)),
                systemImage: "waveform.path.ecg",
                tone: .accent
            )
        }
    }

    // MARK: Health Score Timeline (web AreaChart, 80…100 domain)

    private var healthTimeline: some View {
        AnalyticsChartPanel(
            title: "analytics.battery.healthTimeline",
            summary: "analytics.battery.healthTimeline.aria",
            isEmpty: trend.isEmpty,
            emptyTitle: "analytics.battery.noData"
        ) {
            VStack(spacing: TSSpacing.sm) {
                TSAreaChart(series: [
                    AnalyticsSeries.values(
                        trend.map(\.healthScore),
                        id: "health",
                        name: String(localized: "analytics.battery.health", defaultValue: "Health %"),
                        colorIndex: 1
                    )
                ])
                .frame(height: 240)
                AnalyticsCategoryAxis(labels: labels)
            }
        }
    }

    // MARK: Capacity Trend (web LineChart)

    private var capacityTrend: some View {
        AnalyticsChartPanel(
            title: "analytics.battery.capacityTrend",
            summary: "analytics.battery.capacityTrend.aria",
            isEmpty: trend.isEmpty,
            emptyTitle: "analytics.battery.noData"
        ) {
            VStack(spacing: TSSpacing.sm) {
                TSLineChart(series: [
                    AnalyticsSeries.values(
                        trend.map { AnalyticsFormat.energyKWhValue($0.capacityWh) },
                        id: "capacity",
                        name: String(localized: "analytics.battery.capacity", defaultValue: "Capacity"),
                        colorIndex: 0
                    )
                ])
                .frame(height: 220)
                AnalyticsCategoryAxis(labels: labels)
            }
        }
    }

    // MARK: Range Trend (web LineChart)

    private var rangeTrend: some View {
        AnalyticsChartPanel(
            title: "analytics.battery.rangeTrend",
            summary: "analytics.battery.rangeTrend.aria",
            isEmpty: trend.isEmpty,
            emptyTitle: "analytics.battery.noData"
        ) {
            VStack(spacing: TSSpacing.sm) {
                TSLineChart(series: [
                    AnalyticsSeries.values(
                        trend.map { AnalyticsFormat.distanceValue($0.rangeM, units) },
                        id: "range",
                        name: rangeSeriesName,
                        colorIndex: 2
                    )
                ])
                .frame(height: 220)
                AnalyticsCategoryAxis(labels: labels)
            }
        }
    }

    // MARK: Degradation & Cycles (web dual-axis ComposedChart: degradation area + cycles line)

    private var degradationCycles: some View {
        AnalyticsChartPanel(
            title: "analytics.battery.degradationCycles",
            summary: "analytics.battery.degradationCycles.aria",
            isEmpty: trend.isEmpty,
            emptyTitle: "analytics.battery.noData"
        ) {
            AnalyticsTrendPair(
                barSeries: AnalyticsSeries.values(
                    trend.map(\.degradationPct),
                    id: "degradation",
                    name: String(localized: "analytics.battery.degradPct", defaultValue: "Degradation %"),
                    colorIndex: 5
                ),
                lineSeries: AnalyticsSeries.values(
                    trend.map { Double($0.cycleCount) },
                    id: "cycles",
                    name: String(localized: "analytics.battery.cycleCount", defaultValue: "Cycle Count"),
                    colorIndex: 4
                ),
                labels: labels
            )
        }
    }
}
