import Foundation

// Value types for the True Cost of Ownership surface (web `TrueCostPage.tsx`, route /analytics/tco).
// Measurements that are physical quantities are SI canonical — meters, watt-hours — exactly as
// Phase-42 stores them; the user's unit preference is applied only at the SwiftUI render boundary
// via `Units` (ADR-005, SI-cutover instructions). Monetary fields are currency amounts (not a
// unit-converted SI base) and per-kilometre costs are intrinsically per-km on this page (web
// `cost_per_km_*`, independent of the distance preference), so both carry through verbatim.
// Field names mirror the snake_case wire so the production KMP-backed source maps straight across,
// while the unit suffix records the SI base unit on disk.

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label strings,
/// not SI measurements, so they round-trip verbatim.
public struct TrueCostVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String

    public init(id: Int64, displayName: String, vin: String) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Gas unit (web `settings.gas_unit ?? 'gallon'`)

/// The user's gasoline-volume preference (web `settings.gas_unit`), used only for the
/// equivalent-gas-cost card's `…/{unit}` label. The two values mirror the web branch
/// (`gasUnit === 'liter' ? t('common.unit.liter') : t('common.unit.gallon')`).
public enum TrueCostGasUnit: String, Sendable, Equatable, CaseIterable {
    case gallon
    case liter
}

// MARK: - Monthly entry (web `MonthlyCostEntry`)

/// One month of the cost rollup (web `MonthlyCostEntry`). Monetary fields are currency amounts;
/// `energyWh` is SI watt-hours (web wire `energy_wh`). Drives the cumulative-savings area chart
/// (`cumulativeSavings`) and the monthly EV-vs-gas bars (`evCost` + `equivGasCost`).
public struct MonthlyCostEntry: Identifiable, Hashable, Sendable {
    public let month: String
    public let evCost: Double
    public let equivGasCost: Double
    public let cumulativeSavings: Double
    public let energyWh: Double

    public var id: String {
        month
    }

    public init(month: String, evCost: Double, equivGasCost: Double, cumulativeSavings: Double, energyWh: Double) {
        self.month = month
        self.evCost = evCost
        self.equivGasCost = equivGasCost
        self.cumulativeSavings = cumulativeSavings
        self.energyWh = energyWh
    }
}

// MARK: - Cost breakdown (web `useCostBreakdown` → `GET /analytics/tco?vehicle_id`)

/// The deterministic operating-cost envelope this page renders (web `CostBreakdown`). The primary
/// source — its presence drives the page's loading / empty / error / success phases. Monetary
/// totals are currency amounts; `totalEnergyWh` is SI watt-hours (web wire `total_wh`);
/// `totalDistanceM` is SI meters (web wire `total_km` × 1000); per-km costs are intrinsically
/// per-kilometre. Dates are the raw `YYYY-MM-DD` strings the web renders verbatim.
public struct CostBreakdown: Hashable, Sendable {
    public let totalChargingCost: Double
    public let totalEnergyWh: Double
    public let totalSessions: Int
    public let totalDistanceM: Double
    public let firstDate: String
    public let lastDate: String
    public let equivalentGasCost: Double
    public let totalSavings: Double
    public let monthlySavings: Double
    public let costPerKmEv: Double
    public let costPerKmIce: Double
    public let maintenanceSavingsEstimate: Double
    public let monthsOfOwnership: Double
    public let gasPrice: Double
    public let gasEfficiencyMpg: Double
    public let monthlyBreakdown: [MonthlyCostEntry]

    public init(
        totalChargingCost: Double,
        totalEnergyWh: Double,
        totalSessions: Int,
        totalDistanceM: Double,
        firstDate: String,
        lastDate: String,
        equivalentGasCost: Double,
        totalSavings: Double,
        monthlySavings: Double,
        costPerKmEv: Double,
        costPerKmIce: Double,
        maintenanceSavingsEstimate: Double,
        monthsOfOwnership: Double,
        gasPrice: Double,
        gasEfficiencyMpg: Double,
        monthlyBreakdown: [MonthlyCostEntry]
    ) {
        self.totalChargingCost = totalChargingCost
        self.totalEnergyWh = totalEnergyWh
        self.totalSessions = totalSessions
        self.totalDistanceM = totalDistanceM
        self.firstDate = firstDate
        self.lastDate = lastDate
        self.equivalentGasCost = equivalentGasCost
        self.totalSavings = totalSavings
        self.monthlySavings = monthlySavings
        self.costPerKmEv = costPerKmEv
        self.costPerKmIce = costPerKmIce
        self.maintenanceSavingsEstimate = maintenanceSavingsEstimate
        self.monthsOfOwnership = monthsOfOwnership
        self.gasPrice = gasPrice
        self.gasEfficiencyMpg = gasEfficiencyMpg
        self.monthlyBreakdown = monthlyBreakdown
    }

    /// Web `tco.total_savings + tco.maintenance_savings_estimate` — the "Total Estimated Savings"
    /// figure shown in the savings-breakdown panel.
    public var totalEstimatedSavings: Double {
        totalSavings + maintenanceSavingsEstimate
    }
}
