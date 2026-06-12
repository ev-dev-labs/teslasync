import SwiftUI

// Value types for the Statistics surface (web `StatisticsPage.tsx`, route `/statistics`).
// Every measurement is SI canonical — meters, watt-hours, Wh/km — exactly as Phase-42 stores it;
// the user's unit preference is applied only at the SwiftUI render boundary via `Units` (ADR-005,
// SI-cutover instructions). Field names mirror the snake_case wire so the production KMP-backed
// data source maps straight across, while the unit suffix records the SI base unit on disk.

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label strings,
/// not SI measurements, so they round-trip verbatim.
public struct StatisticsVehicle: Identifiable, Hashable, Sendable {
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

// MARK: - Period stats (web inline `useQuery` → `GET /analytics/period-stats?vehicle_id`)

/// Lifetime period statistics for one vehicle (web `PeriodStats`). The primary source — its
/// presence drives the page's loading / empty / error / success phases. Distance is SI meters
/// (web wire is km × 1000), energy is SI watt-hours (web wire is kWh), efficiency is Wh/km.
public struct StatisticsPeriodStats: Hashable, Sendable {
    public let totalDistanceM: Double
    public let totalDrives: Int
    public let energyUsedWh: Double
    public let avgEfficiencyWhKm: Double
    public let totalCost: Double
    public let co2SavedKg: Double

    public init(
        totalDistanceM: Double,
        totalDrives: Int,
        energyUsedWh: Double,
        avgEfficiencyWhKm: Double,
        totalCost: Double,
        co2SavedKg: Double
    ) {
        self.totalDistanceM = totalDistanceM
        self.totalDrives = totalDrives
        self.energyUsedWh = energyUsedWh
        self.avgEfficiencyWhKm = avgEfficiencyWhKm
        self.totalCost = totalCost
        self.co2SavedKg = co2SavedKg
    }

    /// Web `stats.total_distance / stats.total_drives` (SI meters per drive; 0 when no drives).
    public var avgDriveDistanceM: Double {
        totalDrives > 0 ? totalDistanceM / Double(totalDrives) : 0
    }

    /// Web `total_cost / total_distance` where `total_distance` is km — cost per kilometer.
    /// Always per-km (web `statistics.costPerKm`, independent of the distance unit preference).
    public var costPerKm: Double? {
        let kilometers = totalDistanceM / 1000
        guard kilometers > 0 else { return nil }
        return totalCost / kilometers
    }
}

// MARK: - Battery health (web `useBatteryHealthAnalytics` → `GET /analytics/battery-health`)

/// Battery-health roll-up (web `BatteryHealthAnalytics`). State of health is a percentage,
/// estimated capacity is SI watt-hours (web wire is kWh), degradation is %/yr, age is whole months.
public struct StatisticsBatteryHealth: Hashable, Sendable {
    public let currentSoh: Double
    public let estimatedCapacityWh: Double
    public let degradationRateYr: Double
    public let totalCycles: Int
    public let batteryAgeMonths: Int

    public init(
        currentSoh: Double,
        estimatedCapacityWh: Double,
        degradationRateYr: Double,
        totalCycles: Int,
        batteryAgeMonths: Int
    ) {
        self.currentSoh = currentSoh
        self.estimatedCapacityWh = estimatedCapacityWh
        self.degradationRateYr = degradationRateYr
        self.totalCycles = totalCycles
        self.batteryAgeMonths = batteryAgeMonths
    }

    /// Web `RadialGauge value` — state of health as a 0…1 fraction for the gauge trim.
    public var sohFraction: Double {
        min(max(currentSoh / 100, 0), 1)
    }
}

// MARK: - Mileage (web `useMileageStats` → `GET /mileage/stats?vehicle_id`)

/// Lifetime mileage snapshot (web `MileageStats`). Distances are SI meters (web wire is km × 1000).
public struct StatisticsMileage: Hashable, Sendable {
    public let lifetimeDistanceM: Double
    public let last30dDistanceM: Double
    public let driveCountLifetime: Int

    public init(lifetimeDistanceM: Double, last30dDistanceM: Double, driveCountLifetime: Int) {
        self.lifetimeDistanceM = lifetimeDistanceM
        self.last30dDistanceM = last30dDistanceM
        self.driveCountLifetime = driveCountLifetime
    }

    /// Web `(mileage.last_30d_km ?? 0) / 30` — mean daily distance over the trailing 30 days (SI m).
    public var dailyAverageM: Double {
        last30dDistanceM / 30
    }

    /// Web `((mileage.last_30d_km ?? 0) / 30) * 365` — 30-day rate annualized (SI meters).
    public var yearlyProjectionM: Double {
        dailyAverageM * 365
    }
}

// MARK: - State distribution (web `useStateSummary` → `GET /vehicle-states/summary`)

/// One raw state bucket (web `StateSummary`: `state` + `totalMin`). Minutes are durations, not a
/// unit-converted SI base, so they carry through to the percentage derivation verbatim.
public struct StatisticsStateEntry: Hashable, Sendable {
    public let state: String
    public let totalMinutes: Double

    public init(state: String, totalMinutes: Double) {
        self.state = state
        self.totalMinutes = totalMinutes
    }
}

/// One derived pie slice (web `stateData`): the state name, its share of total time as a whole
/// percent, and a stable categorical color index (web `STATE_COLORS`).
public struct StatisticsStateSlice: Identifiable, Hashable, Sendable {
    public let state: String
    public let percent: Int
    public let colorIndex: Int

    public var id: String {
        state
    }

    public init(state: String, percent: Int, colorIndex: Int) {
        self.state = state
        self.percent = percent
        self.colorIndex = colorIndex
    }
}

/// Stable palette index per Tesla lifecycle state (web `STATE_COLORS`), so the same state keeps
/// the same hue across renders. Unknown states fall back to a neutral palette slot (web `palette[5]`).
public enum StatisticsStateColor {
    public static func colorIndex(for state: String) -> Int {
        switch state.lowercased() {
        case "driving": 2
        case "charging": 4
        case "parked": 1
        case "sleeping": 7
        case "online": 0
        case "idle": 6
        default: 5
        }
    }
}

// MARK: - Vehicle comparison (web `useFleetAnalytics` → `GET /analytics/fleet`)

/// One vehicle in the fleet roll-up (web `fleet.vehicle_comparison[]`). Distance is SI meters
/// (web wire is km × 1000) and energy is SI watt-hours (web wire is kWh); both convert at the
/// chart's display boundary.
public struct StatisticsVehicleComparison: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let name: String
    public let distanceM: Double
    public let energyWh: Double

    public init(id: Int64, name: String, distanceM: Double, energyWh: Double) {
        self.id = id
        self.name = name
        self.distanceM = distanceM
        self.energyWh = energyWh
    }
}
