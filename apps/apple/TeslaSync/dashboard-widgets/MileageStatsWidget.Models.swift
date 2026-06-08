//
//  MileageStatsWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0064 · MileageStatsWidget (Apple)
//
//  Shared-free domain value types for the MileageStatsWidget surface: the
//  cached DTO inputs, the user's distance preference, the computed projection,
//  and the locale-aware number formatter. No SwiftUI / transport here — these
//  are the pure, unit-tested inputs/outputs of the cached → projection adapter.
//

import Foundation

// MARK: - Distance unit preference (port of web `DistanceUnitPref`)

/// The user's distance display unit, mirroring the web `DistanceUnitPref`
/// (`'km' | 'mi' | 'ft'`). Carries the SI divisor used by
/// `convertDistanceFromSI` so the projection math agrees with the web exactly.
public enum MileageDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// Resolves a stored preference label (`"km"`, `"mi"`, `"ft"`) to a unit,
    /// defaulting to kilometers (SI) for unknown labels — matching the metric
    /// default the shared `UnitPref` falls back to.
    public static func fromLabel(_ label: String?) -> MileageDistanceUnit {
        guard let label else { return .kilometers }
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return MileageDistanceUnit(rawValue: trimmed) ?? .kilometers
    }

    /// Meters per one unit — the divisor in `meters / metersPerUnit`
    /// (`METERS_PER_KM` / `METERS_PER_MILE` / `METERS_PER_FOOT`).
    public var metersPerUnit: Double {
        switch self {
        case .kilometers: 1000
        case .miles: 1609.344
        case .feet: 0.3048
        }
    }

    /// The short unit symbol shown next to values (`km` / `mi` / `ft`).
    public var symbol: String {
        rawValue
    }
}

// MARK: - Cached DTO input (subset of web `MileageStats`)

/// The cached `/mileage/stats` fields this surface consumes, in the backend's
/// kilometres. Mirrors the two `MileageStats` members the web widget reads
/// (`lifetime_km`, `last_30d_km`); the rolling 30-day window drives the daily
/// average and the lifetime total drives the milestone projection.
public struct MileageStatsInput: Sendable, Equatable {
    public var lifetimeKm: Double
    public var last30dKm: Double

    public init(lifetimeKm: Double = 0, last30dKm: Double = 0) {
        self.lifetimeKm = lifetimeKm
        self.last30dKm = last30dKm
    }
}

/// The minimal vehicle reference the widget needs to scope its query, mirroring
/// the `useVehicles()[0]` fallback the web widget uses to pick a default id.
public struct MileageVehicleRef: Sendable, Equatable {
    public var id: Int64
    public var displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Projection (the adapter output the view renders)

/// The fully-computed, display-unit projection the view renders. Every value is
/// already converted into the user's `unit` so the SwiftUI layer performs no
/// unit math — it only formats. This is the output asserted by the adapter
/// tests for parity with the web computation.
public struct MileageStatsProjection: Sendable, Equatable {
    public var unit: MileageDistanceUnit
    public var totalDisplay: Double
    public var dailyAvgDisplay: Double
    public var weeklyAvgDisplay: Double
    public var monthlyAvgDisplay: Double
    public var milestone: Double
    public var remaining: Double
    public var monthsToMilestone: Int

    public init(
        unit: MileageDistanceUnit,
        totalDisplay: Double,
        dailyAvgDisplay: Double,
        weeklyAvgDisplay: Double,
        monthlyAvgDisplay: Double,
        milestone: Double,
        remaining: Double,
        monthsToMilestone: Int
    ) {
        self.unit = unit
        self.totalDisplay = totalDisplay
        self.dailyAvgDisplay = dailyAvgDisplay
        self.weeklyAvgDisplay = weeklyAvgDisplay
        self.monthlyAvgDisplay = monthlyAvgDisplay
        self.milestone = milestone
        self.remaining = remaining
        self.monthsToMilestone = monthsToMilestone
    }
}

// MARK: - Number formatting (port of web `fmtNumber` / `fmtInt`)

/// Locale-aware decimal formatting mirroring the web `fmtNumber(v, decimals)`
/// (`toLocaleString` with fixed fraction digits + grouping). Ties round away
/// from zero to match the JS `halfExpand` default. The web global locale
/// default is `en-US`; callers may override per-call.
public enum MileageNumberFormat {
    /// Formats with a fixed number of fraction digits and grouping separators.
    public static func decimal(
        _ value: Double,
        fractionDigits: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.roundingMode = .halfUp
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.usesGroupingSeparator = true
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(fractionDigits)f", safe)
    }

    /// Integer formatting with grouping (web `fmtInt`).
    public static func integer(_ value: Double, locale: Locale = Locale(identifier: "en-US")) -> String {
        decimal(value, fractionDigits: 0, locale: locale)
    }
}
