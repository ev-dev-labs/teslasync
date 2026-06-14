import Foundation

/// A representative local seed used as the `TrueCostPage` / preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it is an
/// API-response-shaped fixture (3 vehicles, each with a lifetime cost-of-ownership envelope and a
/// month-by-month rollup) so the surface renders its populated success state out of the box
/// (mirroring the sibling pages' sample sources). Monetary fields are currency amounts; energy is
/// SI watt-hours and distance is SI meters; the view converts at the boundary.
public struct SampleTrueCostDataSource: TrueCostDataSource {
    public init() {}

    public func loadVehicles() async throws -> [TrueCostVehicle] {
        [
            TrueCostVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            TrueCostVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002"),
            TrueCostVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003")
        ]
    }

    public func loadCostBreakdown(vehicleID: Int64) async throws -> CostBreakdown? {
        switch vehicleID {
        case 1: Self.breakdown(scale: 1.0, sessions: 142, firstDate: "2023-01-12", lastDate: "2024-12-20")
        case 2: Self.breakdown(scale: 0.86, sessions: 121, firstDate: "2023-04-03", lastDate: "2024-12-18")
        default: Self.breakdown(scale: 1.27, sessions: 168, firstDate: "2022-09-22", lastDate: "2024-12-19")
        }
    }

    /// Builds a self-consistent envelope scaled around a base vehicle, with a six-month rollup whose
    /// cumulative savings accumulate the per-month (gas − EV) deltas.
    private static func breakdown(scale: Double, sessions: Int, firstDate: String, lastDate: String) -> CostBreakdown {
        let monthly = months(scale: scale)
        let totalEv = monthly.reduce(0) { $0 + $1.evCost }
        let totalGas = monthly.reduce(0) { $0 + $1.equivGasCost }
        let totalSavings = totalGas - totalEv
        let maintenance = 1200 * scale
        return CostBreakdown(
            totalChargingCost: totalEv,
            totalEnergyWh: 7_980_000 * scale,
            totalSessions: sessions,
            totalDistanceM: 42_000_000 * scale,
            firstDate: firstDate,
            lastDate: lastDate,
            equivalentGasCost: totalGas,
            totalSavings: totalSavings,
            monthlySavings: totalSavings / Double(monthly.count),
            costPerKmEv: 0.044,
            costPerKmIce: 0.124,
            maintenanceSavingsEstimate: maintenance,
            monthsOfOwnership: 24,
            gasPrice: 3.89,
            gasEfficiencyMpg: 30,
            monthlyBreakdown: monthly
        )
    }

    private static func months(scale: Double) -> [MonthlyCostEntry] {
        let labels = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        let evCosts = [78.0, 82.0, 71.0, 88.0, 95.0, 102.0]
        let gasCosts = [214.0, 226.0, 198.0, 242.0, 268.0, 281.0]
        var cumulative = 0.0
        return labels.enumerated().map { index, label in
            let ev = evCosts[index] * scale
            let gas = gasCosts[index] * scale
            cumulative += gas - ev
            return MonthlyCostEntry(
                month: label,
                evCost: ev,
                equivGasCost: gas,
                cumulativeSavings: cumulative,
                energyWh: 1_330_000 * scale
            )
        }
    }
}

#if DEBUG
    /// Preview/test seam yielding a single vehicle with no breakdown — drives the page's no-data
    /// empty (web `!tco`) and each chart's own monthly empty state.
    public struct EmptyTrueCostDataSource: TrueCostDataSource {
        public init() {}

        public func loadVehicles() async throws -> [TrueCostVehicle] {
            [TrueCostVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadCostBreakdown(vehicleID _: Int64) async throws -> CostBreakdown? {
            nil
        }
    }

    /// Preview/test seam yielding a breakdown with an EMPTY monthly series — drives the populated
    /// hero/summary success state while both charts show their `tco.noMonthlyData` empty state
    /// (web `monthlyBreakdown.length === 0`).
    public struct NoMonthlyTrueCostDataSource: TrueCostDataSource {
        public init() {}

        public func loadVehicles() async throws -> [TrueCostVehicle] {
            [TrueCostVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadCostBreakdown(vehicleID _: Int64) async throws -> CostBreakdown? {
            CostBreakdown(
                totalChargingCost: 1850,
                totalEnergyWh: 7_980_000,
                totalSessions: 142,
                totalDistanceM: 42_000_000,
                firstDate: "2023-01-12",
                lastDate: "2024-12-20",
                equivalentGasCost: 5200,
                totalSavings: 3350,
                monthlySavings: 140,
                costPerKmEv: 0.044,
                costPerKmIce: 0.124,
                maintenanceSavingsEstimate: 1200,
                monthsOfOwnership: 24,
                gasPrice: 3.89,
                gasEfficiencyMpg: 30,
                monthlyBreakdown: []
            )
        }
    }

    /// Preview/test seam whose breakdown load fails — drives the error state (web `tcoQuery.error`).
    public struct FailingTrueCostDataSource: TrueCostDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [TrueCostVehicle] {
            [TrueCostVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadCostBreakdown(vehicleID _: Int64) async throws -> CostBreakdown? {
            throw Failure()
        }
    }
#endif
