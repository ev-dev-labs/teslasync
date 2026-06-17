import Foundation

/// A representative local seed used as the `DrivetrainHealthPage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (3 vehicles: a healthy one, a running-warm one, and one with no health
/// roll-up) so the surface renders its populated success state, the per-panel empties, AND the page-level
/// empty state out of the box. All measurements are SI canonical (°C, meters, m/s, watts, Wh, kg) except
/// the backend-derived motor power (kW) and torque (Nm); the view converts at the boundary.
public struct SampleDrivetrainHealthDataSource: DrivetrainHealthPageDataSource {
    private let now: Date

    public init(now: Date = Date()) {
        self.now = now
    }

    public func loadVehicles() async throws -> [DrivetrainVehicle] {
        [
            DrivetrainVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            DrivetrainVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002"),
            DrivetrainVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003")
        ]
    }

    public func useDrivetrainHealth(vehicleID: Int64) async throws -> DrivetrainHealthSummary? {
        switch vehicleID {
        case 1:
            return DrivetrainHealthSummary(
                frontMotorTempC: 62, rearMotorTempC: 57, inverterTempC: 71, batteryTempC: 34,
                motorStatus: "D", overallHealth: .good
            )
        case 2:
            // Front 105/150 and inverter 92/120 land in the warning band, exercising the alert banner +
            // the medium-tier recommendations.
            return DrivetrainHealthSummary(
                frontMotorTempC: 105, rearMotorTempC: 98, inverterTempC: 92, batteryTempC: 41,
                motorStatus: "D", overallHealth: .warning
            )
        default:
            // Vehicle 3 has no health roll-up — the page shows its `noData` empty state.
            return nil
        }
    }

    public func useDrivingStats(vehicleID: Int64) async throws -> DrivetrainDrivingStats? {
        switch vehicleID {
        case 1:
            return DrivetrainDrivingStats(
                totalDrives: 24, totalDistanceM: 612_000, avgSpeedMps: 12.4, topSpeedMps: 38.1,
                regenRatio: 0.19, regenEnergyWh: 42800, co2SavedKg: 318
            )
        case 2:
            return DrivetrainDrivingStats(
                totalDrives: 18, totalDistanceM: 388_000, avgSpeedMps: 9.7, topSpeedMps: 33.4,
                regenRatio: 0.14, regenEnergyWh: 23500, co2SavedKg: 201
            )
        default:
            return nil
        }
    }

    public func useDrives(vehicleID: Int64) async throws -> [DrivetrainDrive] {
        guard vehicleID == 1 || vehicleID == 2 else { return [] }
        let count = vehicleID == 2 ? 18 : 24
        return (0 ..< count).map { index in drive(vehicleID: vehicleID, index: index) }
    }

    public func useMotorLatest(vehicleID: Int64) async throws -> DrivetrainMotorSnapshot? {
        switch vehicleID {
        case 1:
            return DrivetrainMotorSnapshot(
                id: "latest-1", ts: now, shiftState: "D", source: "fleet-telemetry",
                powerKw: 45.2, regenKw: 12.1, motorRpmFront: 4210, motorRpmRear: 3980,
                torqueNmFront: 182, torqueNmRear: 168, motorTempCFront: 62, motorTempCRear: 57,
                inverterTempC: 71, batteryTempC: 34
            )
        case 2:
            return DrivetrainMotorSnapshot(
                id: "latest-2", ts: now, shiftState: "D", source: "fleet-telemetry",
                powerKw: 78.6, regenKw: 4.3, motorRpmFront: 6120, motorRpmRear: 5870,
                torqueNmFront: 240, torqueNmRear: 226, motorTempCFront: 105, motorTempCRear: 98,
                inverterTempC: 92, batteryTempC: 41
            )
        default:
            return nil
        }
    }

    public func useMotorHistory(vehicleID: Int64, limit: Int) async throws -> [DrivetrainMotorSnapshot] {
        guard vehicleID == 1 || vehicleID == 2 else { return [] }
        let warm = vehicleID == 2
        let count = min(limit, 48)
        return (0 ..< count).map { index in motorSample(vehicleID: vehicleID, index: index, count: count, warm: warm) }
    }

    public func useVehicleLive(vehicleID: Int64) async throws -> Double? {
        switch vehicleID {
        case 1: return 650
        case 2: return 180
        default: return nil
        }
    }

    // MARK: - Deterministic builders

