import Foundation

/// A representative local seed used as the `TripsReplayModel` / preview default until the
/// KMP-backed source is injected at composition time (ADR-004). It is an API-response-shaped
/// fixture (a ~24 min, ~18 km suburban drive, 78 → 64 %) so the replay surface renders its
/// populated success state out of the box. Every value is SI (m, m/s, W, °C); the view converts at
/// the render boundary.
public struct SampleTripsReplayDataSource: TripsReplayDataSource {
    private let base = Date(timeIntervalSince1970: 1_718_000_000)

    public init() {}

    public func loadDrive(driveID: Int64) async throws -> TripsReplayRecord {
        TripsReplayRecord(
            id: driveID,
            vehicleID: 1,
            startedAt: base,
            startAddress: "Mountain View, CA",
            endAddress: "Palo Alto, CA",
            distanceM: 18200,
            durationS: 24 * 60,
            startBatteryPct: 78,
            endBatteryPct: 64,
            avgSpeedMps: 12.6,
            maxSpeedMps: 29.1,
            positions: samplePositions()
        )
    }

    private func samplePositions() -> [TripsReplaySample] {
        Self.sampleRows.enumerated().map { index, row in
            TripsReplaySample(
                id: "sample-\(index)",
                timestamp: base.addingTimeInterval(row[0] * 60),
                latitude: 37.422 + row[0] * 0.0016,
                longitude: -122.084 - row[0] * 0.0021,
                speedMps: row[1],
                powerW: row[5] * 1000,
                batteryPct: row[2],
                elevationM: row[3],
                outsideTempC: row[4],
                ratedRangeM: row[6] * 1000
            )
        }
    }

    /// Compact display-shaped rows converted to SI in `samplePositions`. Columns:
    /// `[minute, speedMps, soc%, elevationM, outsideC, powerKw, ratedKm]`.
    private static let sampleRows: [[Double]] = [
        [0, 0, 78, 18, 16, 6, 305],
        [1, 8.2, 78, 21, 16, 14, 304],
        [2, 12.4, 77, 24, 16, 22, 301],
        [3, 16.1, 76, 28, 16.5, 27, 299],
        [4, 19.8, 75, 31, 16.5, 31, 296],
        [5, 22.4, 74, 37, 16.5, 34, 293],
        [6, 24.6, 73, 44, 17, 38, 291],
        [7, 27.0, 72, 51, 17, 42, 288],
        [8, 29.1, 71, 58, 17, 46, 285],
        [9, 27.8, 70, 55, 17, 12, 283],
        [10, 26.2, 70, 52, 17.5, -8, 281],
        [11, 24.0, 69, 49, 17.5, 18, 279],
        [12, 22.1, 68, 47, 17.5, 28, 277],
        [13, 19.6, 67, 43, 17.5, 22, 275],
        [14, 17.5, 67, 39, 18, 19, 273],
        [15, 18.9, 66, 36, 18, 21, 271],
        [16, 20.3, 66, 33, 18, 24, 269],
        [17, 17.2, 65, 30, 18, 9, 268],
        [18, 14.2, 65, 28, 18, -12, 266],
        [19, 11.8, 64, 26, 18.5, 7, 265],
        [20, 9.6, 64, 24, 18.5, 9, 263],
        [21, 7.8, 64, 22, 18.5, 6, 262],
        [22, 6.1, 64, 21, 18.5, 5, 261],
        [23, 3.0, 64, 20, 18.5, 2, 260],
        [24, 0, 64, 19, 18.5, 0, 259]
    ]
}

#if DEBUG
    /// Preview/test seam yielding a drive with no recorded coordinates — drives the web no-GPS
    /// empty state (the scrubber / stats / charts collapse to the `replay.noGps` empty message).
    public struct EmptyTripsReplayDataSource: TripsReplayDataSource {
        public init() {}

        public func loadDrive(driveID: Int64) async throws -> TripsReplayRecord {
            let base = Date(timeIntervalSince1970: 1_718_000_000)
            return TripsReplayRecord(
                id: driveID,
                vehicleID: 1,
                startedAt: base,
                startAddress: nil,
                endAddress: nil,
                distanceM: 0,
                durationS: 6 * 60,
                startBatteryPct: 55,
                endBatteryPct: 55,
                avgSpeedMps: nil,
                maxSpeedMps: nil,
                positions: []
            )
        }
    }

    /// Preview/test seam whose drive load fails — drives the retryable error state.
    public struct FailingTripsReplayDataSource: TripsReplayDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadDrive(driveID _: Int64) async throws -> TripsReplayRecord {
            throw Failure()
        }
    }
#endif
