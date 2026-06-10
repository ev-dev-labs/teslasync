//
//  EnergyStatsWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0048 · EnergyStatsWidget (Apple)
//
//  Domain value types for the energy-stats surface — the cached DTO input
//  (the `EnergyStats` aggregate the web `useEnergyStats` query decodes), the
//  display-boundary unit preferences (web `useUnits` → distance + energy prefs),
//  and the chart/summary projection (daily kWh points + the passthrough scalar
//  metrics the stat grid reads) ported from
//  features/dashboard/widgets/EnergyStatsWidget.tsx. No SwiftUI or transport
//  here — this file is pure Foundation so the adapter can be unit-tested (and
//  host-executed) on its own.
//

import Foundation

// MARK: - Display-boundary unit preferences (web `useUnits`)

/// The distance unit the efficiency metric is expressed in — the web
/// `unitPrefs.distance` (`'mi'` | `'km'`). Drives both the Wh/m → Wh/mi|Wh/km
/// conversion factor and the unit label.
public enum EnergyStatsDistanceUnit: String, Sendable, Equatable {
    case km
    case mi
}

/// The energy unit the totals are expressed in — the web `unitPrefs.energy`
/// (`'Wh'` | `'kWh'`). The web `useUnits` pins this to `kWh` by default
/// (`DEFAULT_ENERGY_PREF`), so the surface reads in kilowatt-hours regardless of
/// the metric/imperial split; it is modelled here as a preference so the
/// converter stays a pure, exhaustively-testable function.
public enum EnergyStatsEnergyUnit: String, Sendable, Equatable {
    case wh
    case kwh

    /// The trailing unit label (`"Wh"` / `"kWh"`).
    public var label: String {
        self == .wh ? "Wh" : "kWh"
    }
}

/// The resolved display preferences threaded through the P1/S8 source so the
/// view never does unit math — the native counterpart of the web `useUnits`
/// `unitPrefs` bag. Distance follows the user's `MeasurementSystem`; energy is
/// pinned to kWh to match the web `useUnits` default; `localeIdentifier` drives
/// locale-aware grouping; `currencySymbol` prefixes the wide-layout cost stat
/// (web `total_cost` with a `$` unit).
public struct EnergyStatsUnitPrefs: Sendable, Equatable {
    public var distance: EnergyStatsDistanceUnit
    public var energy: EnergyStatsEnergyUnit
    public var localeIdentifier: String
    public var currencySymbol: String

    public init(
        distance: EnergyStatsDistanceUnit = .km,
        energy: EnergyStatsEnergyUnit = .kwh,
        localeIdentifier: String = "en_US",
        currencySymbol: String = "$"
    ) {
        self.distance = distance
        self.energy = energy
        self.localeIdentifier = localeIdentifier
        self.currencySymbol = currencySymbol
    }

    /// The efficiency unit label for the active distance preference (web
    /// `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`).
    public var efficiencyUnit: String {
        distance == .mi ? "Wh/mi" : "Wh/km"
    }

    /// Default metric preferences (km + kWh) — the parity baseline.
    public static let metric = EnergyStatsUnitPrefs(distance: .km, energy: .kwh)

    /// Imperial preferences (mi + kWh) — energy stays kWh to match web.
    public static let imperial = EnergyStatsUnitPrefs(distance: .mi, energy: .kwh)
}

// MARK: - Cached DTO input (the shape the P1/S8 source decodes for the view)

/// One day's row of the `daily_breakdown` array (web
/// `{ date, energy_wh, distance_m, efficiency_wh_per_m }`). All magnitudes are
/// SI on the wire; `energyWh` is nullable to model the web `?? 0` guard.
public struct EnergyDailyEntry: Sendable, Equatable {
    public var date: String
    public var energyWh: Double?
    public var distanceM: Double?
    public var efficiencyWhPerM: Double?

    public init(
        date: String,
        energyWh: Double?,
        distanceM: Double? = nil,
        efficiencyWhPerM: Double? = nil
    ) {
        self.date = date
        self.energyWh = energyWh
        self.distanceM = distanceM
        self.efficiencyWhPerM = efficiencyWhPerM
    }
}

/// Value-typed projection of the `EnergyStats` aggregate (web
/// `useEnergyStats` → `api/types.ts` `EnergyStats`). Every field is SI as it
/// arrives from the API (Wh / Wh-per-m / kg / m); the view converts at the
/// display boundary. Optional scalars model the web `?? 0` guards.
public struct EnergyStatsData: Sendable, Equatable {
    public var totalEnergyUsedWh: Double?
    public var totalEnergyChargedWh: Double?
    public var totalWh: Double?
    public var avgEfficiencyWhPerM: Double?
    public var totalDistanceM: Double?
    public var totalCost: Double?
    public var co2SavedKg: Double?
    public var dailyBreakdown: [EnergyDailyEntry]

