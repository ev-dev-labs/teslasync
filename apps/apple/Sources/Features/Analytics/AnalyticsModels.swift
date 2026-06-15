import Foundation

// Value types for the Fleet-Analytics surface (web `AnalyticsPage.tsx`, route `/analytics`). The
// page is fed by a single source — web `useFleetAnalytics({ start, end })` → `GET /analytics/fleet`
// — whose nested payload drives the hero gauges plus the four tabs (Overview / Driving / Charging /
// Battery). Every measurement is SI canonical exactly as Phase-42 stores it (meters, watt-hours,
// metres-per-second, watts, seconds, °C); the user's unit preference is applied only at the SwiftUI
// render boundary via the shared `Units` facade (ADR-005, SI-cutover instructions). Field names
// mirror the snake_case wire so the production KMP-backed source maps straight across, with the unit
// suffix recording the SI base on disk.

// MARK: - Stats summary (web `StatsSummary`: min/max/avg/median/p95/count)

/// A five-number summary for one metric (web `StatsSummary`). The struct is unit-agnostic — each
/// call site knows the SI base of the values it holds (m/s for speed, W for power, s for duration,
/// m for distance, °C for temperature, raw currency/percent where noted) and formats accordingly.
public struct AnalyticsStatsSummary: Hashable, Sendable {
    public let min: Double
    public let max: Double
    public let avg: Double
    public let median: Double
    public let p95: Double
    public let count: Int

    public init(min: Double, max: Double, avg: Double, median: Double, p95: Double, count: Int) {
        self.min = min
        self.max = max
        self.avg = avg
        self.median = median
        self.p95 = p95
        self.count = count
    }

    /// Whether the summary carries any samples (web optional-stats presence check, e.g. `cost_stats ?`).
    public var hasSamples: Bool {
        // `count` is a statistical sample tally, not a collection size — `isEmpty` does not apply.
        // swiftlint:disable:next empty_count
        count > 0
    }
}

// MARK: - Shared building blocks

/// A labeled categorical bucket count (web distribution rows: `{ range, count }` and
/// `{ type|brand, count }`). `range` doubles as the stable identity.
public struct AnalyticsBucket: Identifiable, Hashable, Sendable {
    public let label: String
    public let count: Int

    public var id: String {
        label
    }

    public init(label: String, count: Int) {
        self.label = label
        self.count = count
    }
}

/// One vehicle in the fleet roll-up (web `vehicle_comparison[]`). Distance is SI meters (web wire is
/// km × 1000), energy SI watt-hours (web wire is kWh), efficiency Wh/km; all convert at the boundary.
public struct AnalyticsVehicleComparison: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let name: String
    public let distanceM: Double
    public let energyWh: Double
    public let efficiencyWhKm: Double
    public let drives: Int

    public init(id: Int64, name: String, distanceM: Double, energyWh: Double, efficiencyWhKm: Double, drives: Int) {
        self.id = id
        self.name = name
        self.distanceM = distanceM
        self.energyWh = energyWh
        self.efficiencyWhKm = efficiencyWhKm
        self.drives = drives
    }
}

// MARK: - Drive analytics (web `drive_analytics`)

/// One hour bucket of driving activity (web `drive_analytics.hourly_pattern[]`). Distance is SI m.
public struct AnalyticsHourlyDrive: Identifiable, Hashable, Sendable {
    public let hour: Int
    public let drives: Int
    public let distanceM: Double

    public var id: Int {
        hour
    }

    public init(hour: Int, drives: Int, distanceM: Double) {
        self.hour = hour
        self.drives = drives
        self.distanceM = distanceM
    }
}

/// One weekday bucket (web `drive_analytics.day_of_week[]`). Distances are SI meters.
public struct AnalyticsDayOfWeek: Identifiable, Hashable, Sendable {
    public let day: String
    public let drives: Int
    public let distanceM: Double
    public let avgDistanceM: Double

    public var id: String {
        day
    }

    public init(day: String, drives: Int, distanceM: Double, avgDistanceM: Double) {
        self.day = day
        self.drives = drives
        self.distanceM = distanceM
        self.avgDistanceM = avgDistanceM
    }
}

