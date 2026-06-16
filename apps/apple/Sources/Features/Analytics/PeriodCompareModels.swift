import SwiftUI

// Value types for the Period Comparison surface (web `PeriodStats` / `ComparisonRow` plus the
// period + metric enums). All measurements are SI canonical (meters, watt-hours, Wh/km); the
// user's unit preference is applied only at the SwiftUI render boundary via `Units` (ADR-005,
// SI-cutover instructions). Field names mirror the snake_case wire so the production
// KMP-backed source maps straight across.

// MARK: - Vehicle (web `Vehicle`, `GET /vehicles` via `useVehicles`)

/// One vehicle in the fleet (web `Vehicle`). Only identity + metadata strings, not SI
/// measurements, so they round-trip verbatim into the selector.
public struct PeriodCompareVehicle: Identifiable, Hashable, Sendable {
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

// MARK: - Period window (web `PERIOD_VALUES` / `periodOptions` / `PERIOD_DAYS`)

/// One of the five comparison windows (web `PERIOD_VALUES` = '7' | '30' | '90' | '365' | '0').
/// `days == 0` is the "All time" window (web `PERIOD_DAYS['0'] = 0`).
public enum PeriodCompareWindow: String, CaseIterable, Identifiable, Sendable {
    case last7, last30, last90, lastYear, allTime

    public var id: String {
        rawValue
    }

    /// Web `PERIOD_DAYS[value]` — the `days` query parameter sent to `/analytics/period-stats`.
    public var days: Int {
        switch self {
        case .last7: 7
        case .last30: 30
        case .last90: 90
        case .lastYear: 365
        case .allTime: 0
        }
    }

    /// Web `periodOptions[].label` i18n key.
    public var labelKey: LocalizedStringKey {
        switch self {
        case .last7: "compare.last7"
        case .last30: "compare.last30"
        case .last90: "compare.last90"
        case .lastYear: "compare.lastYear"
        case .allTime: "compare.allTime"
        }
    }
}

// MARK: - Period stats (web `PeriodStats`, `GET /analytics/period-stats`)

/// Aggregate statistics for one vehicle over one period (web `PeriodStats`). Stored SI canonical:
/// distance in METERS (web `total_distance` km × 1000), energy in WATT-HOURS (web `energy_used`
/// kWh × 1000), efficiency in Wh/km (a per-distance rate the web converts to Wh/mi at the imperial
/// display boundary). Cost is a plain currency amount and CO₂ a mass in kg — neither is a
/// unit-preference dimension, so both pass through unconverted.
public struct PeriodStats: Hashable, Sendable {
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
}

// MARK: - Comparison metrics (web `metrics` array)

/// The six compared metrics, in the web's row/card order (web `metrics`). Each carries its i18n
/// title key, an SF Symbol (web Lucide icon), and a semantic tone (web `color`: cyan/green/purple
/// mapped to the platform token set). The raw SI value is converted + formatted per metric at the
/// display boundary by `PeriodCompareFormat`.
public enum PeriodCompareMetric: String, CaseIterable, Identifiable, Sendable {
    case distance, drives, energy, efficiency, cost, co2

    public var id: String {
        rawValue
    }

    /// Web `metric.label` i18n key.
    public var titleKey: LocalizedStringKey {
        switch self {
        case .distance: "compare.totalDistance"
        case .drives: "compare.totalDrives"
        case .energy: "compare.energyUsed"
        case .efficiency: "compare.avgEfficiency"
        case .cost: "compare.totalCost"
        case .co2: "compare.co2Saved"
        }
    }

    /// Web Lucide icon mapped to the nearest SF Symbol (Car / TrendingUp / Zap / Gauge /
    /// DollarSign / Leaf).
    public var systemImage: String {
        switch self {
        case .distance: "car.fill"
        case .drives: "chart.line.uptrend.xyaxis"
        case .energy: "bolt.fill"
        case .efficiency: "gauge.with.dots.needle.bottom.50percent"
        case .cost: "dollarsign.circle.fill"
        case .co2: "leaf.fill"
        }
    }

    /// Web per-metric accent (cyan/green/purple) mapped to the platform's semantic tone tokens.
    public var tone: TSTone {
        switch self {
        case .distance, .efficiency: .accent
        case .drives, .cost: .success
        case .energy, .co2: .info
        }
    }
}

/// One metric's display-converted A/B values plus its unit label (web `metrics[]` after the
/// `useUnits` conversion). The chart, metric cards, and comparison table all read from these so a
/// value and its unit label can never disagree.
public struct PeriodCompareMetricValue: Identifiable, Sendable {
    public let metric: PeriodCompareMetric
    public let valueA: Double
    public let valueB: Double
    /// Display unit suffix (web `m.unit`: "km"/"mi", "", "kWh", "Wh/km"/"Wh/mi", "$", "kg").
    public let unitLabel: String

    public init(metric: PeriodCompareMetric, valueA: Double, valueB: Double, unitLabel: String) {
        self.metric = metric
        self.valueA = valueA
        self.valueB = valueB
        self.unitLabel = unitLabel
    }

    public var id: String {
        metric.rawValue
    }

    /// Web `change = m.a - m.b` (in display units).
    public var change: Double {
        valueA - valueB
    }
}
