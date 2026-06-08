//
//  WeeklySummaryCardWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0117 · WeeklySummaryCardWidget (Apple)
//
//  Shared-free domain value types for the WeeklySummaryCardWidget surface: the
//  cached weekly-digest DTO inputs, the user's distance preference + display
//  prefs, the week-over-week trend descriptor, the computed projection, and the
//  locale-aware number formatter. No SwiftUI / transport here — these are the
//  pure, unit-tested inputs/outputs of the cached → projection adapter that both
//  platforms agree on.
//
//  Parity target: features/dashboard/widgets/WeeklySummaryCardWidget.tsx.
//

import Foundation

// MARK: - Distance unit preference (port of web `DistanceUnitPref`)

/// The user's distance display unit, mirroring the web `DistanceUnitPref`
/// (`'km' | 'mi' | 'ft'`). Carries the SI divisor used by `convertDistanceFromSI`
/// so the projection math agrees with the web exactly, and drives the
/// efficiency unit label (`Wh/mi` vs `Wh/km`).
public enum WeeklyDistanceUnit: String, Sendable, Equatable, CaseIterable {
    case kilometers = "km"
    case miles = "mi"
    case feet = "ft"

    /// Resolves a stored preference label (`"km"`, `"mi"`, `"ft"`) to a unit,
    /// defaulting to kilometers (SI) for unknown labels — matching the metric
    /// default the shared `UnitPref` falls back to.
    public static func fromLabel(_ label: String?) -> WeeklyDistanceUnit {
        guard let label else { return .kilometers }
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return WeeklyDistanceUnit(rawValue: trimmed) ?? .kilometers
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

    /// The short unit symbol shown next to distances (`km` / `mi` / `ft`).
    public var symbol: String {
        rawValue
    }

    /// The efficiency unit label the web derives from the distance preference
    /// (`unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`).
    public var efficiencyLabel: String {
        self == .miles ? "Wh/mi" : "Wh/km"
    }
}

// MARK: - Cached DTO input (port of web `WeeklyDigestData`)

/// The cached `/vehicles/{id}/weekly-digest` payload this surface consumes,
/// mirroring the web `WeeklyDigestData` interface 1:1. Distance is the backend's
/// kilometres, energy is kWh, efficiency is Wh/km, cost is in the user's
/// currency. The `prev*` members are last week's values for the trend chips.
public struct WeeklySummaryCardWidgetDigestDTO: Sendable, Equatable {
    public var drives: Int
    public var distanceKm: Double
    public var energyKwh: Double
    public var cost: Double
    public var efficiency: Double
    public var prevDrives: Int
    public var prevDistanceKm: Double
    public var prevEnergyKwh: Double
    public var prevCost: Double
    public var prevEfficiency: Double

    public init(
        drives: Int = 0,
        distanceKm: Double = 0,
        energyKwh: Double = 0,
        cost: Double = 0,
        efficiency: Double = 0,
        prevDrives: Int = 0,
        prevDistanceKm: Double = 0,
        prevEnergyKwh: Double = 0,
        prevCost: Double = 0,
        prevEfficiency: Double = 0
    ) {
        self.drives = drives
        self.distanceKm = distanceKm
        self.energyKwh = energyKwh
        self.cost = cost
        self.efficiency = efficiency
        self.prevDrives = prevDrives
        self.prevDistanceKm = prevDistanceKm
        self.prevEnergyKwh = prevEnergyKwh
        self.prevCost = prevCost
        self.prevEfficiency = prevEfficiency
    }
}

/// The user's display preferences, mirroring `useUnits()` + `useFormatting()`.
/// The view never reads settings directly; the source resolves these and pushes
/// them with each snapshot.
public struct WeeklyUnitPrefs: Sendable, Equatable {
    public var distance: WeeklyDistanceUnit
    public var currencySymbol: String
    public var precision: Int
    public var localeIdentifier: String

    public init(
        distance: WeeklyDistanceUnit = .kilometers,
        currencySymbol: String = "$",
        precision: Int = 2,
        localeIdentifier: String = "en_US"
    ) {
        self.distance = distance
        self.currencySymbol = currencySymbol
        self.precision = precision
        self.localeIdentifier = localeIdentifier
    }
}

/// The minimal vehicle reference the widget needs to scope its query, mirroring
/// the web `vehicleId ?? vehicles?.[0]?.id ?? 0` default-selection fallback.
public struct WeeklyVehicleRef: Sendable, Equatable {
    public var id: Int64
    public var displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Trend descriptor (port of web `trendOf` result)

/// The direction arrow a trend chip shows, mirroring the web
/// `direction: 'up' | 'down' | 'flat'`.
public enum WeeklyTrendDirection: String, Sendable, Equatable {
    case up
    case down
    case flat
}

/// One week-over-week trend chip, the Swift parity of the web `trendOf` result
/// `{ direction, value, positive? }`. `positive` is `nil` for a flat trend
/// (no semantic colour); otherwise it drives the success/danger colour while
/// `direction` drives the arrow — exactly as the web `StatCard` renders it.
public struct WeeklyTrend: Sendable, Equatable {
    public var direction: WeeklyTrendDirection
    public var value: String
    public var positive: Bool?

