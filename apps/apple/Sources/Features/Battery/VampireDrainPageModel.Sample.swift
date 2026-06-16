import Foundation

/// A representative local seed used as the `VampireDrainPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it is
/// an API-response-shaped fixture (a moderate phantom-drain profile with six recent sessions
/// spanning Sentry on/off and a seven-day daily series) so the surface renders its populated
/// success state out of the box. Percents are raw, rates are %/hr, hours are hours, energy is
/// kWh; the view formats at the render boundary.
public struct SampleVampireDrainDataSource: VampireDrainDataSource {
    public init() {}

    public func loadVehicles() async throws -> [BatteryVehicle] {
        [
            BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            BatteryVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002")
        ]
    }

    public func loadStats(vehicleID _: Int64) async throws -> VampireDrainData? {
        VampireDrainData(
            avgDrainRate: 0.62,
            totalEnergyLost: 8.4,
            worstDrainPct: 6.4,
            drainScore: 73,
            entries: SampleVampireDrainDataSource.sampleSessions(),
            daily: SampleVampireDrainDataSource.sampleDaily()
        )
    }

    /// Six recent drain sessions spanning Sentry on/off and light/heavy losses.
    static func sampleSessions() -> [VampireDrainSession] {
        let rows: [SessionSample] = [
            SessionSample(id: 1, date: "2025-08-12T22:14:00Z", dur: 9.5, start: 82, end: 76.2, rate: 0.61, on: true),
            SessionSample(id: 2, date: "2025-08-11T23:02:00Z", dur: 8.1, start: 70, end: 68.8, rate: 0.15, on: false),
            SessionSample(id: 3, date: "2025-08-10T21:48:00Z", dur: 10.2, start: 90, end: 83.6, rate: 0.63, on: true),
            SessionSample(id: 4, date: "2025-08-09T22:36:00Z", dur: 7.4, start: 64, end: 63.1, rate: 0.12, on: false),
            SessionSample(id: 5, date: "2025-08-08T23:20:00Z", dur: 9.0, start: 55, end: 53.5, rate: 0.17, on: false),
            SessionSample(id: 6, date: "2025-08-07T22:05:00Z", dur: 8.8, start: 88, end: 83.2, rate: 0.55, on: true)
        ]
        return rows.map { row in
            let drain = row.start - row.end
            return VampireDrainSession(
                id: row.id,
                date: row.date,
                startBattery: row.start,
                endBattery: row.end,
                drainPct: drain,
                drainRatePctHr: row.rate,
                durationHours: row.dur,
                energyLostKwh: drain * 0.75,
                sentryActive: row.on
            )
        }
    }

    /// Seven days of parked-drain buckets for the daily bar chart.
    static func sampleDaily() -> [VampireDrainDay] {
        [
            VampireDrainDay(date: "2025-08-07", drainPct: 4.8, hoursParked: 8.8),
            VampireDrainDay(date: "2025-08-08", drainPct: 1.5, hoursParked: 9.0),
            VampireDrainDay(date: "2025-08-09", drainPct: 0.9, hoursParked: 7.4),
            VampireDrainDay(date: "2025-08-10", drainPct: 6.4, hoursParked: 10.2),
            VampireDrainDay(date: "2025-08-11", drainPct: 1.2, hoursParked: 8.1),
            VampireDrainDay(date: "2025-08-12", drainPct: 5.8, hoursParked: 9.5),
            VampireDrainDay(date: "2025-08-13", drainPct: 2.1, hoursParked: 8.6)
        ]
    }

    /// One seeded session row (a named shape, not a wide tuple).
    private struct SessionSample {
        let id: Int64
        let date: String
        let dur: Double
        let start: Double
        let end: Double
        let rate: Double
        let on: Bool
    }
}

#if DEBUG
    /// Preview/test seam yielding a vehicle whose drain snapshot is nil — drives the page's
    /// no-data empty state (web `!data`).
    public struct EmptyVampireDrainDataSource: VampireDrainDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadStats(vehicleID _: Int64) async throws -> VampireDrainData? {
            nil
        }
    }

    /// Preview/test seam yielding a snapshot whose collections are empty — drives every
    /// per-section empty state (trend line, daily bars, sessions table) while the page is
    /// `.ready`.
    public struct EmptySectionsVampireDrainDataSource: VampireDrainDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadStats(vehicleID _: Int64) async throws -> VampireDrainData? {
            VampireDrainData(
                avgDrainRate: 0,
                totalEnergyLost: 0,
                worstDrainPct: 0,
                drainScore: 0,
                entries: [],
                daily: []
            )
        }
    }

    /// Preview/test seam whose stats load fails — drives the error state (web
    /// `PageContainer error`).
    public struct FailingVampireDrainDataSource: VampireDrainDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadStats(vehicleID _: Int64) async throws -> VampireDrainData? {
            throw Failure()
        }
    }
#endif
