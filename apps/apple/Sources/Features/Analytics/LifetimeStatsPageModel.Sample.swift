import Foundation

/// A representative local seed used as the `LifetimeStatsPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (a long-owned, heavily-driven vehicle) so the surface renders its
/// populated success state out of the box. Every measurement is SI (meters, m/s, watt-hours,
/// seconds), exactly as the production source will deliver it; the view converts at the render
/// boundary.
public struct SampleLifetimeStatsDataSource: LifetimeStatsDataSource {
    public init() {}

    public func loadVehicles() async throws -> [LifetimeStatsVehicle] {
        [
            LifetimeStatsVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            LifetimeStatsVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002")
        ]
    }

    public func loadStats(vehicleID _: Int64?) async throws -> LifetimeStats? {
        LifetimeStats(
            totalDrives: 1240,
            totalDistanceM: 42_000_000,
            totalDrivingSeconds: 4_249_800,
            avgEfficiencyWhKm: 162,
            totalChargeSessions: 380,
            totalEnergyWh: 7_980_000,
            totalChargingCost: 1120.50,
            gasEquivalentCost: 4860.00,
            totalSavings: 3739.50,
            co2OffsetKg: 3200,
            treesEquivalent: 145,
            earthCircumferences: 1.048,
            moonTrips: 0.1092,
            daysOnRoad: 49.2,
            homesEquivalentDays: 266.0,
            firstDriveDate: "2021-03-14",
            ownershipDays: 1554,
            mostActiveDayOfWeek: "Saturday",
            mostActiveHour: 17,
            longestDriveRecord: LifetimeRecord(valueSI: 612_000, date: "2022-07-09"),
            highestSpeedRecord: LifetimeRecord(valueSI: 41.7, date: "2023-01-22"),
            maxChargeRecord: LifetimeRecord(valueSI: 78500, date: "2022-11-30"),
            achievements: SampleLifetimeStatsDataSource.sampleAchievements
        )
    }

    static let sampleAchievements: [LifetimeAchievement] = [
        LifetimeAchievement(
            id: "first-drive", name: "First Drive", description: "Complete your first drive",
            icon: "🚗", unlocked: true, unlockedAt: "2021-03-14", progress: 1.0, target: 1, current: 1
        ),
        LifetimeAchievement(
            id: "thousand-club", name: "1,000 Drives", description: "Complete 1,000 drives",
            icon: "🎯", unlocked: true, unlockedAt: "2023-02-18", progress: 1.0, target: 1000, current: 1240
        ),
        LifetimeAchievement(
            id: "eco-warrior", name: "Eco Warrior", description: "Offset one tonne of CO₂",
            icon: "🌱", unlocked: true, unlockedAt: "2022-09-02", progress: 1.0, target: 1000, current: 3200
        ),
        LifetimeAchievement(
            id: "globetrotter", name: "Globetrotter", description: "Drive around the Earth",
            icon: "🌎", unlocked: true, unlockedAt: "2023-06-21", progress: 1.0, target: 40075, current: 42000
        ),
        LifetimeAchievement(
            id: "marathoner", name: "Marathoner", description: "Complete a single 700 km drive",
            icon: "🛣️", unlocked: false, unlockedAt: nil, progress: 0.87, target: 700, current: 612
        ),
        LifetimeAchievement(
            id: "speed-demon", name: "Speed Demon", description: "Reach 160 km/h",
            icon: "⚡", unlocked: false, unlockedAt: nil, progress: 0.92, target: 160, current: 150
        ),
        LifetimeAchievement(
            id: "power-user", name: "Power User", description: "Log 500 charge sessions",
            icon: "🔌", unlocked: false, unlockedAt: nil, progress: 0.76, target: 500, current: 380
        ),
        LifetimeAchievement(
            id: "moonshot", name: "Moonshot", description: "Drive the distance to the Moon",
            icon: "🌙", unlocked: false, unlockedAt: nil, progress: 0.11, target: 384_400, current: 42000
        )
    ]
}

#if DEBUG
    /// Preview/test seam yielding a populated vehicle list but a `nil` lifetime roll-up — drives the
    /// page's per-section empty states (web `stats` undefined → every `: <EmptyState>` branch, the
    /// savings `noSavingsData`, and the achievements `noAchievements`).
    public struct EmptyLifetimeStatsDataSource: LifetimeStatsDataSource {
        public init() {}

        public func loadVehicles() async throws -> [LifetimeStatsVehicle] {
            [LifetimeStatsVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadStats(vehicleID _: Int64?) async throws -> LifetimeStats? {
            nil
        }
    }

    /// Preview/test seam whose lifetime load fails — drives the error state (web `PageContainer
    /// error`).
    public struct FailingLifetimeStatsDataSource: LifetimeStatsDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [LifetimeStatsVehicle] {
            [LifetimeStatsVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadStats(vehicleID _: Int64?) async throws -> LifetimeStats? {
            throw Failure()
        }
    }
#endif
