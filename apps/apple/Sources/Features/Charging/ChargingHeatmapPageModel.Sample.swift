import Foundation

/// A representative local seed used as the `ChargingHeatmapPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (twelve charging sessions across several weeks, places, and
/// hours, with a clear nightly Home cluster so the heatmap, favorite panel, and top-locations
/// chart all render their populated success state out of the box). Energy is watt-hours and
/// cost is a plain decimal, exactly as the wire serves them; the view converts to kWh /
/// minutes at the render boundary.
public struct SampleChargingHeatmapDataSource: ChargingHeatmapDataSource {
    public init() {}

    public func loadVehicles() async throws -> [ChargingHeatmapVehicle] {
        [
            ChargingHeatmapVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            ChargingHeatmapVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002")
        ]
    }

    public func loadSessions(vehicleID _: Int64, range: ChargingHeatmapRange) async throws -> [ChargingHeatmapSession] {
        // Mirrors the web query's server-side start/end window (applied client-side over the
        // fixture); the page's default `.all` admits every session.
        Self.sampleSessions().filter { range.contains($0.startedAt) }
    }

    /// Twelve sessions: a four-deep Home cluster 7 days apart at ~22:00 (the favorite bucket),
    /// plus Work / Supercharger / Downtown sessions spanning mornings, afternoons, and nights so
    /// every section populates. Home (6) > Work (3) > Supercharger (2) drive the locations chart;
    /// Downtown (1) is below the web ≥2 threshold and only shows in the grid + totals.
    static func sampleSessions() -> [ChargingHeatmapSession] {
        let rows: [SessionSample] = [
            SessionSample(id: 1, at: "2026-05-20T22:15:00Z", end: "2026-05-21T02:05:00Z",
                          wh: 41_000, cost: 4.92, place: "Home"),
            SessionSample(id: 2, at: "2026-05-27T22:05:00Z", end: "2026-05-28T01:40:00Z",
                          wh: 38_500, cost: 4.62, place: "Home"),
            SessionSample(id: 3, at: "2026-06-03T22:30:00Z", end: "2026-06-04T02:10:00Z",
                          wh: 40_200, cost: 4.82, place: "Home"),
            SessionSample(id: 4, at: "2026-06-10T22:20:00Z", end: "2026-06-11T01:55:00Z",
                          wh: 39_400, cost: 4.73, place: "Home"),
            SessionSample(id: 5, at: "2026-06-07T11:15:00Z", end: "2026-06-07T14:35:00Z",
                          wh: 36_800, cost: 4.42, place: "Home"),
            SessionSample(id: 6, at: "2026-06-13T02:30:00Z", end: "2026-06-13T05:50:00Z",
                          wh: 37_100, cost: 4.45, place: "Home"),
            SessionSample(id: 7, at: "2026-06-08T09:10:00Z", end: "2026-06-08T11:05:00Z",
                          wh: 21_300, cost: 6.39, place: "Work"),
            SessionSample(id: 8, at: "2026-06-09T08:45:00Z", end: "2026-06-09T10:30:00Z",
                          wh: 19_800, cost: 5.94, place: "Work"),
            SessionSample(id: 9, at: "2026-06-11T17:30:00Z", end: "2026-06-11T19:10:00Z",
                          wh: 22_400, cost: 6.72, place: "Work"),
            SessionSample(id: 10, at: "2026-06-05T13:20:00Z", end: "2026-06-05T13:52:00Z",
                          wh: 31_500, cost: 15.75, place: "Supercharger - Fremont"),
            SessionSample(id: 11, at: "2026-06-12T14:05:00Z", end: "2026-06-12T14:41:00Z",
                          wh: 33_200, cost: 16.60, place: "Supercharger - Fremont"),
            SessionSample(id: 12, at: "2026-06-06T19:40:00Z", end: "2026-06-06T21:25:00Z",
                          wh: 28_600, cost: 9.15, place: "Downtown Garage")
        ]
        return rows.map {
            ChargingHeatmapSession(
                id: $0.id,
                startedAt: $0.at,
                endedAt: $0.end,
                totalEnergyAddedWh: $0.wh,
                costDecimal: $0.cost,
                startPlace: $0.place
            )
        }
    }

    /// One seeded session row (a named shape, not a wide tuple).
    private struct SessionSample {
        let id: Int64
        let at: String
        let end: String
        let wh: Double
        let cost: Double
        let place: String
    }
}

#if DEBUG
    /// Preview/test seam yielding a vehicle with no sessions — drives every section's empty
    /// state (web `!sessions?.length`): zeroed stat cards, the favorite empty, the all-zero
    /// heatmap, and the locations no-data empty.
    public struct EmptyChargingHeatmapDataSource: ChargingHeatmapDataSource {
        public init() {}

        public func loadVehicles() async throws -> [ChargingHeatmapVehicle] {
            [ChargingHeatmapVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadSessions(
            vehicleID _: Int64,
            range _: ChargingHeatmapRange
        ) async throws -> [ChargingHeatmapSession] {
            []
        }
    }

    /// Preview/test seam whose sessions load fails — drives the error state (web `PageContainer
    /// error`).
    public struct FailingChargingHeatmapDataSource: ChargingHeatmapDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [ChargingHeatmapVehicle] {
            [ChargingHeatmapVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadSessions(
            vehicleID _: Int64,
            range _: ChargingHeatmapRange
        ) async throws -> [ChargingHeatmapSession] {
            throw Failure()
        }
    }
#endif
