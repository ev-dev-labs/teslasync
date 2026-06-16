import Foundation

/// A representative local seed used as the `DriveDetailPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (a ~24 min, ~18 km suburban drive, 78 → 64 %) so the surface
/// renders its populated success state out of the box. Every value is SI (m, m/s, Wh, W, °C,
/// kPa); the view converts at the render boundary.
public struct SampleDriveDetailDataSource: DriveDetailDataSource {
    private let base = Date(timeIntervalSince1970: 1_718_000_000)

    public init() {}

    public func loadDrive(driveID: Int64) async throws -> DriveDetailRecord {
        DriveDetailRecord(
            id: driveID,
            vehicleID: 1,
            startedAt: base,
            endedAt: base.addingTimeInterval(24 * 60),
            durationS: 24 * 60,
            distanceM: 18200,
            startAddress: "Mountain View, CA",
            endAddress: "Palo Alto, CA",
            startLat: 37.422,
            startLon: -122.084,
            endLat: 37.4602,
            endLon: -122.1338,
            startBatteryPct: 78,
            endBatteryPct: 64,
            energyUsedWh: 3240,
            regenEnergyWh: 410,
            avgSpeedMps: 12.6,
            maxSpeedMps: 29.1,
            avgPowerW: 18400,
            telemetry: sampleTelemetry(),
            positions: []
        )
    }

    private func sampleTelemetry() -> [DriveTelemetrySample] {
        Self.sampleRows.enumerated().map { index, row in
            DriveTelemetrySample(
                id: "sample-\(index)",
                createdAt: base.addingTimeInterval(row[0] * 60),
                latitude: 37.422 + row[0] * 0.0016,
                longitude: -122.084 - row[0] * 0.0021,
                speedMps: row[1],
                batteryPct: row[2],
                elevationM: row[3],
                powerW: row[4] * 1000,
                outsideTempC: row[5],
                insideTempC: row[6],
                driverTempC: 21,
                passengerTempC: 21.5,
                idealRangeM: row[7] * 1000,
                ratedRangeM: row[8] * 1000,
                estRangeM: row[8] * 1000,
                odometerM: row[9] * 1000,
                socPct: row[2],
                usableSocPct: max(row[2] - 2, 0),
                tireFlKpa: row[10],
                tireFrKpa: row[10] + 2,
                tireRlKpa: row[10] - 1,
                tireRrKpa: row[10] + 1,
                climateOn: true,
                fanStatus: row[11]
            )
        }
    }

    public func loadVehicle(vehicleID: Int64) async throws -> DriveDetailVehicle? {
        DriveDetailVehicle(id: vehicleID, displayName: "Rocinante")
    }

    public func loadWhyEnded(driveID _: Int64, window _: DriveDetailDiagnosticWindow) async throws -> DriveWhyEnded {
        let end = base.addingTimeInterval(24 * 60)
        return DriveWhyEnded(
            transitions: [
                DriveFsmTransition(
                    id: "t0", fsmName: "drive", fromState: "driving", toState: "parked",
                    trigger: "shift_to_park", timestamp: end
                ),
                DriveFsmTransition(
                    id: "t1", fsmName: "session", fromState: "active", toState: "closing",
                    trigger: "drive_ended", timestamp: end.addingTimeInterval(2)
                )
            ],
            signals: [
                DriveSignalRow(id: "s0", timestamp: end.addingTimeInterval(-3), field: "Gear", value: "D"),
                DriveSignalRow(
                    id: "s1",
                    timestamp: end.addingTimeInterval(-1),
                    field: "VehicleSpeed",
                    value: "0.4 m/s"
                ),
                DriveSignalRow(id: "s2", timestamp: end, field: "Gear", value: "P")
            ]
        )
    }

    /// Compact display-shaped rows converted to SI in `loadDrive`. Columns:
    /// `[minute, speedMps, soc%, elevationM, powerKw, outsideC, insideC, idealKm, ratedKm, odoKm, tireKpa, fan]`.
    private static let sampleRows: [[Double]] = [
        [0, 0, 78, 18, 6, 16, 20.5, 312, 305, 41200.0, 289, 2],
        [2, 12.4, 77, 24, 22, 16, 21, 308, 301, 41201.6, 290, 3],
        [4, 19.8, 75, 31, 31, 16.5, 21, 303, 296, 41204.0, 290, 3],
        [6, 24.6, 73, 44, 38, 16.5, 21, 298, 291, 41207.1, 291, 4],
        [8, 29.1, 71, 58, 46, 17, 21.5, 292, 285, 41210.9, 291, 4],
        [10, 26.2, 70, 52, -8, 17, 21.5, 288, 281, 41214.0, 291, 3],
        [12, 22.1, 68, 47, 28, 17.5, 21.5, 284, 277, 41216.8, 290, 3],
        [14, 17.5, 67, 39, 19, 17.5, 22, 280, 273, 41219.1, 290, 3],
        [16, 20.3, 66, 33, 24, 18, 22, 276, 269, 41221.6, 290, 3],
        [18, 14.2, 65, 28, -12, 18, 22, 273, 266, 41223.9, 289, 2],
        [20, 9.6, 64, 24, 9, 18.5, 22, 270, 263, 41225.7, 289, 2],
        [22, 6.1, 64, 21, 5, 18.5, 22, 268, 261, 41227.0, 289, 2],
        [24, 0, 64, 19, 0, 18.5, 22, 266, 259, 41227.8, 289, 1]
    ]
}

#if DEBUG
    /// Preview/test seam yielding a drive with zeroed aggregates and no samples — drives the
    /// web "no telemetry recorded" envelope (banner replaces the four numeric panels) while the
    /// header, timeline, journey, and why-ended sections still render.
    public struct NoTelemetryDriveDetailDataSource: DriveDetailDataSource {
        public init() {}

        public func loadDrive(driveID: Int64) async throws -> DriveDetailRecord {
            let base = Date(timeIntervalSince1970: 1_718_000_000)
            return DriveDetailRecord(
                id: driveID,
                vehicleID: 1,
                startedAt: base,
                endedAt: base.addingTimeInterval(6 * 60),
                durationS: 6 * 60,
                distanceM: 0,
                startAddress: nil,
                endAddress: nil,
                startLat: nil,
                startLon: nil,
                endLat: nil,
                endLon: nil,
                startBatteryPct: 55,
                endBatteryPct: 55,
                energyUsedWh: nil,
                regenEnergyWh: nil,
                avgSpeedMps: nil,
                maxSpeedMps: nil,
                avgPowerW: nil,
                telemetry: [],
                positions: []
            )
        }

        public func loadVehicle(vehicleID: Int64) async throws -> DriveDetailVehicle? {
            DriveDetailVehicle(id: vehicleID, displayName: "Rocinante")
        }

        public func loadWhyEnded(
            driveID _: Int64,
            window _: DriveDetailDiagnosticWindow
        ) async throws -> DriveWhyEnded {
            DriveWhyEnded(transitions: [], signals: [])
        }
    }

    /// Preview/test seam whose drive load fails — drives the retryable error state.
    public struct FailingDriveDetailDataSource: DriveDetailDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadDrive(driveID _: Int64) async throws -> DriveDetailRecord {
            throw Failure()
        }

        public func loadVehicle(vehicleID _: Int64) async throws -> DriveDetailVehicle? {
            nil
        }

        public func loadWhyEnded(
            driveID _: Int64,
            window _: DriveDetailDiagnosticWindow
        ) async throws -> DriveWhyEnded {
            throw Failure()
        }
    }
#endif