    /// One drive `index` days back, varying power draw and outside temperature so the power-output and
    /// temperature-trend charts span a realistic range. Roughly every fifth drive omits the outside
    /// temperature so the trend filter (web `outsideTemp !== null`) is exercised.
    private func drive(vehicleID: Int64, index: Int) -> DrivetrainDrive {
        let secondsBack = Double(index) * 24 * 3600 + Double((index * 5) % 9) * 3600
        let start = now.addingTimeInterval(-secondsBack)
        let distanceKm = 9.0 + Double((index * 11) % 48)
        let avgPowerKw = 22.0 + Double((index * 13) % 68)
        let hasTemp = index % 5 != 0
        let outsideTempC = hasTemp ? -4.0 + Double((index * 7) % 40) : nil
        return DrivetrainDrive(
            id: Int64(vehicleID * 1000 + Int64(index)),
            vehicleID: vehicleID,
            startTs: start,
            distanceM: distanceKm * 1000,
            avgPowerW: avgPowerKw * 1000,
            outsideTempAvgC: outsideTempC
        )
    }

    /// One `/motor` history row `count - index` samples back. Temperatures oscillate around a baseline
    /// (warmer for the running-warm vehicle) so the multi-line stator chart and the torque area chart
    /// both render a legible trend.
    private func motorSample(vehicleID: Int64, index: Int, count: Int, warm: Bool) -> DrivetrainMotorSnapshot {
        let secondsBack = Double(count - index) * 90
        let ts = now.addingTimeInterval(-secondsBack)
        let phase = Double(index) / 6
        let base = warm ? 88.0 : 52.0
        let front = base + 9 * sin(phase)
        let rear = base - 3 + 8 * sin(phase + 0.6)
        let inverter = (warm ? 84.0 : 64.0) + 6 * sin(phase + 1.1)
        let torque = 120 + 70 * abs(sin(phase + 0.3))
        return DrivetrainMotorSnapshot(
            id: "motor-\(vehicleID)-\(index)",
            ts: ts,
            shiftState: "D",
            source: "fleet-telemetry",
            motorRpmFront: 3600 + 1800 * abs(sin(phase)),
            motorRpmRear: 3400 + 1700 * abs(sin(phase + 0.4)),
            torqueNmFront: torque,
            torqueNmRear: torque - 12,
            motorTempCFront: front,
            motorTempCRear: rear,
            inverterTempC: inverter,
            batteryTempC: warm ? 41 : 33
        )
    }
}

#if DEBUG
    /// Preview/test seam yielding a vehicle whose health roll-up is absent — drives the page-level
    /// `noData` empty state (web `health ? … : EmptyState`).
    public struct EmptyDrivetrainHealthDataSource: DrivetrainHealthPageDataSource {
        public init() {}

        public func loadVehicles() async throws -> [DrivetrainVehicle] {
            [DrivetrainVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func useDrivetrainHealth(vehicleID _: Int64) async throws -> DrivetrainHealthSummary? { nil }
        public func useDrivingStats(vehicleID _: Int64) async throws -> DrivetrainDrivingStats? { nil }
        public func useDrives(vehicleID _: Int64) async throws -> [DrivetrainDrive] { [] }
        public func useMotorLatest(vehicleID _: Int64) async throws -> DrivetrainMotorSnapshot? { nil }
        public func useMotorHistory(vehicleID _: Int64, limit _: Int) async throws -> [DrivetrainMotorSnapshot] { [] }
        public func useVehicleLive(vehicleID _: Int64) async throws -> Double? { nil }
    }

    /// Preview/test seam whose health load fails — drives the retryable error region (web hardcodes
    /// `error={null}`; the native surface offers a retry on a total health-load failure).
    public struct FailingDrivetrainHealthDataSource: DrivetrainHealthPageDataSource {
        public struct Failure: LocalizedError {
            public var errorDescription: String? { "Unable to load drivetrain health" }
        }

        public init() {}

        public func loadVehicles() async throws -> [DrivetrainVehicle] {
            [DrivetrainVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func useDrivetrainHealth(vehicleID _: Int64) async throws -> DrivetrainHealthSummary? {
            throw Failure()
        }

        public func useDrivingStats(vehicleID _: Int64) async throws -> DrivetrainDrivingStats? { nil }
        public func useDrives(vehicleID _: Int64) async throws -> [DrivetrainDrive] { [] }
        public func useMotorLatest(vehicleID _: Int64) async throws -> DrivetrainMotorSnapshot? { nil }
        public func useMotorHistory(vehicleID _: Int64, limit _: Int) async throws -> [DrivetrainMotorSnapshot] { [] }
        public func useVehicleLive(vehicleID _: Int64) async throws -> Double? { nil }
    }
#endif
