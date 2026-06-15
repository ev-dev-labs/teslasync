import Foundation

/// A representative local seed used as the `AnalyticsPage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (a fleet of three vehicles with deep drive / charging / battery
/// analytics) so the surface renders its populated success state out of the box (mirroring the
/// sibling pages' sample sources). All measurements are SI canonical (meters, watt-hours,
/// metres-per-second, watts, seconds, °C); the view converts at the boundary.
public struct SampleAnalyticsDataSource: AnalyticsDataSource {
    public init() {}

    public func loadFleetAnalytics(range _: AnalyticsRange) async throws -> FleetAnalyticsData? {
        SampleAnalyticsFixture.fleet
    }
}

#if DEBUG
    /// Preview/test seam yielding no payload — drives the page's defensive empty state (web `!data`).
    public struct EmptyAnalyticsDataSource: AnalyticsDataSource {
        public init() {}

        public func loadFleetAnalytics(range _: AnalyticsRange) async throws -> FleetAnalyticsData? {
            nil
        }
    }

    /// Preview/test seam whose load fails — drives the error state (web `fleetQuery.error`).
    public struct FailingAnalyticsDataSource: AnalyticsDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadFleetAnalytics(range _: AnalyticsRange) async throws -> FleetAnalyticsData? {
            throw Failure()
        }
    }
#endif

/// The shared fleet fixture, assembled from SI building blocks so the populated state exercises
/// every hero gauge, tab, chart, leaderboard, and per-section empty fallback.
public enum SampleAnalyticsFixture {
    public static let fleet = FleetAnalyticsData(
        periodDays: 30,
        totalVehicles: 3,
        totalDistanceM: 131_500_000,
        totalDrives: 3750,
        totalChargingSessions: 412,
        totalEnergyWh: 25_640_000,
        totalCost: 6630,
        avgEfficiencyWhKm: 164,
        vehicleComparison: [
            AnalyticsVehicleComparison(
                id: 1, name: "Rocinante", distanceM: 42_000_000, energyWh: 7_980_000, efficiencyWhKm: 162, drives: 1240
            ),
            AnalyticsVehicleComparison(
                id: 2, name: "Tachi", distanceM: 38_000_000, energyWh: 7_360_000, efficiencyWhKm: 174, drives: 980
            ),
            AnalyticsVehicleComparison(
                id: 3, name: "Razorback", distanceM: 51_500_000, energyWh: 10_300_000, efficiencyWhKm: 158, drives: 1530
            )
        ],
        driveAnalytics: driveSection,
        chargingAnalytics: chargingSection,
        batteryTrend: batteryTrend
    )

    private static var driveSection: AnalyticsDriveSection {
        AnalyticsDriveSection(
            hourlyPattern: (5 ... 22).map { (hour: Int) -> AnalyticsHourlyDrive in
                let drives = 20 + (hour * 7) % 95
                let distanceM = Double(4000 + (hour * 1300) % 26000)
                return AnalyticsHourlyDrive(hour: hour, drives: drives, distanceM: distanceM)
            },
            dayOfWeek: [
                AnalyticsDayOfWeek(day: "Mon", drives: 612, distanceM: 7_400_000, avgDistanceM: 12090),
                AnalyticsDayOfWeek(day: "Tue", drives: 588, distanceM: 6_980_000, avgDistanceM: 11870),
                AnalyticsDayOfWeek(day: "Wed", drives: 640, distanceM: 7_810_000, avgDistanceM: 12200),
                AnalyticsDayOfWeek(day: "Thu", drives: 605, distanceM: 7_120_000, avgDistanceM: 11760),
                AnalyticsDayOfWeek(day: "Fri", drives: 690, distanceM: 8_640_000, avgDistanceM: 12520),
                AnalyticsDayOfWeek(day: "Sat", drives: 358, distanceM: 5_220_000, avgDistanceM: 14580),
                AnalyticsDayOfWeek(day: "Sun", drives: 257, distanceM: 3_760_000, avgDistanceM: 14630)
            ],
            speedDistribution: [
                AnalyticsBucket(label: "0–25", count: 410),
                AnalyticsBucket(label: "25–50", count: 980),
                AnalyticsBucket(label: "50–75", count: 1240),
                AnalyticsBucket(label: "75–100", count: 760),
                AnalyticsBucket(label: "100+", count: 360)
            ],
            distanceDistribution: [
                AnalyticsBucket(label: "0–5", count: 1180),
                AnalyticsBucket(label: "5–15", count: 1320),
                AnalyticsBucket(label: "15–40", count: 820),
                AnalyticsBucket(label: "40–80", count: 290),
                AnalyticsBucket(label: "80+", count: 140)
            ],
            durationDistribution: [
                AnalyticsBucket(label: "0–10", count: 1010),
                AnalyticsBucket(label: "10–20", count: 1290),
                AnalyticsBucket(label: "20–40", count: 940),
                AnalyticsBucket(label: "40–60", count: 360),
                AnalyticsBucket(label: "60+", count: 150)
            ],
            speedStats: AnalyticsStatsSummary(min: 0, max: 38.6, avg: 13.9, median: 12.4, p95: 31.2, count: 3750),
            powerStats: AnalyticsStatsSummary(
                min: 0, max: 251_000, avg: 28400, median: 21800, p95: 124_000, count: 3750
            ),
            regenStats: AnalyticsStatsSummary(
                min: 0, max: 61400, avg: 9200, median: 7600, p95: 38600, count: 3750
            ),
            durationStats: AnalyticsStatsSummary(
                min: 120, max: 9300, avg: 1486, median: 1180, p95: 3960, count: 3750
            ),
            distanceStats: AnalyticsStatsSummary(
                min: 220, max: 458_000, avg: 25400, median: 14600, p95: 96400, count: 3750
            ),
            efficiencyStats: AnalyticsStatsSummary(min: 118, max: 268, avg: 164, median: 159, p95: 232, count: 3750),
            dailyTrend: dailyTrend,
            tempVsEfficiency: tempVsEfficiency,
            temperature: AnalyticsTemperature(
                inside: AnalyticsStatsSummary(min: 16.5, max: 27.8, avg: 21.6, median: 21.4, p95: 26.1, count: 3750),
                outside: AnalyticsStatsSummary(min: -6.2, max: 34.1, avg: 14.8, median: 15.2, p95: 30.4, count: 3750)
            )
        )
    }

