import Foundation

/// A representative local seed used as the `StatisticsPage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (3 vehicles, each with lifetime period stats, battery health,
/// mileage, and a state-time breakdown, plus a fleet comparison) so the surface renders its
/// populated success state out of the box (mirroring the sibling page's sample source). All
/// measurements are SI canonical (meters, watt-hours, Wh/km); the view converts at the boundary.
public struct SampleStatisticsDataSource: StatisticsDataSource {
    public init() {}

    public func loadVehicles() async throws -> [StatisticsVehicle] {
        [
            StatisticsVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            StatisticsVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002"),
            StatisticsVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003")
        ]
    }

    public func loadPeriodStats(vehicleID: Int64) async throws -> StatisticsPeriodStats? {
        switch vehicleID {
        case 1:
            StatisticsPeriodStats(
                totalDistanceM: 42_000_000,
                totalDrives: 1240,
                energyUsedWh: 7_980_000,
                avgEfficiencyWhKm: 162,
                totalCost: 1850,
                co2SavedKg: 3200
            )
        case 2:
            StatisticsPeriodStats(
                totalDistanceM: 38_000_000,
                totalDrives: 980,
                energyUsedWh: 7_360_000,
                avgEfficiencyWhKm: 174,
                totalCost: 2100,
                co2SavedKg: 2750
            )
        default:
            StatisticsPeriodStats(
                totalDistanceM: 51_500_000,
                totalDrives: 1530,
                energyUsedWh: 10_300_000,
                avgEfficiencyWhKm: 158,
                totalCost: 2680,
                co2SavedKg: 4100
            )
        }
    }

    public func loadBatteryHealth(vehicleID: Int64) async throws -> StatisticsBatteryHealth? {
        switch vehicleID {
        case 1:
            StatisticsBatteryHealth(
                currentSoh: 94.2,
                estimatedCapacityWh: 70500,
                degradationRateYr: 2.1,
                totalCycles: 312,
                batteryAgeMonths: 28
            )
        case 2:
            StatisticsBatteryHealth(
                currentSoh: 91.6,
                estimatedCapacityWh: 68200,
                degradationRateYr: 2.8,
                totalCycles: 268,
                batteryAgeMonths: 22
            )
        default:
            StatisticsBatteryHealth(
                currentSoh: 88.4,
                estimatedCapacityWh: 88400,
                degradationRateYr: 3.4,
                totalCycles: 401,
                batteryAgeMonths: 34
            )
        }
    }

    public func loadMileageStats(vehicleID: Int64) async throws -> StatisticsMileage? {
        switch vehicleID {
        case 1:
            StatisticsMileage(lifetimeDistanceM: 42_000_000, last30dDistanceM: 1_220_000, driveCountLifetime: 1240)
        case 2:
            StatisticsMileage(lifetimeDistanceM: 38_000_000, last30dDistanceM: 1_040_000, driveCountLifetime: 980)
        default:
            StatisticsMileage(lifetimeDistanceM: 51_500_000, last30dDistanceM: 1_510_000, driveCountLifetime: 1530)
        }
    }

    public func loadStateSummary(vehicleID: Int64) async throws -> [StatisticsStateEntry] {
        switch vehicleID {
        case 1:
            [
                StatisticsStateEntry(state: "driving", totalMinutes: 18420),
                StatisticsStateEntry(state: "parked", totalMinutes: 30210),
                StatisticsStateEntry(state: "charging", totalMinutes: 4150),
                StatisticsStateEntry(state: "sleeping", totalMinutes: 12300),
                StatisticsStateEntry(state: "online", totalMinutes: 2600)
            ]
        case 2:
            [
                StatisticsStateEntry(state: "driving", totalMinutes: 14980),
                StatisticsStateEntry(state: "parked", totalMinutes: 33640),
                StatisticsStateEntry(state: "charging", totalMinutes: 3870),
                StatisticsStateEntry(state: "sleeping", totalMinutes: 15120)
            ]
        default:
            [
                StatisticsStateEntry(state: "driving", totalMinutes: 22410),
                StatisticsStateEntry(state: "parked", totalMinutes: 27330),
                StatisticsStateEntry(state: "charging", totalMinutes: 5210),
                StatisticsStateEntry(state: "sleeping", totalMinutes: 9870),
                StatisticsStateEntry(state: "idle", totalMinutes: 1840)
            ]
        }
    }

    public func loadFleetAnalytics() async throws -> [StatisticsVehicleComparison] {
        [
            StatisticsVehicleComparison(id: 1, name: "Rocinante", distanceM: 42_000_000, energyWh: 7_980_000),
            StatisticsVehicleComparison(id: 2, name: "Tachi", distanceM: 38_000_000, energyWh: 7_360_000),
            StatisticsVehicleComparison(id: 3, name: "Razorback", distanceM: 51_500_000, energyWh: 10_300_000)
        ]
    }
}

#if DEBUG
    /// Preview/test seam yielding a single vehicle with no stats — drives the page's no-data empty
    /// (web `!stats`), every section's empty state, and the single-vehicle comparison empty
    /// (web `compData.length > 1` false).
    public struct EmptyStatisticsDataSource: StatisticsDataSource {
        public init() {}

        public func loadVehicles() async throws -> [StatisticsVehicle] {
            [StatisticsVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadPeriodStats(vehicleID _: Int64) async throws -> StatisticsPeriodStats? {
            nil
        }

        public func loadBatteryHealth(vehicleID _: Int64) async throws -> StatisticsBatteryHealth? {
            nil
        }

        public func loadMileageStats(vehicleID _: Int64) async throws -> StatisticsMileage? {
            nil
        }

        public func loadStateSummary(vehicleID _: Int64) async throws -> [StatisticsStateEntry] {
            []
        }

        public func loadFleetAnalytics() async throws -> [StatisticsVehicleComparison] {
            [StatisticsVehicleComparison(id: 1, name: "Rocinante", distanceM: 42_000_000, energyWh: 7_980_000)]
        }
    }

    /// Preview/test seam whose period-stats load fails — drives the error state (web `statsQuery.error`).
    public struct FailingStatisticsDataSource: StatisticsDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [StatisticsVehicle] {
            [StatisticsVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadPeriodStats(vehicleID _: Int64) async throws -> StatisticsPeriodStats? {
            throw Failure()
        }

        public func loadBatteryHealth(vehicleID _: Int64) async throws -> StatisticsBatteryHealth? {
            nil
        }

        public func loadMileageStats(vehicleID _: Int64) async throws -> StatisticsMileage? {
            nil
        }

        public func loadStateSummary(vehicleID _: Int64) async throws -> [StatisticsStateEntry] {
            []
        }

        public func loadFleetAnalytics() async throws -> [StatisticsVehicleComparison] {
            []
        }
    }
#endif
