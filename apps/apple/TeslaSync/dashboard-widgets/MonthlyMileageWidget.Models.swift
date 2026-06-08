//
//  MonthlyMileageWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0065 · MonthlyMileageWidget (Apple)
//
//  Domain value types ported from features/dashboard/widgets/MonthlyMileageWidget.tsx:
//  the cached month bucket DTO, the vehicle identity, the projected bar, and the
//  merged projection the view renders. Pure Foundation — no SwiftUI / transport.
//

import Foundation

// MARK: - Cached inputs (port of web MonthlyMileageBucket)

/// One UTC calendar-month bucket from `GET /mileage/monthly` — a faithful Swift
/// port of the web `MonthlyMileageBucket` (`types/analytics.ts`). Distances are
/// kilometres (the backend converts from SI at the SELECT list); `yearMonth` is
/// rendered `'YYYY-MM'`; energy is watt-hours.
public struct MileageMonthRow: Sendable, Equatable {
    public var yearMonth: String
    public var driveCount: Int
    public var totalKm: Double
    public var totalWhConsumed: Double?
    public var avgEfficiencyWhPerKm: Double?

    public init(
        yearMonth: String,
        driveCount: Int = 0,
        totalKm: Double = 0,
        totalWhConsumed: Double? = nil,
        avgEfficiencyWhPerKm: Double? = nil
    ) {
        self.yearMonth = yearMonth
        self.driveCount = driveCount
        self.totalKm = totalKm
        self.totalWhConsumed = totalWhConsumed
        self.avgEfficiencyWhPerKm = avgEfficiencyWhPerKm
    }
}

/// Minimal vehicle identity the widget needs (port of the web `useVehicles()`
/// first row — the widget only reads the id to scope the query, plus a name for
/// the optional footer/accessibility).
public struct MileageVehicle: Sendable, Equatable {
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

// MARK: - Projection (port of web `BarDatum` + the derived stat values)

/// One projected bar — the Swift port of the web `BarDatum`: a short month label
/// (`"Apr"`), the stable `'YYYY-MM'` key, the display-converted distance, and
/// whether it is the current calendar month (highlighted in the chart).
public struct MileageBar: Sendable, Equatable, Identifiable {
    public var month: String
    public var yearMonth: String
    public var distance: Double
    public var isCurrent: Bool

    public init(month: String, yearMonth: String, distance: Double, isCurrent: Bool) {
        self.month = month
        self.yearMonth = yearMonth
        self.distance = distance
        self.isCurrent = isCurrent
    }

    public var id: String {
        yearMonth
    }
}

/// The merged projection the view switches over — the last ≤12 months of bars,
/// the derived "This Month" and "12-Mo Total" distances, the active display unit
/// label, and whether there is any non-zero data to chart (web `hasData`).
public struct MonthlyMileageProjection: Sendable, Equatable {
    public var bars: [MileageBar]
    public var currentMonthDistance: Double
    public var total12mDistance: Double
    public var distanceUnit: String
    public var hasData: Bool

    public init(
        bars: [MileageBar],
        currentMonthDistance: Double,
        total12mDistance: Double,
        distanceUnit: String,
        hasData: Bool
    ) {
        self.bars = bars
        self.currentMonthDistance = currentMonthDistance
        self.total12mDistance = total12mDistance
        self.distanceUnit = distanceUnit
        self.hasData = hasData
    }

    /// Empty projection (no rows resolved yet). Default unit mirrors the SI
    /// canonical distance label so a fresh projection reads sensibly.
    public static let empty = MonthlyMileageProjection(
        bars: [],
        currentMonthDistance: 0,
        total12mDistance: 0,
        distanceUnit: "km",
        hasData: false
    )
}
