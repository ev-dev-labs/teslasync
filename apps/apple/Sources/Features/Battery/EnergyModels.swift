import Foundation

// Value types for the Energy surface (web `web/src/features/battery/pages/EnergyPage.tsx`,
// route `/energy`). Every measurement stays SI exactly as the API serves it — energy is
// watt-hours, distance is metres, efficiency is watt-hours per metre, power is watts, cost
// is a plain decimal — and the user's unit preference is applied only at the SwiftUI render
// boundary (ADR-005). Field names mirror the snake_case wire (`total_energy_added_wh`,
// `avg_efficiency_wh_per_m`, `co2_saved_kg`) so the production KMP-backed data source maps
// straight across. The pure per-`useMemo` derivations the web computes live in
// `EnergyDerivations.swift`; the display formatters live in `EnergyFormat.swift`.

// MARK: - Energy stats (web `useEnergyStats` → GET /vehicles/{id}/energy)

/// One day of the energy breakdown (web `daily_breakdown[]`): the energy added, the
/// energy-intensity, and the distance for a single calendar day. All SI.
public struct EnergyUsagePoint: Identifiable, Equatable, Sendable {
    /// The raw `yyyy-MM-dd` wire date; the medium label is derived at the boundary.
    public let date: String
    public let energyWh: Double
    public let distanceM: Double
    public let efficiencyWhPerM: Double

    public var id: String { date }

    public init(date: String, energyWh: Double, distanceM: Double, efficiencyWhPerM: Double) {
        self.date = date
        self.energyWh = energyWh
        self.distanceM = distanceM
        self.efficiencyWhPerM = efficiencyWhPerM
    }
}

/// The per-vehicle energy analytics snapshot (web `useEnergyStats` `stats`). Drives the
/// hero gauges, the quick-metric strip, the lifetime panel, and the two daily charts.
public struct EnergyStats: Equatable, Sendable {
    public let totalEnergyUsedWh: Double
    public let totalWh: Double
    public let avgEfficiencyWhPerM: Double
    public let totalDistanceM: Double
    public let totalCost: Double
    public let co2SavedKg: Double?
    public let dailyBreakdown: [EnergyUsagePoint]

    public init(
        totalEnergyUsedWh: Double,
        totalWh: Double,
        avgEfficiencyWhPerM: Double,
        totalDistanceM: Double,
        totalCost: Double,
        co2SavedKg: Double?,
        dailyBreakdown: [EnergyUsagePoint]
    ) {
        self.totalEnergyUsedWh = totalEnergyUsedWh
        self.totalWh = totalWh
        self.avgEfficiencyWhPerM = avgEfficiencyWhPerM
        self.totalDistanceM = totalDistanceM
        self.totalCost = totalCost
        self.co2SavedKg = co2SavedKg
        self.dailyBreakdown = dailyBreakdown
    }
}

// MARK: - Charging session (web `useChargingSessionsPaginated` → GET /charging)

/// One charging session row (web `ChargingSession`). Energy is watt-hours, power is watts,
/// SoC is a raw percent, cost is a plain decimal; nullable wire fields stay optional so the
/// table renders an em dash rather than a fabricated zero.
public struct EnergyChargingSession: Identifiable, Equatable, Sendable {
    public let id: Int64
    public let startedAt: String
    public let startSocPct: Double?
    public let endSocPct: Double?
    public let totalEnergyAddedWh: Double
    public let peakPowerW: Double?
    public let costDecimal: Double?
    public let chargerType: String?

    public init(
        id: Int64,
        startedAt: String,
        startSocPct: Double?,
        endSocPct: Double?,
        totalEnergyAddedWh: Double,
        peakPowerW: Double?,
        costDecimal: Double?,
        chargerType: String?
    ) {
        self.id = id
        self.startedAt = startedAt
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.totalEnergyAddedWh = totalEnergyAddedWh
        self.peakPowerW = peakPowerW
        self.costDecimal = costDecimal
        self.chargerType = chargerType
    }
}

// MARK: - Charging telemetry (web `useChargingTelemetryLatest` → /charging-telemetry/latest)

/// The latest live charging telemetry (web `liveCharging`). Only the lifetime-energy figure
/// the page surfaces is modelled; it is the vehicle's reported lifetime kWh (already kWh on
/// the wire, not SI watt-hours), so it is shown verbatim with a kWh suffix.
public struct EnergyLiveCharging: Equatable, Sendable {
    public let lifetimeEnergyUsed: Double?

    public init(lifetimeEnergyUsed: Double?) {
        self.lifetimeEnergyUsed = lifetimeEnergyUsed
    }
}

// MARK: - Derived view rows

/// One time-of-day bucket (web `timeOfDayData`): the session count and total energy added
/// for a six-hour window. `name` is the resolved bucket label.
public struct EnergyTimeOfDayBucket: Identifiable, Equatable, Sendable {
    public let id: Int
    public let name: String
    public let count: Int
    public let energyWh: Double

    public init(id: Int, name: String, count: Int, energyWh: Double) {
        self.id = id
        self.name = name
        self.count = count
        self.energyWh = energyWh
    }
}

/// One charger-type aggregation (web `chargerBreakdown`): the session count, total energy,
/// and total cost for a charger category, plus its palette colour index.
public struct EnergyChargerBreakdownRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let count: Int
    public let energyWh: Double
    public let cost: Double
    public let colorIndex: Int

    /// The category name doubles as the stable id.
    public var name: String { id }

    public init(name: String, count: Int, energyWh: Double, cost: Double, colorIndex: Int) {
        id = name
        self.count = count
        self.energyWh = energyWh
        self.cost = cost
        self.colorIndex = colorIndex
    }
}