    private static var dailyTrend: [AnalyticsDailyDrive] {
        (1 ... 14).map { (day: Int) -> AnalyticsDailyDrive in
            let drives = 110 + (day * 13) % 90
            let distanceM = Double(2_100_000 + (day * 410_000) % 3_600_000)
            let efficiency: Double? = day % 5 == 0 ? nil : Double(150 + (day * 7) % 40)
            return AnalyticsDailyDrive(
                date: String(format: "2026-05-%02d", day),
                drives: drives,
                distanceM: distanceM,
                efficiencyWhKm: efficiency
            )
        }
    }

    private static var tempVsEfficiency: [AnalyticsTempEfficiency] {
        (0 ..< 14).map { (index: Int) -> AnalyticsTempEfficiency in
            let tempC = Double(-8 + index * 3)
            let efficiency = Double(150 + abs(index - 8) * 9)
            let distanceM = Double(8000 + (index * 5400) % 42000)
            return AnalyticsTempEfficiency(id: index, tempC: tempC, efficiencyWhKm: efficiency, distanceM: distanceM)
        }
    }

    private static var chargingSection: AnalyticsChargingSection {
        AnalyticsChargingSection(
            hourlyPattern: (0 ... 23).map { (hour: Int) -> AnalyticsHourlyCharge in
                let charges = 4 + (hour * 5) % 41
                let energyWh = Double(18000 + (hour * 9700) % 260_000)
                return AnalyticsHourlyCharge(hour: hour, charges: charges, energyWh: energyWh)
            },
            chargerTypes: [
                AnalyticsBucket(label: "Supercharger", count: 184),
                AnalyticsBucket(label: "Home AC", count: 156),
                AnalyticsBucket(label: "Destination", count: 48),
                AnalyticsBucket(label: "CCS", count: 24)
            ],
            chargerBrands: [
                AnalyticsBucket(label: "Tesla", count: 232),
                AnalyticsBucket(label: "Home", count: 156),
                AnalyticsBucket(label: "Electrify America", count: 16),
                AnalyticsBucket(label: "EVgo", count: 8)
            ],
            monthlyTrend: [
                AnalyticsMonthlyCharge(
                    month: "Jan", energyWh: 3_980_000, cost: 920, sessions: 64,
                    avgPowerW: 42000, gasCost: 1840, savings: 920
                ),
                AnalyticsMonthlyCharge(
                    month: "Feb", energyWh: 3_640_000, cost: 860, sessions: 58,
                    avgPowerW: 44000, gasCost: 1690, savings: 830
                ),
                AnalyticsMonthlyCharge(
                    month: "Mar", energyWh: 4_320_000, cost: 1010, sessions: 71,
                    avgPowerW: 46500, gasCost: 1980, savings: 970
                ),
                AnalyticsMonthlyCharge(
                    month: "Apr", energyWh: 4_180_000, cost: 980, sessions: 69,
                    avgPowerW: 45200, gasCost: 1920, savings: 940
                ),
                AnalyticsMonthlyCharge(
                    month: "May", energyWh: 4_560_000, cost: 1080, sessions: 75,
                    avgPowerW: 47800, gasCost: 2110, savings: 1030
                ),
                AnalyticsMonthlyCharge(
                    month: "Jun", energyWh: 4_960_000, cost: 1180, sessions: 75,
                    avgPowerW: 48600, gasCost: 2280, savings: 1100
                )
            ],
            powerStats: AnalyticsStatsSummary(
                min: 7400, max: 250_000, avg: 45800, median: 44000, p95: 152_000, count: 412
            ),
            durationStats: AnalyticsStatsSummary(
                min: 360, max: 18600, avg: 2760, median: 2280, p95: 7200, count: 412
            ),
            energyStats: AnalyticsStatsSummary(
                min: 4200, max: 78400, avg: 62200, median: 58600, p95: 76800, count: 412
            ),
            costStats: AnalyticsStatsSummary(min: 0, max: 38.4, avg: 16.1, median: 14.2, p95: 31.6, count: 412),
            startBatteryDistribution: [
                AnalyticsBucket(label: "0–20", count: 58),
                AnalyticsBucket(label: "20–40", count: 142),
                AnalyticsBucket(label: "40–60", count: 124),
                AnalyticsBucket(label: "60–80", count: 64),
                AnalyticsBucket(label: "80–100", count: 24)
            ],
            efficiencyStats: AnalyticsStatsSummary(min: 86.4, max: 98.2, avg: 92.6, median: 93.1, p95: 97.4, count: 412)
        )
    }

    private static var batteryTrend: [AnalyticsBatteryPoint] {
        (1 ... 14).map { (day: Int) -> AnalyticsBatteryPoint in
            let dayValue = Double(day)
            return AnalyticsBatteryPoint(
                date: String(format: "2026-05-%02d", day),
                healthScore: 96.4 - dayValue * 0.18,
                capacityWh: 75500 - dayValue * 42,
                degradationPct: 1.6 + dayValue * 0.04,
                rangeM: Double(512_000 - day * 900),
                cycleCount: 280 + day * 2
            )
        }
    }
}
