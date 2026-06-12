import Foundation

/// A representative local seed used as the `FleetComparePage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it is
/// an API-response-shaped fixture (3 vehicles, each with live state, lifetime driving stats,
/// charging cost, and a few months of mileage) so the surface renders its populated, two-up
/// comparison state out of the box (mirroring the sibling pages' sample sources). All
/// measurements are SI canonical (meters, m/s, °C, Wh); the view converts at the display boundary.
public struct SampleFleetCompareDataSource: FleetCompareDataSource {
    public init() {}

    public func loadVehicles() async throws -> [FleetCompareVehicle] {
        [
            FleetCompareVehicle(
                id: 1,
                displayName: "Rocinante",
                vin: "5YJ3E1EA7KF000001",
                model: "Model 3",
                trimBadging: "Performance",
                onlineState: "online"
            ),
            FleetCompareVehicle(
                id: 2,
                displayName: "Tachi",
                vin: "5YJYGDEE1LF000002",
                model: "Model Y",
                trimBadging: "Long Range",
                onlineState: "asleep"
            ),
            FleetCompareVehicle(
                id: 3,
                displayName: "Razorback",
                vin: "5YJSA1E26MF000003",
                model: "Model S",
                trimBadging: "Plaid",
                onlineState: "online"
            )
        ]
    }

    public func loadState(vehicleID: Int64) async throws -> FleetCompareVehicleState? {
        switch vehicleID {
        case 1:
            FleetCompareVehicleState(
                batteryLevel: 82,
                ratedRangeM: 384_000,
                insideTempC: 21.0,
                outsideTempC: 13.5,
                isLocked: true,
                sentryMode: true
            )
        case 2:
            FleetCompareVehicleState(
                batteryLevel: 64,
                ratedRangeM: 412_000,
                insideTempC: 20.0,
                outsideTempC: 13.5,
                isLocked: false,
                sentryMode: false
            )
        default:
            FleetCompareVehicleState(
                batteryLevel: 47,
                ratedRangeM: 498_000,
                insideTempC: 22.5,
                outsideTempC: 13.0,
                isLocked: true,
                sentryMode: false
            )
        }
    }

    public func loadDrivingStats(vehicleID: Int64) async throws -> FleetCompareDrivingStats? {
        switch vehicleID {
        case 1:
            FleetCompareDrivingStats(
                totalDrives: 1240,
                totalDistanceM: 42_000_000,
                avgSpeedMps: 14.44,
                topSpeedMps: 54.17,
                avgEfficiencyWhKm: 152,
                regenRatio: 0.18,
                co2SavedKg: 3200
            )
        case 2:
            FleetCompareDrivingStats(
                totalDrives: 980,
                totalDistanceM: 38_000_000,
                avgSpeedMps: 13.33,
                topSpeedMps: 50.0,
                avgEfficiencyWhKm: 168,
                regenRatio: 0.15,
                co2SavedKg: 2750
            )
        default:
            FleetCompareDrivingStats(
                totalDrives: 1530,
                totalDistanceM: 51_500_000,
                avgSpeedMps: 16.10,
                topSpeedMps: 67.06,
                avgEfficiencyWhKm: 174,
                regenRatio: 0.21,
                co2SavedKg: 4100
            )
        }
    }

    public func loadCostBreakdown(vehicleID: Int64) async throws -> FleetCompareCostBreakdown? {
        switch vehicleID {
        case 1:
            FleetCompareCostBreakdown(totalChargingCost: 1850, totalWh: 8_400_000, totalSessions: 410)
        case 2:
            FleetCompareCostBreakdown(totalChargingCost: 2100, totalWh: 9_100_000, totalSessions: 360)
        default:
            FleetCompareCostBreakdown(totalChargingCost: 2680, totalWh: 11_300_000, totalSessions: 505)
        }
    }

    public func loadMonthlyMileage(vehicleID: Int64) async throws -> [FleetCompareMonthlyBucket] {
        switch vehicleID {
        case 1:
            [
                FleetCompareMonthlyBucket(yearMonth: "2024-01", distanceM: 1_180_000, driveCount: 34),
                FleetCompareMonthlyBucket(yearMonth: "2024-02", distanceM: 1_040_000, driveCount: 29),
                FleetCompareMonthlyBucket(yearMonth: "2024-03", distanceM: 1_360_000, driveCount: 41),
                FleetCompareMonthlyBucket(yearMonth: "2024-04", distanceM: 1_220_000, driveCount: 37)
            ]
        case 2:
            [
                FleetCompareMonthlyBucket(yearMonth: "2024-01", distanceM: 980_000, driveCount: 26),
                FleetCompareMonthlyBucket(yearMonth: "2024-02", distanceM: 1_120_000, driveCount: 31),
                FleetCompareMonthlyBucket(yearMonth: "2024-03", distanceM: 1_050_000, driveCount: 28),
                FleetCompareMonthlyBucket(yearMonth: "2024-04", distanceM: 1_300_000, driveCount: 39)
            ]
        default:
            [
                FleetCompareMonthlyBucket(yearMonth: "2024-02", distanceM: 1_510_000, driveCount: 45),
                FleetCompareMonthlyBucket(yearMonth: "2024-03", distanceM: 1_620_000, driveCount: 48),
                FleetCompareMonthlyBucket(yearMonth: "2024-04", distanceM: 1_440_000, driveCount: 43)
            ]
        }
    }
}

#if DEBUG
    /// Preview/test seam yielding a single vehicle — drives the single-vehicle empty state
    /// (web `vehicleList.length < 2`).
    public struct SingleVehicleFleetCompareDataSource: FleetCompareDataSource {
        public init() {}

        public func loadVehicles() async throws -> [FleetCompareVehicle] {
            [FleetCompareVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001", model: "Model 3")]
        }

        public func loadState(vehicleID _: Int64) async throws -> FleetCompareVehicleState? {
            nil
        }

        public func loadDrivingStats(vehicleID _: Int64) async throws -> FleetCompareDrivingStats? {
            nil
        }

        public func loadCostBreakdown(vehicleID _: Int64) async throws -> FleetCompareCostBreakdown? {
            nil
        }

        public func loadMonthlyMileage(vehicleID _: Int64) async throws -> [FleetCompareMonthlyBucket] {
            []
        }
    }

    /// Preview/test seam whose vehicle load fails — drives the error state (web `query.error`).
    public struct FailingFleetCompareDataSource: FleetCompareDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [FleetCompareVehicle] {
            throw Failure()
        }

        public func loadState(vehicleID _: Int64) async throws -> FleetCompareVehicleState? {
            nil
        }

        public func loadDrivingStats(vehicleID _: Int64) async throws -> FleetCompareDrivingStats? {
            nil
        }

        public func loadCostBreakdown(vehicleID _: Int64) async throws -> FleetCompareCostBreakdown? {
            nil
        }

        public func loadMonthlyMileage(vehicleID _: Int64) async throws -> [FleetCompareMonthlyBucket] {
            []
        }
    }
#endif