    public init(
        totalEnergyUsedWh: Double? = nil,
        totalEnergyChargedWh: Double? = nil,
        totalWh: Double? = nil,
        avgEfficiencyWhPerM: Double? = nil,
        totalDistanceM: Double? = nil,
        totalCost: Double? = nil,
        co2SavedKg: Double? = nil,
        dailyBreakdown: [EnergyDailyEntry] = []
    ) {
        self.totalEnergyUsedWh = totalEnergyUsedWh
        self.totalEnergyChargedWh = totalEnergyChargedWh
        self.totalWh = totalWh
        self.avgEfficiencyWhPerM = avgEfficiencyWhPerM
        self.totalDistanceM = totalDistanceM
        self.totalCost = totalCost
        self.co2SavedKg = co2SavedKg
        self.dailyBreakdown = dailyBreakdown
    }
}

// MARK: - Chart / summary projection (port of the web memoized derivations)

/// One day's energy usage in the chart series (web `chartData` datum). `index`
/// is the stable x-position (Swift Charts plots on the numeric axis, then maps
/// ticks back to `dateLabel`); `isoDay` is the raw `date` bucket; `dateLabel`
/// is the compact `"M/D"` axis label; `energyKwh` is `energy_wh / 1000`.
///
/// The web plots the raw `energy_wh` magnitude yet labels its tooltip "kWh"; we
/// plot the semantically-correct kWh (`/1000`) so the axis and the "kWh" tooltip
/// agree — the same convention the sibling SolarProductionWidget uses for
/// `solar_energy_wh`.
public struct EnergyDailyPoint: Sendable, Equatable, Identifiable {
    public let index: Int
    public var isoDay: String
    public var dateLabel: String
    public var energyKwh: Double

    public var id: Int {
        index
    }

    public init(index: Int, isoDay: String, dateLabel: String, energyKwh: Double) {
        self.index = index
        self.isoDay = isoDay
        self.dateLabel = dateLabel
        self.energyKwh = energyKwh
    }
}

/// The fully-resolved chart + summary derivation. `points` is the daily series;
/// the scalar SI passthroughs back the stat grid (converted at render); `compactKwh`
/// is the web compact headline (`total_wh / 1000`); `netEnergyWh` is the wide
/// "Net Energy" (`charged − used`). `hasData` mirrors the web `!!data` gate that
/// drives the empty state; `hasChartData` mirrors `chartData.length > 0`.
public struct EnergyStatsProjection: Sendable, Equatable {
    public var points: [EnergyDailyPoint]
    public var totalEnergyUsedWh: Double
    public var totalEnergyChargedWh: Double
    public var avgEfficiencyWhPerM: Double
    public var co2SavedKg: Double
    public var totalCost: Double
    public var compactKwh: Double
    public var hasData: Bool

    public init(
        points: [EnergyDailyPoint] = [],
        totalEnergyUsedWh: Double = 0,
        totalEnergyChargedWh: Double = 0,
        avgEfficiencyWhPerM: Double = 0,
        co2SavedKg: Double = 0,
        totalCost: Double = 0,
        compactKwh: Double = 0,
        hasData: Bool = false
    ) {
        self.points = points
        self.totalEnergyUsedWh = totalEnergyUsedWh
        self.totalEnergyChargedWh = totalEnergyChargedWh
        self.avgEfficiencyWhPerM = avgEfficiencyWhPerM
        self.co2SavedKg = co2SavedKg
        self.totalCost = totalCost
        self.compactKwh = compactKwh
        self.hasData = hasData
    }

    /// Empty projection — no `data` resolved yet (web `!data`).
    public static let empty = EnergyStatsProjection()

    /// Net energy balance in Wh (web `charged − used`).
    public var netEnergyWh: Double {
        totalEnergyChargedWh - totalEnergyUsedWh
    }

    /// Whether the daily series has any rows (web `chartData.length > 0`). Drives
    /// whether the area chart renders within the content body.
    public var hasChartData: Bool {
        !points.isEmpty
    }

    /// The peak daily kWh in the window — drives the chart's y-domain headroom
    /// and the accessible summary. `0` when empty.
    public var peakKwh: Double {
        points.map(\.energyKwh).max() ?? 0
    }
}
