import Foundation

/// A representative local seed used as the `EnergyPage` / preview default until the
/// KMP-backed source is injected at composition time. It is NOT production telemetry — it is
/// an API-response-shaped fixture (a healthy 30-day window with a ten-day energy breakdown and
/// eight charging sessions spanning every time-of-day bucket and charger category) so the
/// surface renders its populated success state out of the box. Energy is watt-hours, distance
/// is metres, efficiency is watt-hours per metre; the view converts at the render boundary.
public struct SampleEnergyDataSource: EnergyDataSource {
    public init() {}

    public func loadVehicles() async throws -> [BatteryVehicle] {
        [
            BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            BatteryVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002")
        ]
    }

    public func loadStats(vehicleID _: Int64) async throws -> EnergyStats? {
        EnergyStats(
            totalEnergyUsedWh: 298_400,
            totalWh: 298_400,
            avgEfficiencyWhPerM: 0.178,
            totalDistanceM: 1_676_000,
            totalCost: 76.34,
            co2SavedKg: 125.3,
            dailyBreakdown: SampleEnergyDataSource.sampleBreakdown()
        )
    }

    public func loadSessions(vehicleID _: Int64) async throws -> [EnergyChargingSession] {
        SampleEnergyDataSource.sampleSessions()
    }

    public func loadTelemetry(vehicleID _: Int64) async throws -> EnergyLiveCharging? {
        EnergyLiveCharging(lifetimeEnergyUsed: 18_452.3)
    }

    /// Ten daily breakdown points (energy added, distance, and Wh/m efficiency).
    static func sampleBreakdown() -> [EnergyUsagePoint] {
        let rows: [BreakdownSample] = [
            BreakdownSample(date: "2026-05-15", energy: 32_400, distance: 182_000, eff: 0.178),
            BreakdownSample(date: "2026-05-16", energy: 28_900, distance: 164_000, eff: 0.176),
            BreakdownSample(date: "2026-05-17", energy: 41_200, distance: 226_000, eff: 0.182),
            BreakdownSample(date: "2026-05-18", energy: 18_600, distance: 108_000, eff: 0.172),
            BreakdownSample(date: "2026-05-19", energy: 36_800, distance: 201_000, eff: 0.183),
            BreakdownSample(date: "2026-05-20", energy: 24_100, distance: 142_000, eff: 0.170),
            BreakdownSample(date: "2026-05-21", energy: 39_500, distance: 214_000, eff: 0.185),
            BreakdownSample(date: "2026-05-22", energy: 21_700, distance: 128_000, eff: 0.169),
            BreakdownSample(date: "2026-05-23", energy: 30_200, distance: 170_000, eff: 0.178),
            BreakdownSample(date: "2026-05-24", energy: 25_000, distance: 141_000, eff: 0.177)
        ]
        return rows.map {
            EnergyUsagePoint(date: $0.date, energyWh: $0.energy, distanceM: $0.distance, efficiencyWhPerM: $0.eff)
        }
    }

    /// Eight charging sessions spanning every time-of-day bucket and charger category.
    static func sampleSessions() -> [EnergyChargingSession] {
        let tesla = "tesla_supercharger"
        let rows: [SessionSample] = [
            SessionSample(id: 1, at: "2026-05-24T02:30:00Z", start: 22, end: 80,
                          wh: 42_000, watts: 11_000, cost: 5.04, type: nil),
            SessionSample(id: 2, at: "2026-05-23T08:15:00Z", start: 18, end: 72,
                          wh: 38_000, watts: 150_000, cost: 15.20, type: tesla),
            SessionSample(id: 3, at: "2026-05-22T13:40:00Z", start: 35, end: 78,
                          wh: 30_000, watts: 50_000, cost: 12.00, type: "ccs"),
            SessionSample(id: 4, at: "2026-05-21T19:05:00Z", start: 30, end: 85,
                          wh: 40_000, watts: 11_000, cost: 4.80, type: nil),
            SessionSample(id: 5, at: "2026-05-20T23:50:00Z", start: 12, end: 76,
                          wh: 45_000, watts: 250_000, cost: 18.50, type: tesla),
            SessionSample(id: 6, at: "2026-05-20T10:20:00Z", start: 40, end: 90,
                          wh: 41_000, watts: 7_400, cost: 4.92, type: nil),
            SessionSample(id: 7, at: "2026-05-19T16:10:00Z", start: 25, end: 70,
                          wh: 36_000, watts: 120_000, cost: 14.40, type: tesla),
            SessionSample(id: 8, at: "2026-05-18T21:30:00Z", start: 33, end: 74,
                          wh: 28_000, watts: 60_000, cost: 11.20, type: "ccs")
        ]
        return rows.map {
            EnergyChargingSession(
                id: $0.id,
                startedAt: $0.at,
                startSocPct: $0.start,
                endSocPct: $0.end,
                totalEnergyAddedWh: $0.wh,
                peakPowerW: $0.watts,
                costDecimal: $0.cost,
                chargerType: $0.type
            )
        }
    }

    /// One seeded breakdown row (a named shape, not a wide tuple).
    private struct BreakdownSample {
        let date: String
        let energy: Double
        let distance: Double
        let eff: Double
    }

    /// One seeded session row (a named shape, not a wide tuple).
    private struct SessionSample {
        let id: Int64
        let at: String
        let start: Double
        let end: Double
        let wh: Double
        let watts: Double
        let cost: Double
        let type: String?
    }
}

#if DEBUG
    /// Preview/test seam yielding no stats and no sessions — drives the honest empty hero plus
    /// every per-section empty state (web `hasNoEnergyData`).
    public struct EmptyEnergyDataSource: EnergyDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadStats(vehicleID _: Int64) async throws -> EnergyStats? { nil }
        public func loadSessions(vehicleID _: Int64) async throws -> [EnergyChargingSession] { [] }
        public func loadTelemetry(vehicleID _: Int64) async throws -> EnergyLiveCharging? { nil }
    }

    /// Preview/test seam with non-zero stats totals but no daily breakdown and no sessions —
    /// the hero + metric strip render while every chart / time-of-day / charger / table section
    /// shows its own empty state.
    public struct EmptySectionsEnergyDataSource: EnergyDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadStats(vehicleID _: Int64) async throws -> EnergyStats? {
            EnergyStats(
                totalEnergyUsedWh: 120_000,
                totalWh: 120_000,
                avgEfficiencyWhPerM: 0.176,
                totalDistanceM: 680_000,
                totalCost: 0,
                co2SavedKg: 50.4,
                dailyBreakdown: []
            )
        }

        public func loadSessions(vehicleID _: Int64) async throws -> [EnergyChargingSession] { [] }
        public func loadTelemetry(vehicleID _: Int64) async throws -> EnergyLiveCharging? { nil }
    }

    /// Preview/test seam whose stats load fails — drives the non-blocking `QueryError` banner
    /// (web `statsError`) while the body still renders.
    public struct FailingEnergyDataSource: EnergyDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadStats(vehicleID _: Int64) async throws -> EnergyStats? { throw Failure() }
        public func loadSessions(vehicleID _: Int64) async throws -> [EnergyChargingSession] { [] }
        public func loadTelemetry(vehicleID _: Int64) async throws -> EnergyLiveCharging? { nil }
    }
#endif
