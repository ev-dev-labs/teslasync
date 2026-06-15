import Foundation

// Charging-analytics, battery-trend, and top-level value types for the Fleet-Analytics surface
// (web `charging_analytics`, `battery_trend`, `FleetAnalytics`). Split from `AnalyticsModels.swift` to
// keep each file within the length budget; all measurements remain SI canonical (see that file).

// MARK: - Charging analytics (web `charging_analytics`)

/// One hour bucket of charging activity (web `charging_analytics.hourly_pattern[]`). Energy is SI Wh.
public struct AnalyticsHourlyCharge: Identifiable, Hashable, Sendable {
    public let hour: Int
    public let charges: Int
    public let energyWh: Double

    public var id: Int {
        hour
    }

    public init(hour: Int, charges: Int, energyWh: Double) {
        self.hour = hour
        self.charges = charges
        self.energyWh = energyWh
    }
}

/// One month on the charging trend (web `charging_analytics.monthly_trend[]`). Energy is SI Wh,
/// average power SI W; cost / gas-cost / savings are raw currency.
public struct AnalyticsMonthlyCharge: Identifiable, Hashable, Sendable {
    public let month: String
    public let energyWh: Double
    public let cost: Double
    public let sessions: Int
    public let avgPowerW: Double
    public let gasCost: Double
    public let savings: Double

    public var id: String {
        month
    }

    public init(
        month: String,
        energyWh: Double,
        cost: Double,
        sessions: Int,
        avgPowerW: Double,
        gasCost: Double,
        savings: Double
    ) {
        self.month = month
        self.energyWh = energyWh
        self.cost = cost
        self.sessions = sessions
        self.avgPowerW = avgPowerW
        self.gasCost = gasCost
        self.savings = savings
    }
}

/// The full charging-analytics block (web `charging_analytics`). Stat summaries carry SI bases:
/// `powerStats` W, `durationStats` s, `energyStats` Wh, `costStats` raw currency, `efficiencyStats`
/// percent.
public struct AnalyticsChargingSection: Hashable, Sendable {
    public let hourlyPattern: [AnalyticsHourlyCharge]
    public let chargerTypes: [AnalyticsBucket]
    public let chargerBrands: [AnalyticsBucket]
    public let monthlyTrend: [AnalyticsMonthlyCharge]
    public let powerStats: AnalyticsStatsSummary
    public let durationStats: AnalyticsStatsSummary
    public let energyStats: AnalyticsStatsSummary
    public let costStats: AnalyticsStatsSummary
    public let startBatteryDistribution: [AnalyticsBucket]
    public let efficiencyStats: AnalyticsStatsSummary

    public init(
        hourlyPattern: [AnalyticsHourlyCharge],
        chargerTypes: [AnalyticsBucket],
        chargerBrands: [AnalyticsBucket],
        monthlyTrend: [AnalyticsMonthlyCharge],
        powerStats: AnalyticsStatsSummary,
        durationStats: AnalyticsStatsSummary,
        energyStats: AnalyticsStatsSummary,
        costStats: AnalyticsStatsSummary,
        startBatteryDistribution: [AnalyticsBucket],
        efficiencyStats: AnalyticsStatsSummary
    ) {
        self.hourlyPattern = hourlyPattern
        self.chargerTypes = chargerTypes
        self.chargerBrands = chargerBrands
        self.monthlyTrend = monthlyTrend
        self.powerStats = powerStats
        self.durationStats = durationStats
        self.energyStats = energyStats
        self.costStats = costStats
        self.startBatteryDistribution = startBatteryDistribution
        self.efficiencyStats = efficiencyStats
    }
}

// MARK: - Battery trend (web `battery_trend[]`)

/// One day on the battery-health trend (web `battery_trend[]`). Capacity is SI watt-hours (web wire
/// is Wh already), range SI meters (web wire is km × 1000); health/degradation are percents.
public struct AnalyticsBatteryPoint: Identifiable, Hashable, Sendable {
    public let date: String
    public let healthScore: Double
    public let capacityWh: Double
    public let degradationPct: Double
    public let rangeM: Double
    public let cycleCount: Int

    public var id: String {
        date
    }

    public init(
        date: String,
        healthScore: Double,
        capacityWh: Double,
        degradationPct: Double,
        rangeM: Double,
        cycleCount: Int
    ) {
        self.date = date
        self.healthScore = healthScore
        self.capacityWh = capacityWh
        self.degradationPct = degradationPct
        self.rangeM = rangeM
        self.cycleCount = cycleCount
    }
}

// MARK: - Top-level fleet analytics (web `FleetAnalytics`)

/// The whole `/analytics/fleet` payload (web `FleetAnalytics`). Distance is SI meters (web wire is
/// km × 1000), energy SI watt-hours (web wire is kWh), efficiency Wh/km. The presence of this value
/// drives the page's success phase; its absence the empty phase.
public struct FleetAnalyticsData: Hashable, Sendable {
    public let periodDays: Int
    public let totalVehicles: Int
    public let totalDistanceM: Double
    public let totalDrives: Int
    public let totalChargingSessions: Int
    public let totalEnergyWh: Double
    public let totalCost: Double
    public let avgEfficiencyWhKm: Double
    public let vehicleComparison: [AnalyticsVehicleComparison]
    public let driveAnalytics: AnalyticsDriveSection
    public let chargingAnalytics: AnalyticsChargingSection
    public let batteryTrend: [AnalyticsBatteryPoint]

    public init(
        periodDays: Int,
        totalVehicles: Int,
        totalDistanceM: Double,
        totalDrives: Int,
        totalChargingSessions: Int,
        totalEnergyWh: Double,
        totalCost: Double,
        avgEfficiencyWhKm: Double,
        vehicleComparison: [AnalyticsVehicleComparison],
        driveAnalytics: AnalyticsDriveSection,
        chargingAnalytics: AnalyticsChargingSection,
        batteryTrend: [AnalyticsBatteryPoint]
    ) {
        self.periodDays = periodDays
        self.totalVehicles = totalVehicles
        self.totalDistanceM = totalDistanceM
        self.totalDrives = totalDrives
        self.totalChargingSessions = totalChargingSessions
        self.totalEnergyWh = totalEnergyWh
        self.totalCost = totalCost
        self.avgEfficiencyWhKm = avgEfficiencyWhKm
        self.vehicleComparison = vehicleComparison
        self.driveAnalytics = driveAnalytics
        self.chargingAnalytics = chargingAnalytics
        self.batteryTrend = batteryTrend
    }

    /// Web `total_distance_km` — the SI meters expressed as kilometres for the gas-savings + CO₂
    /// heuristics, which are pinned to km regardless of the display unit (web `HeroGauges`).
    public var totalDistanceKm: Double {
        totalDistanceM / 1000
    }

    /// Web `data.total_distance_km * 0.085 * 1.5 - safe(data.total_cost)` floored at zero — the
    /// estimated fuel saving versus an equivalent gasoline vehicle.
    public var gasSavings: Double {
        Swift.max(totalDistanceKm * 0.085 * 1.5 - totalCost, 0)
    }

    /// Web `data.total_distance_km * 0.12` — the CO₂ avoided, in kilograms.
    public var co2SavedKg: Double {
        totalDistanceKm * 0.12
    }
}
