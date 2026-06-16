import Foundation

/// A representative local seed used as the `EfficiencyPage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (3 vehicles, each with a month of drives spanning the full efficiency /
/// speed / temperature range, plus a backend driving roll-up) so the surface renders its populated
/// success state out of the box. All measurements are SI canonical (meters, seconds, m/s, Wh/km, °C,
/// Wh, kg); the view converts at the boundary. Drives are dated relative to `now` so they fall inside
/// the default 30-day window.
public struct SampleEfficiencyDataSource: EfficiencyDataSource {
    private let now: Date

    public init(now: Date = Date()) {
        self.now = now
    }

    public func loadVehicles() async throws -> [EfficiencyVehicle] {
        [
            EfficiencyVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            EfficiencyVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002"),
            EfficiencyVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003")
        ]
    }

    public func useDrivingStats(vehicleID: Int64) async throws -> EfficiencyStats? {
        switch vehicleID {
        case 1:
            EfficiencyStats(
                totalDrives: 24,
                totalDistanceM: 612_000,
                totalDurationS: 41400,
                avgEfficiencyWhPerKm: 162,
                avgSpeedMps: 12.4,
                topSpeedMps: 38.1,
                regenRatio: 0.19,
                regenEnergyWh: 42800,
                co2SavedKg: 318
            )
        case 2:
            EfficiencyStats(
                totalDrives: 18,
                totalDistanceM: 388_000,
                totalDurationS: 28800,
                avgEfficiencyWhPerKm: 198,
                avgSpeedMps: 9.7,
                topSpeedMps: 33.4,
                regenRatio: 0.14,
                regenEnergyWh: 23500,
                co2SavedKg: 201
            )
        default:
            // Vehicle 3 has no backend roll-up — the hero / stat cards / summary / insights render
            // their own empty states (web `stats ? content : EmptyState`).
            nil
        }
    }

    public func useDrives(vehicleID: Int64) async throws -> [EfficiencyDrive] {
        let count = vehicleID == 2 ? 18 : 24
        return (0 ..< count).map { index in drive(vehicleID: vehicleID, index: index) }
    }

    /// Builds one deterministic drive `index` days back, varying distance / battery-draw / speed /
    /// temperature so the scored set spans the full efficiency-tier, speed-range, and temperature-band
    /// spreads (exercising every chart + the histogram + the temperature table).
    private func drive(vehicleID: Int64, index: Int) -> EfficiencyDrive {
        let secondsBack = Double(index) * 24 * 3600 + Double((index * 7) % 11) * 3600
        let start = now.addingTimeInterval(-secondsBack)

        let distanceKm = 8.0 + Double((index * 13) % 55)
        let distanceM = distanceKm * 1000

        // Target Wh/km cycles 120…250 so the tiers (excellent…very-high) all appear.
        let targetWhPerKm = 120.0 + Double((index * 17) % 130)
        // getEfficiency inverse: battUsed = (Wh/km * km) / 750.
        let battUsed = targetWhPerKm * distanceKm / 750
        let startBattery = 90.0
        let endBattery = max(startBattery - battUsed, 5)

        let avgSpeedKmh = 15.0 + Double((index * 9) % 118)
        let avgSpeedMps = avgSpeedKmh / 3.6

        let outsideTempC = -5.0 + Double((index * 7) % 42)

        return EfficiencyDrive(
            id: Int64(vehicleID * 1000 + Int64(index)),
            vehicleID: vehicleID,
            startTs: start,
            distanceM: distanceM,
            avgSpeedMps: avgSpeedMps,
            startBatteryPct: startBattery,
            endBatteryPct: endBattery,
            outsideTempAvgC: outsideTempC
        )
    }
}

#if DEBUG
    /// Preview/test seam yielding a vehicle with no stats + no drives — drives every panel's empty
    /// state (web per-panel `EmptyState`: noStats / noStatCards / noSummary / noInsights / noTempData
    /// + the charts' not-enough-data overlays), without collapsing the layout.
    public struct EmptyEfficiencyDataSource: EfficiencyDataSource {
        public init() {}

        public func loadVehicles() async throws -> [EfficiencyVehicle] {
            [EfficiencyVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func useDrivingStats(vehicleID _: Int64) async throws -> EfficiencyStats? {
            nil
        }

        public func useDrives(vehicleID _: Int64) async throws -> [EfficiencyDrive] {
            []
        }
    }

    /// Preview/test seam whose stats + drives loads both fail — drives the total-failure error region
    /// (web hooks degrade to empties; the native surface offers a retry).
    public struct FailingEfficiencyDataSource: EfficiencyDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [EfficiencyVehicle] {
            [EfficiencyVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func useDrivingStats(vehicleID _: Int64) async throws -> EfficiencyStats? {
            throw Failure()
        }

        public func useDrives(vehicleID _: Int64) async throws -> [EfficiencyDrive] {
            throw Failure()
        }
    }
#endif
