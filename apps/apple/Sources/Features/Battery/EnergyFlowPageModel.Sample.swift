import Foundation

/// A representative local seed used as the `EnergyFlowPage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (a healthy seven-day window with a daily breakdown plus an active
/// charging flow snapshot) so the surface renders its populated success state out of the box.
/// Energy is watt-hours, distance is metres, efficiency is watt-hours per metre; the live flow's
/// power/energy are the endpoint's wire-native kW / kWh. The view converts at the render boundary.
public struct SampleEnergyFlowDataSource: EnergyFlowDataSource {
    public init() {}

    public func loadVehicles() async throws -> [BatteryVehicle] {
        [
            BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            BatteryVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002")
        ]
    }

    public func loadStats(vehicleID _: Int64, days: Int) async throws -> EnergyFlowStats? {
        let breakdown = SampleEnergyFlowDataSource.sampleBreakdown()
        let used = breakdown.reduce(0) { $0 + $1.energyWh }
        let distance = breakdown.reduce(0) { $0 + $1.distanceM }
        return EnergyFlowStats(
            periodDays: days,
            totalEnergyUsedWh: used,
            totalEnergyChargedWh: used * 1.08,
            totalWh: used,
            totalCost: 41.62,
            totalDistanceM: distance,
            avgEfficiencyWhPerM: 0.178,
            co2SavedKg: 96.4,
            dailyBreakdown: breakdown
        )
    }

    public func loadFlow(vehicleID _: Int64) async throws -> EnergyFlowSnapshot? {
        EnergyFlowSnapshot(
            dcChargingPowerKw: 0,
            acChargingPowerKw: 7.4,
            energyRemainingKwh: 58.2,
            packVoltage: 396.4,
            packCurrent: 18.7,
            socPercent: 72,
            chargeState: "Charging"
        )
    }

    /// Seven daily breakdown points (energy added, distance, Wh/m efficiency, cost).
    static func sampleBreakdown() -> [EnergyFlowDailyPoint] {
        let rows: [BreakdownSample] = [
            BreakdownSample(date: "2026-05-18", energy: 18_600, distance: 108_000, eff: 0.172, cost: 4.20),
            BreakdownSample(date: "2026-05-19", energy: 36_800, distance: 201_000, eff: 0.183, cost: 8.10),
            BreakdownSample(date: "2026-05-20", energy: 24_100, distance: 142_000, eff: 0.170, cost: 5.40),
            BreakdownSample(date: "2026-05-21", energy: 39_500, distance: 214_000, eff: 0.185, cost: 8.90),
            BreakdownSample(date: "2026-05-22", energy: 21_700, distance: 128_000, eff: 0.169, cost: 4.80),
            BreakdownSample(date: "2026-05-23", energy: 30_200, distance: 170_000, eff: 0.178, cost: 6.70),
            BreakdownSample(date: "2026-05-24", energy: 25_000, distance: 141_000, eff: 0.177, cost: 5.52)
        ]
        return rows.map {
            EnergyFlowDailyPoint(
                date: $0.date,
                energyWh: $0.energy,
                distanceM: $0.distance,
                efficiencyWhPerM: $0.eff,
                cost: $0.cost
            )
        }
    }

    /// One seeded breakdown row (a named shape, not a wide tuple).
    private struct BreakdownSample {
        let date: String
        let energy: Double
        let distance: Double
        let eff: Double
        let cost: Double
    }
}

#if DEBUG
    /// Preview/test seam yielding no stats and no flow — drives the honest page empty state plus
    /// the diagram's no-live-data branch (web `!stats` + absent `flow`).
    public struct EmptyEnergyFlowDataSource: EnergyFlowDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadStats(vehicleID _: Int64, days _: Int) async throws -> EnergyFlowStats? { nil }
        public func loadFlow(vehicleID _: Int64) async throws -> EnergyFlowSnapshot? { nil }
    }

    /// Preview/test seam with non-zero stats totals but no daily breakdown — the diagram + summary
    /// cards render while every chart / history section shows its own empty state.
    public struct EmptySectionsEnergyFlowDataSource: EnergyFlowDataSource {
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadStats(vehicleID _: Int64, days: Int) async throws -> EnergyFlowStats? {
            EnergyFlowStats(
                periodDays: days,
                totalEnergyUsedWh: 120_000,
                totalEnergyChargedWh: 130_000,
                totalWh: 120_000,
                totalCost: 26.4,
                totalDistanceM: 680_000,
                avgEfficiencyWhPerM: 0.176,
                co2SavedKg: 50.4,
                dailyBreakdown: []
            )
        }

        public func loadFlow(vehicleID _: Int64) async throws -> EnergyFlowSnapshot? {
            EnergyFlowSnapshot(
                dcChargingPowerKw: 0,
                acChargingPowerKw: 0,
                energyRemainingKwh: 41.0,
                packVoltage: 388.0,
                packCurrent: 0,
                socPercent: 51,
                chargeState: nil
            )
        }
    }

    /// Preview/test seam whose stats load fails — drives the `.error` phase with a retry (web
    /// `statsError`).
    public struct FailingEnergyFlowDataSource: EnergyFlowDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [BatteryVehicle] {
            [BatteryVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadStats(vehicleID _: Int64, days _: Int) async throws -> EnergyFlowStats? { throw Failure() }
        public func loadFlow(vehicleID _: Int64) async throws -> EnergyFlowSnapshot? { nil }
    }
#endif
