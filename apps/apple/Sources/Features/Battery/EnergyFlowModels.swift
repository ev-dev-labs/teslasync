import Foundation

// Value types for the Energy-Flow surface (web
// `web/src/features/battery/pages/EnergyFlowPage.tsx`, route `/energy-flow`). The historical
// analytics source serves SI exactly as the API does — energy is watt-hours, distance is metres,
// efficiency is watt-hours per metre, cost is a plain decimal — and the user's unit preference is
// applied only at the SwiftUI render boundary (ADR-005). Field names mirror the snake_case wire
// (`total_energy_used_wh`, `total_energy_charged_wh`, `avg_efficiency_wh_per_m`, `co2_saved_kg`,
// `period_days`) so the production KMP-backed data source maps straight across.
//
// The live `/energy/flow` snapshot is a pre-existing, non-SI-normalised endpoint: it serves
// charging power already in kW and remaining energy already in kWh (the web renders them
// verbatim with `kW` / `kWh` suffixes, no conversion). Those wire-native fields are modelled
// with their unit in the name (`...Kw` / `...Kwh`) and shown verbatim for faithful parity, while
// SoC is a raw percent and the charge state is the wire string. The display formatters live in
// the shared `EnergyFormat`; the pure per-`useMemo` derivations live in `EnergyFlowDerivations`.

// MARK: - Live energy flow (web `useEnergyFlow` → GET /vehicles/{id}/energy/flow)

/// The real-time energy-flow snapshot (web `EnergyFlowData`). The charging-power and
/// remaining-energy fields are the endpoint's wire-native display units (kW / kWh) and are shown
/// verbatim, matching the web; SoC is a raw percent; the charge state is the wire string. Every
/// field is optional so the diagram renders an honest "no live data" rather than a fabricated zero.
public struct EnergyFlowSnapshot: Equatable, Sendable {
    public let dcChargingPowerKw: Double?
    public let acChargingPowerKw: Double?
    public let energyRemainingKwh: Double?
    public let packVoltage: Double?
    public let packCurrent: Double?
    public let socPercent: Double?
    public let chargeState: String?

    public init(
        dcChargingPowerKw: Double?,
        acChargingPowerKw: Double?,
        energyRemainingKwh: Double?,
        packVoltage: Double?,
        packCurrent: Double?,
        socPercent: Double?,
        chargeState: String?
    ) {
        self.dcChargingPowerKw = dcChargingPowerKw
        self.acChargingPowerKw = acChargingPowerKw
        self.energyRemainingKwh = energyRemainingKwh
        self.packVoltage = packVoltage
        self.packCurrent = packCurrent
        self.socPercent = socPercent
        self.chargeState = chargeState
    }
}

// MARK: - Daily breakdown (web `daily_breakdown[]`)

/// One day of the energy breakdown (web `daily_breakdown[]`): the SI energy added, the SI
/// distance, the SI energy-intensity, and the cost for a single calendar day.
public struct EnergyFlowDailyPoint: Identifiable, Equatable, Sendable {
    /// The raw `yyyy-MM-dd` wire date; the medium label is derived at the boundary.
    public let date: String
    public let energyWh: Double
    public let distanceM: Double
    public let efficiencyWhPerM: Double
    public let cost: Double

    public var id: String { date }

    public init(date: String, energyWh: Double, distanceM: Double, efficiencyWhPerM: Double, cost: Double) {
        self.date = date
        self.energyWh = energyWh
        self.distanceM = distanceM
        self.efficiencyWhPerM = efficiencyWhPerM
        self.cost = cost
    }
}

// MARK: - Energy stats (web `GET /vehicles/{id}/energy?days=N`)

/// The per-vehicle, per-window energy analytics snapshot (web `EnergyStatsResponse`). Drives the
/// six summary cards, the two daily charts, the efficiency-metrics panel, and the history table.
public struct EnergyFlowStats: Equatable, Sendable {
    public let periodDays: Int
    public let totalEnergyUsedWh: Double
    public let totalEnergyChargedWh: Double
    public let totalWh: Double
    public let totalCost: Double
    public let totalDistanceM: Double
    public let avgEfficiencyWhPerM: Double
    public let co2SavedKg: Double
    public let dailyBreakdown: [EnergyFlowDailyPoint]

    public init(
        periodDays: Int,
        totalEnergyUsedWh: Double,
        totalEnergyChargedWh: Double,
        totalWh: Double,
        totalCost: Double,
        totalDistanceM: Double,
        avgEfficiencyWhPerM: Double,
        co2SavedKg: Double,
        dailyBreakdown: [EnergyFlowDailyPoint]
    ) {
        self.periodDays = periodDays
        self.totalEnergyUsedWh = totalEnergyUsedWh
        self.totalEnergyChargedWh = totalEnergyChargedWh
        self.totalWh = totalWh
        self.totalCost = totalCost
        self.totalDistanceM = totalDistanceM
        self.avgEfficiencyWhPerM = avgEfficiencyWhPerM
        self.co2SavedKg = co2SavedKg
        self.dailyBreakdown = dailyBreakdown
    }
}
