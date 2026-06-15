import Foundation

/// A representative local seed used as the `DriveScorePage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (3 vehicles, each with a backend score plus a month of drives spanning
/// the full grade range) so the surface renders its populated success state out of the box. All
/// measurements are SI canonical (meters, seconds, m/s, watt-hours, watts); the view converts at the
/// boundary. Drives are dated relative to `now` so they fall inside the default 30-day window.
public struct SampleDriveScoreDataSource: DriveScoreDataSource {
    private let now: Date

    public init(now: Date = Date()) {
        self.now = now
    }

    public func loadVehicles() async throws -> [DriveScoreVehicle] {
        [
            DriveScoreVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            DriveScoreVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002"),
            DriveScoreVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003")
        ]
    }

    public func useDriveScore(vehicleID: Int64) async throws -> DriveScoreSummary? {
        switch vehicleID {
        case 1:
            DriveScoreSummary(
                overall: 87,
                efficiency: 36,
                smoothness: 26,
                speedDiscipline: 25,
                grade: "A",
                totalDrives: 24,
                trend: .up
            )
        case 2:
            DriveScoreSummary(
                overall: 73,
                efficiency: 30,
                smoothness: 22,
                speedDiscipline: 21,
                grade: "B",
                totalDrives: 18,
                trend: .down
            )
        default:
            // Vehicle 3 has no backend score — the page falls back to the locally-averaged scores
            // (web `apiScore?.x ?? avgScores.x`).
            nil
        }
    }

    public func useDrives(vehicleID: Int64) async throws -> [DriveScoreDrive] {
        let count = vehicleID == 2 ? 18 : 24
        return (0 ..< count).map { index in drive(vehicleID: vehicleID, index: index) }
    }

    /// Builds one deterministic drive `index` days back, varying distance / energy / power / speed so
    /// the scored set spans the full A+…F grade range (exercising every chart + the histogram).
    private func drive(vehicleID: Int64, index: Int) -> DriveScoreDrive {
        let secondsBack = Double(index) * 28 * 3600 + Double((index * 7) % 11) * 3600
        let start = now.addingTimeInterval(-secondsBack)
        let distanceKm = 6.0 + Double((index * 13) % 55)
        let distanceM = distanceKm * 1000

        // Cycle the efficiency / power / speed inputs so a predictable spread of grades emerges.
        let whPerKm = 120.0 + Double((index * 17) % 130)
        let energyWh = whPerKm * distanceKm
        let avgPowerW = 8000.0 + Double((index * 23) % 40) * 1000
        let maxSpeedMps = 24.0 + Double((index * 5) % 22)
        let avgSpeedMps = maxSpeedMps * 0.7
        let durationS = distanceM / max(avgSpeedMps, 1)
        let startBattery = 82.0 - Double(index % 9)

        return DriveScoreDrive(
            id: Int64(vehicleID * 1000 + Int64(index)),
            vehicleID: vehicleID,
            startTs: start,
            endTs: start.addingTimeInterval(durationS),
            distanceM: distanceM,
            durationS: durationS,
            maxSpeedMps: maxSpeedMps,
            avgSpeedMps: avgSpeedMps,
            startBatteryPct: startBattery,
            endBatteryPct: startBattery - (energyWh / 75000 * 100),
            startAddress: SampleDriveScoreDataSource.addresses[index % SampleDriveScoreDataSource.addresses.count],
            endAddress: SampleDriveScoreDataSource.addresses[(index + 3) % SampleDriveScoreDataSource.addresses.count],
            outsideTempAvgC: 12 + Double(index % 14),
            avgPowerW: avgPowerW,
            energyUsedWh: energyWh
        )
    }

    private static let addresses = [
        "Market St, San Francisco",
        "Embarcadero, San Francisco",
        "Bay Bridge, Oakland",
        "Sand Hill Rd, Menlo Park",
        "Page Mill Rd, Palo Alto",
        "Shoreline Blvd, Mountain View"
    ]
}

#if DEBUG
    /// Preview/test seam yielding a vehicle with no drives — drives the page's empty state (web
    /// `scoredDrives.length === 0`: the "No Scored Drives" + "No data available" empties).
    public struct EmptyDriveScoreDataSource: DriveScoreDataSource {
        public init() {}

        public func loadVehicles() async throws -> [DriveScoreVehicle] {
            [DriveScoreVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func useDriveScore(vehicleID _: Int64) async throws -> DriveScoreSummary? {
            nil
        }

        public func useDrives(vehicleID _: Int64) async throws -> [DriveScoreDrive] {
            []
        }
    }

    /// Preview/test seam whose drives load fails — drives the error state (web `useDrives.error` →
    /// `PageContainer error`).
    public struct FailingDriveScoreDataSource: DriveScoreDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [DriveScoreVehicle] {
            [DriveScoreVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func useDriveScore(vehicleID _: Int64) async throws -> DriveScoreSummary? {
            nil
        }

        public func useDrives(vehicleID _: Int64) async throws -> [DriveScoreDrive] {
            throw Failure()
        }
    }
#endif
