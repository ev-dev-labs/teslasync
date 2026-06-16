import Foundation

/// A representative local seed used as the `ChargingDetailPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it
/// is an API-response-shaped fixture (a completed DC Supercharger session, 18 → 82 % over
/// ~32 min) so the surface renders its populated success state out of the box. Every value
/// is SI (Wh, W, m, °C, V, A); the view converts at the render boundary.
public struct SampleChargingDetailDataSource: ChargingDetailDataSource {
    private let base = Date(timeIntervalSince1970: 1_718_000_000)

    public init() {}

    public func loadSession(sessionID: Int64) async throws -> ChargingSessionDetail {
        ChargingSessionDetail(
            id: sessionID,
            vehicleID: 1,
            startedAt: base,
            endedAt: base.addingTimeInterval(32 * 60),
            startSocPct: 18,
            endSocPct: 82,
            totalEnergyAddedWh: 38_400,
            peakPowerW: 152_000,
            avgPowerW: 72_000,
            chargerType: "Tesla",
            startPlace: "Mountain View Supercharger",
            costDecimal: 12.42,
            costCurrency: "USD",
            endedStatus: "Complete",
            odometerStartM: 12_400_000,
            odometerEndM: 12_610_000
        )
    }

    public func loadTelemetry(sessionID _: Int64) async throws -> [ChargeTelemetryReading] {
        Self.curveRows.enumerated().map { index, row in
            ChargeTelemetryReading(
                id: "sample-\(index)",
                createdAt: base.addingTimeInterval(row[0] * 60),
                batteryLevelPct: row[1],
                powerW: row[2] * 1000,
                energyAddedWh: row[3] * 1000,
                ratedRangeM: row[4] * 1000,
                batteryTempC: row[5],
                insideTempC: 21.5,
                outsideTempC: row[6],
                voltageV: row[7],
                currentA: row[8]
            )
        }
    }

    public func loadVehicle(vehicleID: Int64) async throws -> ChargingDetailVehicle? {
        ChargingDetailVehicle(id: vehicleID, displayName: "Rocinante")
    }

    public func loadLatestTelemetry(vehicleID _: Int64) async throws -> ChargingTelemetryLatest? {
        ChargingTelemetryLatest(
            chargingState: "Complete",
            chargerVoltageV: 402,
            chargerActualCurrentA: 8,
            chargerPilotCurrentA: 32,
            chargerPowerW: 3_200,
            chargerPhases: 1,
            batteryRangeM: 402_000,
            rangeAddedMetersPerHour: 290_000,
            chargeEnergyAddedWh: 38_400
        )
    }

    /// One taper-shaped DC charge curve as compact display-unit rows, converted to SI in
    /// `loadTelemetry`. Columns:
    /// `[minute, soc%, powerKw, energyKwh, rangeKm, batteryTempC, outsideTempC, voltageV, currentA]`.
    private static let curveRows: [[Double]] = [
        [0, 18, 148, 0, 92, 24, 19, 388, 381],
        [3, 27, 152, 6.1, 118, 26, 19, 392, 388],
        [7, 38, 150, 12.7, 150, 28, 20, 396, 379],
        [11, 49, 138, 18.9, 182, 30, 20, 399, 346],
        [15, 58, 119, 24.1, 208, 31, 21, 401, 297],
        [19, 66, 96, 28.4, 232, 32, 21, 403, 238],
        [23, 73, 71, 32.0, 252, 33, 22, 404, 176],
        [27, 78, 48, 35.1, 268, 33, 22, 405, 119],
        [32, 82, 31, 38.4, 282, 34, 22, 406, 76]
    ]
}

#if DEBUG
    /// Preview/test seam yielding a session with no telemetry and no live data — drives the
    /// charts' empty states (web `chargeCurve`/time-series empty) and the advanced panel's
    /// no-live-data state, while the always-rendered stat panels still show the session.
    public struct EmptyChargingDetailDataSource: ChargingDetailDataSource {
        public init() {}

        public func loadSession(sessionID: Int64) async throws -> ChargingSessionDetail {
            ChargingSessionDetail(
                id: sessionID,
                vehicleID: 1,
                startedAt: Date(timeIntervalSince1970: 1_718_000_000),
                endedAt: Date(timeIntervalSince1970: 1_718_000_000 + 1_200),
                startSocPct: 44,
                endSocPct: 61,
                totalEnergyAddedWh: 9_800,
                peakPowerW: 11_000,
                avgPowerW: 7_400,
                chargerType: nil,
                startPlace: nil,
                costDecimal: nil,
                costCurrency: nil,
                endedStatus: "Complete",
                odometerStartM: nil,
                odometerEndM: nil
            )
        }

        public func loadTelemetry(sessionID _: Int64) async throws -> [ChargeTelemetryReading] { [] }
        public func loadVehicle(vehicleID _: Int64) async throws -> ChargingDetailVehicle? { nil }
        public func loadLatestTelemetry(vehicleID _: Int64) async throws -> ChargingTelemetryLatest? { nil }
    }

    /// Preview/test seam whose session load fails — drives the retryable error state.
    public struct FailingChargingDetailDataSource: ChargingDetailDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadSession(sessionID _: Int64) async throws -> ChargingSessionDetail {
            throw Failure()
        }

        public func loadTelemetry(sessionID _: Int64) async throws -> [ChargeTelemetryReading] { [] }
        public func loadVehicle(vehicleID _: Int64) async throws -> ChargingDetailVehicle? { nil }
        public func loadLatestTelemetry(vehicleID _: Int64) async throws -> ChargingTelemetryLatest? { nil }
    }
#endif