/// One day on the daily driving trend (web `drive_analytics.daily_trend[]`). Distance is SI meters;
/// efficiency is Wh/km and absent on days with no completed drive (web optional `efficiency`).
public struct AnalyticsDailyDrive: Identifiable, Hashable, Sendable {
    public let date: String
    public let drives: Int
    public let distanceM: Double
    public let efficiencyWhKm: Double?

    public var id: String {
        date
    }

    public init(date: String, drives: Int, distanceM: Double, efficiencyWhKm: Double?) {
        self.date = date
        self.drives = drives
        self.distanceM = distanceM
        self.efficiencyWhKm = efficiencyWhKm
    }
}

/// One scatter sample relating cabin/ambient temperature to trip efficiency (web
/// `drive_analytics.temp_vs_efficiency[]`). Temp is SI °C, efficiency Wh/km, distance SI meters.
public struct AnalyticsTempEfficiency: Identifiable, Hashable, Sendable {
    public let id: Int
    public let tempC: Double
    public let efficiencyWhKm: Double
    public let distanceM: Double

    public init(id: Int, tempC: Double, efficiencyWhKm: Double, distanceM: Double) {
        self.id = id
        self.tempC = tempC
        self.efficiencyWhKm = efficiencyWhKm
        self.distanceM = distanceM
    }
}

/// Inside + outside temperature five-number summaries (web `drive_analytics.temperature`). Both
/// summaries carry values in SI °C.
public struct AnalyticsTemperature: Hashable, Sendable {
    public let inside: AnalyticsStatsSummary
    public let outside: AnalyticsStatsSummary

    public init(inside: AnalyticsStatsSummary, outside: AnalyticsStatsSummary) {
        self.inside = inside
        self.outside = outside
    }
}

/// The full driving-analytics block (web `drive_analytics`). Stat summaries carry SI bases:
/// `speedStats` m/s, `powerStats`/`regenStats` W, `durationStats` s, `distanceStats` m,
/// `efficiencyStats` Wh/km, temperature °C.
public struct AnalyticsDriveSection: Hashable, Sendable {
    public let hourlyPattern: [AnalyticsHourlyDrive]
    public let dayOfWeek: [AnalyticsDayOfWeek]
    public let speedDistribution: [AnalyticsBucket]
    public let distanceDistribution: [AnalyticsBucket]
    public let durationDistribution: [AnalyticsBucket]
    public let speedStats: AnalyticsStatsSummary
    public let powerStats: AnalyticsStatsSummary
    public let regenStats: AnalyticsStatsSummary
    public let durationStats: AnalyticsStatsSummary
    public let distanceStats: AnalyticsStatsSummary
    public let efficiencyStats: AnalyticsStatsSummary
    public let dailyTrend: [AnalyticsDailyDrive]
    public let tempVsEfficiency: [AnalyticsTempEfficiency]
    public let temperature: AnalyticsTemperature

    public init(
        hourlyPattern: [AnalyticsHourlyDrive],
        dayOfWeek: [AnalyticsDayOfWeek],
        speedDistribution: [AnalyticsBucket],
        distanceDistribution: [AnalyticsBucket],
        durationDistribution: [AnalyticsBucket],
        speedStats: AnalyticsStatsSummary,
        powerStats: AnalyticsStatsSummary,
        regenStats: AnalyticsStatsSummary,
        durationStats: AnalyticsStatsSummary,
        distanceStats: AnalyticsStatsSummary,
        efficiencyStats: AnalyticsStatsSummary,
        dailyTrend: [AnalyticsDailyDrive],
        tempVsEfficiency: [AnalyticsTempEfficiency],
        temperature: AnalyticsTemperature
    ) {
        self.hourlyPattern = hourlyPattern
        self.dayOfWeek = dayOfWeek
        self.speedDistribution = speedDistribution
        self.distanceDistribution = distanceDistribution
        self.durationDistribution = durationDistribution
        self.speedStats = speedStats
        self.powerStats = powerStats
        self.regenStats = regenStats
        self.durationStats = durationStats
        self.distanceStats = distanceStats
        self.efficiencyStats = efficiencyStats
        self.dailyTrend = dailyTrend
        self.tempVsEfficiency = tempVsEfficiency
        self.temperature = temperature
    }
}
