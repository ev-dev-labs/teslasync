import SwiftUI

// MARK: - Hero gauges (web `HeroGauges` — 6 MetricCards)

/// The six fleet headline cards above the tabs (web `HeroGauges`): total distance, drives, energy,
/// average efficiency, gas savings, and CO₂ saved. Distance / energy / efficiency convert from SI to
/// the user's unit at this boundary; gas savings + CO₂ follow the web km-pinned heuristics.
struct AnalyticsHeroSection: View {
    let data: FleetAnalyticsData
    let units: UnitPreferences

    var body: some View {
        AnalyticsMetricGrid(minimum: 150) {
            AnalyticsMetricCard(
                title: "analytics.hero.distance",
                value: AnalyticsFormat.distance(data.totalDistanceM, units, decimals: 1),
                systemImage: "mappin.and.ellipse",
                tone: .accent
            )
            AnalyticsMetricCard(
                title: "analytics.hero.drives",
                value: AnalyticsFormat.integer(Double(data.totalDrives)),
                systemImage: "car.fill",
                tone: .info
            )
            AnalyticsMetricCard(
                title: "analytics.hero.energy",
                value: "\(AnalyticsFormat.energyKWh(data.totalEnergyWh, decimals: 1)) kWh",
                systemImage: "bolt.fill",
                tone: .success
            )
            AnalyticsMetricCard(
                title: "analytics.hero.efficiency",
                value: AnalyticsFormat.efficiency(data.avgEfficiencyWhKm, units),
                systemImage: "gauge.with.dots.needle.bottom.50percent",
                tone: .warning
            )
            AnalyticsMetricCard(
                title: "analytics.hero.gasSavings",
                value: AnalyticsFormat.currency(data.gasSavings, decimals: 0),
                systemImage: "dollarsign.circle",
                tone: .success
            )
            AnalyticsMetricCard(
                title: "analytics.hero.co2Saved",
                value: AnalyticsFormat.kilograms(data.co2SavedKg, decimals: 0),
                systemImage: "leaf.fill",
                tone: .success
            )
        }
    }
}