    public init(direction: WeeklyTrendDirection, value: String, positive: Bool? = nil) {
        self.direction = direction
        self.value = value
        self.positive = positive
    }
}

// MARK: - Raw metrics (verbatim web `metrics` memo)

/// The raw, display-unit numbers the web `metrics` memo computes (before
/// formatting). Kept as a distinct value so the adapter's verbatim port of the
/// web arithmetic can be pinned by unit tests independently of string
/// formatting. `drives` is carried for parity with the web memo even though the
/// web JSX does not render it.
public struct WeeklyMetrics: Sendable, Equatable {
    public var distance: Double
    public var prevDistance: Double
    public var energy: Double
    public var prevEnergy: Double
    public var cost: Double
    public var prevCost: Double
    public var efficiency: Double
    public var prevEfficiency: Double
    public var drives: Int
    public var prevDrives: Int

    public init(
        distance: Double,
        prevDistance: Double,
        energy: Double,
        prevEnergy: Double,
        cost: Double,
        prevCost: Double,
        efficiency: Double,
        prevEfficiency: Double,
        drives: Int,
        prevDrives: Int
    ) {
        self.distance = distance
        self.prevDistance = prevDistance
        self.energy = energy
        self.prevEnergy = prevEnergy
        self.cost = cost
        self.prevCost = prevCost
        self.efficiency = efficiency
        self.prevEfficiency = prevEfficiency
        self.drives = drives
        self.prevDrives = prevDrives
    }
}

// MARK: - Projection (the adapter output the view renders)

/// The fully-formatted, display-ready projection the view renders. Every value
/// is already converted + formatted in the user's units so the SwiftUI layer
/// performs no math — it only lays out. This is the output asserted by the
/// adapter tests for parity with the web computation.
public struct WeeklySummaryProjection: Sendable, Equatable {
    /// Distance formatted to 1 fraction digit (the standard `StatCard` value).
    public var distanceValue: String
    /// Distance formatted to 0 fraction digits (the compact hero value).
    public var distanceCompactValue: String
    /// The distance unit symbol (`km` / `mi` / `ft`).
    public var distanceUnit: String
    public var distanceTrend: WeeklyTrend

    /// Energy formatted to 1 fraction digit, shown with the `kWh` unit.
    public var energyValue: String
    public var energyTrend: WeeklyTrend

    /// Cost formatted as currency (symbol + precision).
    public var costValue: String
    public var costTrend: WeeklyTrend

    /// Efficiency formatted to 0 fraction digits, shown with `efficiencyUnit`.
    public var efficiencyValue: String
    public var efficiencyUnit: String
    public var efficiencyTrend: WeeklyTrend

    public init(
        distanceValue: String,
        distanceCompactValue: String,
        distanceUnit: String,
        distanceTrend: WeeklyTrend,
        energyValue: String,
        energyTrend: WeeklyTrend,
        costValue: String,
        costTrend: WeeklyTrend,
        efficiencyValue: String,
        efficiencyUnit: String,
        efficiencyTrend: WeeklyTrend
    ) {
        self.distanceValue = distanceValue
        self.distanceCompactValue = distanceCompactValue
        self.distanceUnit = distanceUnit
        self.distanceTrend = distanceTrend
        self.energyValue = energyValue
        self.energyTrend = energyTrend
        self.costValue = costValue
        self.costTrend = costTrend
        self.efficiencyValue = efficiencyValue
        self.efficiencyUnit = efficiencyUnit
        self.efficiencyTrend = efficiencyTrend
    }
}

// MARK: - Number formatting (port of web `fmtNumber` / `fmtPercent` / `formatCurrency`)

/// Locale-aware decimal / percent / currency formatting mirroring the web
/// `fmtNumber(v, decimals)` (`toLocaleString` with fixed fraction digits +
/// grouping), `fmtPercent(v, 0)` (`fmtNumber + '%'`) and
/// `useFormatting().formatCurrency` (`symbol + fmtNumber(amount, precision)`).
/// Ties round away from zero to match the JS `halfExpand` default; non-finite
/// inputs collapse to 0 like the web `safeNumber`.
public enum WeeklyNumberFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped.
    public static func number(
        _ value: Double,
        fractionDigits: Int,
        localeIdentifier: String = "en_US"
    ) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, fractionDigits)
        formatter.maximumFractionDigits = max(0, fractionDigits)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe))
            ?? String(format: "%.\(max(0, fractionDigits))f", safe)
    }

    /// `fmtPercent(v, 0)` — `fmtNumber(v, 0) + '%'`.
    public static func percent(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, fractionDigits: 0, localeIdentifier: localeIdentifier) + "%"
    }

    /// `formatCurrency(amount)` — `currencySymbol + fmtNumber(amount, precision)`.
    public static func currency(
        _ amount: Double,
        symbol: String,
        precision: Int,
        localeIdentifier: String = "en_US"
    ) -> String {
        symbol + number(amount, fractionDigits: precision, localeIdentifier: localeIdentifier)
    }
}
