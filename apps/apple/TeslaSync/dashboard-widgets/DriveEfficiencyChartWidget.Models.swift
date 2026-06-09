//
//  DriveEfficiencyChartWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0038 · DriveEfficiencyChartWidget (Apple)
//
//  Domain value types ported from
//  features/dashboard/widgets/DriveEfficiencyChartWidget.tsx: the cached drive
//  DTO the efficiency estimate reads, the vehicle identity, one projected daily
//  point (the web `DailyEfficiency` after display conversion), and the merged
//  projection the view renders. Pure Foundation — no SwiftUI / transport.
//

import Foundation

// MARK: - Cached input (port of the web `Drive` fields the estimate reads)

/// One cached drive row from `GET /drives?vehicle_id=…&limit=60` — the subset of
/// the web `Drive` (`api/types.ts`) the efficiency estimate needs. Distances are
/// SI metres, energy is watt-hours, SoC is whole percent, and `startTs` is the
/// drive's ISO-8601 start timestamp (the same field the web reads as `start_ts`).
public struct DriveEfficiencySample: Sendable, Equatable {
    public var startTs: String?
    public var distanceM: Double
    public var startSocPct: Double?
    public var endSocPct: Double?
    public var energyUsedWh: Double?

    public init(
        startTs: String? = nil,
        distanceM: Double = 0,
        startSocPct: Double? = nil,
        endSocPct: Double? = nil,
        energyUsedWh: Double? = nil
    ) {
        self.startTs = startTs
        self.distanceM = distanceM
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.energyUsedWh = energyUsedWh
    }
}

/// Minimal vehicle identity the widget needs (port of the web `useVehicles()`
/// first row — the widget only reads the id to scope the query, plus a name for
/// the optional accessibility summary).
public struct DriveEfficiencyVehicle: Sendable, Equatable {
    public var id: Int64
    public var displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }

    /// Trimmed display name, or `nil` when blank (web `vehicles?.[0]`).
    public var primaryName: String? {
        guard let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
            return nil
        }
        return name
    }
}

// MARK: - Projection (port of web `DailyEfficiency` + the derived stat values)

/// One projected daily point — the Swift port of the web `DailyEfficiency` after
/// the display-unit conversion: the stable `'YYYY-MM-DD'` key, the chronological
/// `index`, the short axis `label` (`"Apr 7"`), the display-unit daily average,
/// and the 7-day rolling average (`nil` until the window holds at least 2 days).
public struct DriveEfficiencyPoint: Sendable, Equatable, Identifiable {
    public var date: String
    public var index: Int
    public var label: String
    public var efficiency: Double
    public var rollingAvg: Double?

    public init(date: String, index: Int, label: String, efficiency: Double, rollingAvg: Double?) {
        self.date = date
        self.index = index
        self.label = label
        self.efficiency = efficiency
        self.rollingAvg = rollingAvg
    }

    public var id: String {
        date
    }
}

/// The merged projection the view switches over — the last-30-days daily points,
/// the derived Avg / Best-day / Trend stats (web `overallAvg` / `bestDay` /
/// `trend`), the active efficiency + distance unit labels, and whether there is
/// any point to chart (web `displayData.length === 0` → `!hasData`).
public struct DriveEfficiencyProjection: Sendable, Equatable {
    public var points: [DriveEfficiencyPoint]
    public var overallAvg: Double?
    public var bestDay: Double?
    public var trend: Double?
    public var efficiencyUnit: String
    public var distanceUnit: String

    public init(
        points: [DriveEfficiencyPoint],
        overallAvg: Double?,
        bestDay: Double?,
        trend: Double?,
        efficiencyUnit: String,
        distanceUnit: String
    ) {
        self.points = points
        self.overallAvg = overallAvg
        self.bestDay = bestDay
        self.trend = trend
        self.efficiencyUnit = efficiencyUnit
        self.distanceUnit = distanceUnit
    }

    /// Whether there is at least one daily point to chart (web `isEmpty` is the
    /// negation: `displayData.length === 0`).
    public var hasData: Bool {
        !points.isEmpty
    }

    /// The lowest daily value across both series, used to anchor the y-axis floor
    /// (web `domain={['dataMin - 20', …]}`). `nil` when there are no points.
    public var seriesMinimum: Double? {
        let values = points.flatMap { [$0.efficiency] + ($0.rollingAvg.map { [$0] } ?? []) }
        return values.min()
    }

    /// The highest daily value across both series, used to anchor the y-axis
    /// ceiling (web `domain={[…, 'dataMax + 20']}`). `nil` when there are no points.
    public var seriesMaximum: Double? {
        let values = points.flatMap { [$0.efficiency] + ($0.rollingAvg.map { [$0] } ?? []) }
        return values.max()
    }

    /// Empty projection (no rows resolved yet). Default unit mirrors the SI
    /// canonical distance label so a fresh projection reads sensibly.
    public static let empty = DriveEfficiencyProjection(
        points: [],
        overallAvg: nil,
        bestDay: nil,
        trend: nil,
        efficiencyUnit: "Wh/km",
        distanceUnit: "km"
    )
}
