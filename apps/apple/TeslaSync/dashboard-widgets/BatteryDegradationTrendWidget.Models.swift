//
//  BatteryDegradationTrendWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0012 · BatteryDegradationTrendWidget (Apple)
//
//  Domain value types ported from
//  features/dashboard/widgets/BatteryDegradationTrendWidget.tsx: the cached
//  monthly-trend row (web `DegradationTrend`), the degradation summary stats
//  (the predictive fields read off web `DegradationData`), the vehicle identity,
//  the projected chart point, and the merged projection the view renders. Pure
//  Foundation — no SwiftUI / transport.
//

import Foundation

// MARK: - Cached inputs (port of web `DegradationTrend` / `DegradationData`)

/// One month bucket from `GET /analytics/battery-degradation` `monthly_trend[]`
/// — a faithful Swift port of the web `DegradationTrend` (`types/energy.ts`).
/// `month` is the backend `TO_CHAR(…, 'YYYY-MM')` key (e.g. `"2026-04"`);
/// `avgHealth` is the state-of-health percentage (0…100) the chart plots;
/// `avgRange` is the estimated range in display units and `avgCapacity` the pack
/// capacity — carried for fidelity even though the trend line charts health.
public struct DegradationTrendRow: Sendable, Equatable {
    public var month: String
    public var avgHealth: Double
    public var avgCapacity: Double
    public var avgRange: Double

    public init(
        month: String,
        avgHealth: Double,
        avgCapacity: Double = 0,
        avgRange: Double = 0
    ) {
        self.month = month
        self.avgHealth = avgHealth
        self.avgCapacity = avgCapacity
        self.avgRange = avgRange
    }
}

/// The current-state degradation stats read off the top level of web
/// `DegradationData`. `currentHealthPct` mirrors `current_health_pct` and
/// `currentHealth` mirrors the legacy `current_health`; the widget resolves
/// state-of-health as `currentHealthPct ?? currentHealth` (web nullish-coalesce).
/// All fields are optional so a partial / missing response degrades to "—".
public struct DegradationSummary: Sendable, Equatable {
    public var currentHealthPct: Double?
    public var currentHealth: Double?
    public var degradationRatePctPerMonth: Double?
    public var currentCycles: Double?

    public init(
        currentHealthPct: Double? = nil,
        currentHealth: Double? = nil,
        degradationRatePctPerMonth: Double? = nil,
        currentCycles: Double? = nil
    ) {
        self.currentHealthPct = currentHealthPct
        self.currentHealth = currentHealth
        self.degradationRatePctPerMonth = degradationRatePctPerMonth
        self.currentCycles = currentCycles
    }

    /// Resolved state-of-health (web `current_health_pct ?? current_health`).
    public var resolvedHealth: Double? {
        currentHealthPct ?? currentHealth
    }

    public static let empty = DegradationSummary()
}

/// Minimal vehicle identity the widget needs (port of the web `useVehicles()`
/// first row — the widget only reads the id to scope the query, plus a name for
/// the optional accessibility context).
public struct DegradationVehicle: Sendable, Equatable {
    public var id: Int64
    public var displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }

    /// Trimmed display name, or `nil` when blank (web `vehicles?.[0]`).
    public var primaryName: String? {
        guard
            let name = displayName?.trimmingCharacters(in: .whitespacesAndNewlines),
            !name.isEmpty
        else {
            return nil
        }
        return name
    }
}

// MARK: - Projection (port of web `chartData` + the derived stat values)

/// One projected chart point — the Swift port of the web `chartData` entry: the
/// stable `"YYYY-MM"` key (chronological identity + axis domain), a short month
/// label for the axis tick (`"Apr"`), the plotted state-of-health percentage,
/// and the estimated range carried for the inspect tooltip / accessibility.
public struct DegradationTrendPoint: Sendable, Equatable, Identifiable {
    public var month: String
    public var monthLabel: String
    public var health: Double
    public var range: Double

    public init(month: String, monthLabel: String, health: Double, range: Double) {
        self.month = month
        self.monthLabel = monthLabel
        self.health = health
        self.range = range
    }

    public var id: String {
        month
    }
}

/// The merged projection the view switches over — the ordered trend points, the
/// derived SoH / degradation-rate / cycles stat values, the chart's lower health
/// bound (web y-domain `dataMin − 2`), whether there are enough points to draw a
/// trend (web `chartData.length > 1`), and whether the surface is empty (web
/// `currentHealth == null && chartData.length === 0`).
public struct BatteryDegradationProjection: Sendable, Equatable {
    public var points: [DegradationTrendPoint]
    public var currentHealth: Double?
    public var degradationRate: Double?
    public var cycles: Double?
    public var healthFloor: Double
    public var hasTrend: Bool
    public var isEmpty: Bool

    public init(
        points: [DegradationTrendPoint],
        currentHealth: Double?,
        degradationRate: Double?,
        cycles: Double?,
        healthFloor: Double,
        hasTrend: Bool,
        isEmpty: Bool
    ) {
        self.points = points
        self.currentHealth = currentHealth
        self.degradationRate = degradationRate
        self.cycles = cycles
        self.healthFloor = healthFloor
        self.hasTrend = hasTrend
        self.isEmpty = isEmpty
    }

    /// The reference-line threshold the web draws at 80% health (the warranty /
    /// end-of-useful-life marker, web `ReferenceLine y={80}`).
    public static let healthThreshold: Double = 80

    /// Empty projection (no rows resolved yet).
    public static let empty = BatteryDegradationProjection(
        points: [],
        currentHealth: nil,
        degradationRate: nil,
        cycles: nil,
        healthFloor: BatteryDegradationProjection.healthThreshold,
        hasTrend: false,
        isEmpty: true
    )
}
