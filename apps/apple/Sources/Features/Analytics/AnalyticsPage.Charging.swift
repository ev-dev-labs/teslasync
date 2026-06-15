import SwiftUI

// MARK: - Charging tab (web `ChargingTab` + `ChargingDetailSection`)

/// The Charging tab (web `ChargingTab`): the six summary cards, the charger-type donut + start-battery
/// distribution, the hourly pattern, the charger-brand leaderboard, the monthly trend, the cost-analysis
/// cards, and the cost-by-type breakdown. SI values (W, s, Wh) convert to kW / min / kWh at this
/// boundary; every section renders its own empty state.
struct AnalyticsChargingTab: View {
    let data: FleetAnalyticsData
    let model: AnalyticsPageModel
    let units: UnitPreferences

    private var charging: AnalyticsChargingSection {
        data.chargingAnalytics
    }

    private var minuteUnit: String {
        String(localized: "analytics.charging.min", defaultValue: "min")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            summaryCards
            AnalyticsTwoColumn {
                chargerTypes
            } trailing: {
                startBattery
            }
            hourlyPattern
            chargerBrands
            monthlyTrend
            costAnalysis
            costByType
        }
    }

    // MARK: Summary cards (web 6 MetricCards)

    private var summaryCards: some View {
        AnalyticsMetricGrid(minimum: 150) {
            AnalyticsMetricCard(
                title: "analytics.charging.sessions",
                value: AnalyticsFormat.integer(Double(data.totalChargingSessions)),
                systemImage: "powerplug.fill",
                tone: .accent
            )
            AnalyticsMetricCard(
                title: "analytics.charging.totalEnergy",
                value: "\(AnalyticsFormat.energyKWh(data.totalEnergyWh, decimals: 1)) kWh",
                systemImage: "bolt.fill",
                tone: .success
            )
            AnalyticsMetricCard(
                title: "analytics.charging.totalCost",
                value: AnalyticsFormat.currency(data.totalCost, decimals: 2),
                systemImage: "dollarsign.circle",
                tone: .warning
            )
            AnalyticsMetricCard(
                title: "analytics.charging.avgPower",
                value: "\(AnalyticsFormat.powerKW(charging.powerStats.avg)) kW",
                systemImage: "gauge.with.dots.needle.bottom.50percent",
                tone: .info
            )
            AnalyticsMetricCard(
                title: "analytics.charging.avgDuration",
                value: "\(AnalyticsFormat.durationMin(charging.durationStats.avg)) \(minuteUnit)",
                systemImage: "timer",
                tone: .accent
            )
            AnalyticsMetricCard(
                title: "analytics.charging.chargeEff",
                value: AnalyticsFormat.percent(charging.efficiencyStats.avg, decimals: 1),
                systemImage: "chart.line.uptrend.xyaxis",
                tone: .success
            )
        }
    }

    // MARK: Charger Types donut (web PieChart)

    private var chargerTypes: some View {
        AnalyticsChartPanel(
            title: "analytics.charging.chargerTypes",
            summary: "analytics.charging.chargerTypes.aria",
            isEmpty: charging.chargerTypes.isEmpty,
            emptyTitle: "analytics.charging.noTypes",
            emptyIcon: "bolt"
        ) {
            TSPieChart(slices: AnalyticsSeries.slices(charging.chargerTypes))
                .frame(height: 240)
        }
    }

    // MARK: Start Battery Distribution (web single-series BarChart)

    private var startBattery: some View {
        AnalyticsChartPanel(
            title: "analytics.charging.startBattery",
            summary: "analytics.charging.startBattery.aria",
            isEmpty: charging.startBatteryDistribution.isEmpty,
            emptyTitle: "analytics.charging.noBatDist"
        ) {
            AnalyticsSingleBars(
                series: AnalyticsSeries.counts(
                    charging.startBatteryDistribution,
                    id: "startBattery",
                    name: String(localized: "analytics.charging.sessions", defaultValue: "Sessions"),
                    colorIndex: 1
                ),
                labels: charging.startBatteryDistribution.map(\.label)
            )
        }
    }

    // MARK: Hourly Charging Pattern (web dual-axis ComposedChart: charges + energy)

    private var hourlyPattern: some View {
        AnalyticsChartPanel(
            title: "analytics.charging.hourlyPattern",
            summary: "analytics.charging.hourlyPattern.aria",
            isEmpty: charging.hourlyPattern.isEmpty,
            emptyTitle: "analytics.charging.noHourly"
        ) {
            AnalyticsTrendPair(
                barSeries: AnalyticsSeries.values(
                    charging.hourlyPattern.map { Double($0.charges) },
                    id: "charges",
                    name: String(localized: "analytics.charging.charges", defaultValue: "Charges"),
                    colorIndex: 0
                ),
                lineSeries: AnalyticsSeries.values(
                    charging.hourlyPattern.map { AnalyticsFormat.energyKWhValue($0.energyWh) },
                    id: "energy",
                    name: String(localized: "analytics.charging.energykWh", defaultValue: "Energy (kWh)"),
                    colorIndex: 3
                ),
                labels: charging.hourlyPattern.map { "\($0.hour):00" }
            )
        }
    }

    // MARK: Charger Brands leaderboard (web flex rows + neon bars)

    private var chargerBrands: some View {
        AnalyticsPanel(title: "analytics.charging.chargerBrands") {
            let entries = model.chargerBrandLeaderboard
            if entries.isEmpty {
                TSEmptyState(title: "analytics.charging.noBrands", systemImage: "bolt")
                    .frame(maxWidth: .infinity, minHeight: 160)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        AnalyticsBarRow(
                            leading: "#\(index + 1) \(entry.brand)",
                            trailing: "\(AnalyticsFormat.integer(Double(entry.count))) \(sessionsWord)",
                            fraction: entry.fraction,
                            tone: .success
                        )
                    }
                }
            }
        }
    }

    private var sessionsWord: String {
        String(localized: "analytics.charging.sessions", defaultValue: "Sessions")
    }

    // MARK: Monthly Charging Trend (web ComposedChart: energy area + sessions bar + avg-power line)

    private var monthlyTrend: some View {
        let rows = charging.monthlyTrend
        return AnalyticsChartPanel(
            title: "analytics.charging.monthlyTrend",
            summary: "analytics.charging.monthlyTrend.aria",
            isEmpty: rows.isEmpty,
            emptyTitle: "analytics.charging.noMonthly"
        ) {
            VStack(spacing: TSSpacing.sm) {
                TSBarChart(series: [
                    AnalyticsSeries.values(
                        rows.map { AnalyticsFormat.energyKWhValue($0.energyWh) },
                        id: "energy",
                        name: String(localized: "analytics.charging.energykWh", defaultValue: "Energy (kWh)"),
                        colorIndex: 1
                    ),
                    AnalyticsSeries.values(
                        rows.map { Double($0.sessions) },
                        id: "sessions",
                        name: String(localized: "analytics.charging.sessions", defaultValue: "Sessions"),
                        colorIndex: 2
                    )
                ])
                .frame(height: 160)
                TSLineChart(series: [
                    AnalyticsSeries.values(
                        rows.map { AnalyticsFormat.powerKWValue($0.avgPowerW) },
                        id: "avgPower",
                        name: String(localized: "analytics.charging.avgPowerkW", defaultValue: "Avg Power (kW)"),
                        colorIndex: 3
                    )
                ])
                .frame(height: 110)
                AnalyticsCategoryAxis(labels: rows.map(\.month))
                AnalyticsChartLegend(items: [
                    (1, String(localized: "analytics.charging.energykWh", defaultValue: "Energy (kWh)")),
                    (2, String(localized: "analytics.charging.sessions", defaultValue: "Sessions")),
                    (3, String(localized: "analytics.charging.avgPowerkW", defaultValue: "Avg Power (kW)"))
                ])
            }
            .accessibilityElement(children: .contain)
        }
    }

    // MARK: Cost Analysis (web 4 MetricCards)

    private var costAnalysis: some View {
        AnalyticsPanel(title: "analytics.charging.costAnalysis") {
            let cost = charging.costStats
            if cost.hasSamples {
                AnalyticsMetricGrid(minimum: 150) {
                    AnalyticsMetricCard(
                        title: "analytics.charging.minCost",
                        value: AnalyticsFormat.currency(cost.min, decimals: 2),
                        systemImage: "dollarsign.circle",
                        tone: .success
                    )
                    AnalyticsMetricCard(
                        title: "analytics.charging.avgCost",
                        value: AnalyticsFormat.currency(cost.avg, decimals: 2),
                        systemImage: "dollarsign.circle",
                        tone: .accent
                    )
                    AnalyticsMetricCard(
                        title: "analytics.charging.medianCost",
                        value: AnalyticsFormat.currency(cost.median, decimals: 2),
                        systemImage: "dollarsign.circle",
                        tone: .info
                    )
                    AnalyticsMetricCard(
                        title: "analytics.charging.maxCost",
                        value: AnalyticsFormat.currency(cost.max, decimals: 2),
                        systemImage: "dollarsign.circle",
                        tone: .warning
                    )
                }
            } else {
                TSEmptyState(title: "analytics.charging.noCostStats", systemImage: "dollarsign.circle")
                    .frame(maxWidth: .infinity, minHeight: 120)
            }
        }
    }

    // MARK: Cost by Charger Type (web flex rows + colored bars)

    private var costByType: some View {
        AnalyticsPanel(title: "analytics.charging.costByType") {
            let entries = model.costByType
            if entries.isEmpty {
                TSEmptyState(title: "analytics.charging.noCostByType", systemImage: "bolt")
                    .frame(maxWidth: .infinity, minHeight: 160)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(entries) { entry in
                        AnalyticsBarRow(
                            leading: entry.type,
                            trailing: "\(entry.count) (\(AnalyticsFormat.integer(entry.fraction * 100))%)",
                            fraction: entry.fraction,
                            tone: .accent
                        )
                    }
                }
            }
        }
    }
}
