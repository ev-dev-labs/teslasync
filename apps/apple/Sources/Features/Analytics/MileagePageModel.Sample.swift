import Foundation

/// A representative local seed used as the `MileagePage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (3 vehicles, each with lifetime/30-day mileage stats, ~90 daily
/// buckets carrying a rising odometer, and a monthly roll-up) so the surface renders its populated
/// success state out of the box (mirroring the sibling page's sample source). All measurements are
/// SI canonical (meters); the view converts at the boundary.
public struct SampleMileageDataSource: MileageDataSource {
    public init() {}

    public func loadVehicles() async throws -> [MileagePageVehicle] {
        [
            MileagePageVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            MileagePageVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002"),
            MileagePageVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003")
        ]
    }

    public func loadMileageStats(vehicleID: Int64) async throws -> MileageStats? {
        switch vehicleID {
        case 1:
            MileageStats(lifetimeDistanceM: 42_000_000, last30dDistanceM: 1_220_000, driveCountLifetime: 1240)
        case 2:
            MileageStats(lifetimeDistanceM: 38_000_000, last30dDistanceM: 1_040_000, driveCountLifetime: 980)
        default:
            MileageStats(lifetimeDistanceM: 51_500_000, last30dDistanceM: 1_510_000, driveCountLifetime: 1530)
        }
    }

    public func loadDailyMileage(vehicleID: Int64, days: Int) async throws -> [MileageDailyPoint] {
        SampleMileageDataSource.dailyPoints(vehicleID: vehicleID, days: days)
    }

    public func loadMonthlyMileage(vehicleID: Int64) async throws -> [MileageMonthPoint] {
        switch vehicleID {
        case 1:
            [
                MileageMonthPoint(yearMonth: "2026-03", totalDistanceM: 1_180_000, driveCount: 41),
                MileageMonthPoint(yearMonth: "2026-04", totalDistanceM: 1_340_000, driveCount: 47),
                MileageMonthPoint(yearMonth: "2026-05", totalDistanceM: 1_260_000, driveCount: 44),
                MileageMonthPoint(yearMonth: "2026-06", totalDistanceM: 1_220_000, driveCount: 39)
            ]
        case 2:
            [
                MileageMonthPoint(yearMonth: "2026-04", totalDistanceM: 980_000, driveCount: 33),
                MileageMonthPoint(yearMonth: "2026-05", totalDistanceM: 1_120_000, driveCount: 38),
                MileageMonthPoint(yearMonth: "2026-06", totalDistanceM: 1_040_000, driveCount: 35)
            ]
        default:
            [
                MileageMonthPoint(yearMonth: "2026-02", totalDistanceM: 1_410_000, driveCount: 49),
                MileageMonthPoint(yearMonth: "2026-03", totalDistanceM: 1_560_000, driveCount: 53),
                MileageMonthPoint(yearMonth: "2026-04", totalDistanceM: 1_480_000, driveCount: 51),
                MileageMonthPoint(yearMonth: "2026-05", totalDistanceM: 1_620_000, driveCount: 55),
                MileageMonthPoint(yearMonth: "2026-06", totalDistanceM: 1_510_000, driveCount: 48)
            ]
        }
    }

    /// Builds a deterministic descending-from-today run of daily buckets with a monotonically rising
    /// odometer, so both the odometer area chart and the daily-distance bar chart render populated.
    static func dailyPoints(vehicleID: Int64, days: Int) -> [MileageDailyPoint] {
        let count = max(0, min(days, 120))
        guard count > 0 else { return [] }
        let calendar = Calendar(identifier: .gregorian)
        let today = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_780_000_000))
        let baseOdometer = 42_000_000.0 + Double(vehicleID) * 1_000_000
        let dailyBase = 38000.0 + Double(vehicleID) * 4000
        var odometer = baseOdometer
        var points: [MileageDailyPoint] = []
        points.reserveCapacity(count)
        for offset in stride(from: count - 1, through: 0, by: -1) {
            guard let date = calendar.date(byAdding: .day, value: -offset, to: today) else { continue }
            // A smooth pseudo-random daily distance (deterministic) plus a weekly rest day.
            let wave = sin(Double(offset) * 0.7) * 12000
            let isRestDay = offset % 7 == 0
            let distance = isRestDay ? 0 : max(2000, dailyBase + wave)
            odometer += distance
            points.append(
                MileageDailyPoint(date: date, totalDistanceM: distance, endOdometerM: odometer)
            )
        }
        return points
    }
}

#if DEBUG
    /// Preview/test seam yielding a single vehicle with no stats and no buckets — drives the page's
    /// no-data empty (web `!stats`) and every section's own empty state (odometer / daily / monthly).
    public struct EmptyMileageDataSource: MileageDataSource {
        public init() {}

        public func loadVehicles() async throws -> [MileagePageVehicle] {
            [MileagePageVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadMileageStats(vehicleID _: Int64) async throws -> MileageStats? {
            nil
        }

        public func loadDailyMileage(vehicleID _: Int64, days _: Int) async throws -> [MileageDailyPoint] {
            []
        }

        public func loadMonthlyMileage(vehicleID _: Int64) async throws -> [MileageMonthPoint] {
            []
        }
    }

    /// Preview/test seam whose primary stats load fails — drives the error state (web
    /// `statsQuery.error` / `PageContainer` error region with Retry).
    public struct FailingMileageDataSource: MileageDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [MileagePageVehicle] {
            [MileagePageVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadMileageStats(vehicleID _: Int64) async throws -> MileageStats? {
            throw Failure()
        }

        public func loadDailyMileage(vehicleID _: Int64, days _: Int) async throws -> [MileageDailyPoint] {
            []
        }

        public func loadMonthlyMileage(vehicleID _: Int64) async throws -> [MileageMonthPoint] {
            []
        }
    }

    /// Preview/test seam whose secondary (daily + monthly) loads fail while stats succeed — drives
    /// the web `anyError` `AlertBanner` over still-rendered content.
    public struct SecondaryFailingMileageDataSource: MileageDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [MileagePageVehicle] {
            [MileagePageVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadMileageStats(vehicleID _: Int64) async throws -> MileageStats? {
            MileageStats(lifetimeDistanceM: 42_000_000, last30dDistanceM: 1_220_000, driveCountLifetime: 1240)
        }

        public func loadDailyMileage(vehicleID _: Int64, days _: Int) async throws -> [MileageDailyPoint] {
            throw Failure()
        }

        public func loadMonthlyMileage(vehicleID _: Int64) async throws -> [MileageMonthPoint] {
            throw Failure()
        }
    }
#endif
