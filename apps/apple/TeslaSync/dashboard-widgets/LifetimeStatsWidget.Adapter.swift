//
//  LifetimeStatsWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0055 · LifetimeStatsWidget (Apple)
//
//  Pure (Foundation-only) projection: cached `LifetimeStatsDTO` + `LifetimeUnitPrefs`
//  → display strings, reproducing the web source's numeric pipeline VERBATIM so the
//  native surface shows the exact same values as features/dashboard/widgets/LifetimeStatsWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be
//  compiled and executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Conversion constants (ported from web lib/constants.ts + lib/unitConversion.ts)

private enum LifetimeStatsConstants {
    /// `UNITS.KM_TO_MI` from lib/constants.ts. Used by the web widget to turn the API's
    /// kilometres into the codebase's internal miles before display conversion.
    static let kmToMile = 0.621371
}

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in
/// lib/unitConversion.ts — a divide by the unit's metres-per-unit factor.
///
/// The web widget feeds this function a value already expressed in miles
/// (`total_distance_km * KM_TO_MI`), matching the source's `displayDistance` computation
/// exactly. We reproduce that call chain verbatim for cross-platform value parity rather
/// than "correcting" it, so a user with the web and native dashboards open side by side
/// sees identical numbers. See `LifetimeStatsProjector.project`.
func convertLifetimeDistanceFromSI(_ value: Double, to unit: LifetimeDistanceUnit) -> Double {
    let safe = value.isFinite ? value : 0
    return safe / unit.metersPerUnit
}

// MARK: - Number / currency formatting (ported from web lib/numberFormat.ts + useFormatting.ts)

/// Locale-aware number + currency formatting that mirrors the web `fmtNumber` / `fmtInt`
/// (`Intl.NumberFormat`) and `useFormatting().formatCurrency` (`symbol + fmtNumber`).
public enum LifetimeStatsWidgetFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away
    /// from zero to match `Intl.NumberFormat`'s default `halfExpand`.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// `fmtInt(v)` — `fmtNumber(v, 0)`.
    public static func integer(_ value: Int, localeIdentifier: String = "en_US") -> String {
        number(Double(value), decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// `formatCurrency(amount)` — `currencySymbol + fmtNumber(amount, precision)`.
    public static func currency(
        _ amount: Double,
        symbol: String,
        precision: Int,
        localeIdentifier: String = "en_US"
    ) -> String {
        symbol + number(amount, decimals: precision, localeIdentifier: localeIdentifier)
    }
}

// MARK: - Projected stat item (web `StatGridItem` / `StatCard`)

/// One projected stat tile: a localized label, a formatted value, an optional unit suffix and
/// an SF Symbol. Mirrors the web `StatGridItem` (`label`, `value`, `unit`, `icon`).
public struct LifetimeStatItem: Identifiable, Equatable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let unit: String?
    public let systemImage: String

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        unit: String?,
        systemImage: String
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.unit = unit
        self.systemImage = systemImage
    }

    /// The resolved (localized) label for display + accessibility.
    public var label: String {
        LifetimeStatsStrings.string(labelKey, labelFallback)
    }
}

// MARK: - Projection

/// The fully-projected widget content for every layout: the core stats (standard), the extra
/// wide stats, and the compact big-number value. Computed once per snapshot by the model.
public struct LifetimeStatsProjection: Equatable {
    public let coreStats: [LifetimeStatItem]
    public let wideStats: [LifetimeStatItem]
    public let compactValue: String
    public let distanceSymbol: String

    public init(
        coreStats: [LifetimeStatItem],
        wideStats: [LifetimeStatItem],
        compactValue: String,
        distanceSymbol: String
    ) {
        self.coreStats = coreStats
        self.wideStats = wideStats
        self.compactValue = compactValue
        self.distanceSymbol = distanceSymbol
    }

    /// The stats shown for a given grid width: wide layouts append `wideStats`.
    public func stats(isWide: Bool) -> [LifetimeStatItem] {
        isWide ? coreStats + wideStats : coreStats
    }
}

/// Pure projector: `LifetimeStatsDTO` + `LifetimeUnitPrefs` → `LifetimeStatsProjection`.
/// Every value is computed with the exact same arithmetic + formatting as the web widget.
public enum LifetimeStatsProjector {
    public static func project(stats: LifetimeStatsDTO, units: LifetimeUnitPrefs) -> LifetimeStatsProjection {
        let locale = units.localeIdentifier

        // Distance pipeline, ported verbatim from the web source:
        //   distanceMi      = total_distance_km * KM_TO_MI
        //   displayDistance = convertDistanceFromSI(distanceMi, unitPrefs.distance)
        let distanceMi = stats.totalDistanceKm * LifetimeStatsConstants.kmToMile
        let displayDistance = convertLifetimeDistanceFromSI(distanceMi, to: units.distance)
        let distanceSymbol = units.distance.symbol

        let distanceValue = LifetimeStatsWidgetFormat.number(displayDistance, decimals: 0, localeIdentifier: locale)

        let coreStats = makeCoreStats(
            stats: stats,
            locale: locale,
            distanceValue: distanceValue,
            distanceSymbol: distanceSymbol
        )

        // Avg daily distance, ported verbatim:
        //   avgDailyMi = ownership_days > 0 ? distanceMi / ownership_days : 0
        let avgDailyMi = stats.ownershipDays > 0 ? distanceMi / Double(stats.ownershipDays) : 0
        let avgDailyDisplay = convertLifetimeDistanceFromSI(avgDailyMi, to: units.distance)

        let wideStats: [LifetimeStatItem] = [
            LifetimeStatItem(
                id: "total-cost",
                labelKey: "widget.lifetimeStats.totalCost",
                labelFallback: "Total Cost",
                value: LifetimeStatsWidgetFormat.currency(
                    stats.totalChargingCost,
                    symbol: units.currencySymbol,
                    precision: units.precision,
                    localeIdentifier: locale
                ),
                unit: nil,
                systemImage: "dollarsign.circle.fill"
            ),
            LifetimeStatItem(
                id: "ownership-days",
                labelKey: "widget.lifetimeStats.ownershipDays",
                labelFallback: "Ownership Days",
                value: LifetimeStatsWidgetFormat.integer(stats.ownershipDays, localeIdentifier: locale),
                unit: nil,
                systemImage: "calendar"
            ),
            LifetimeStatItem(
                id: "avg-daily-distance",
                labelKey: "widget.lifetimeStats.avgDailyDistance",
                labelFallback: "Avg Daily Distance",
                value: LifetimeStatsWidgetFormat.number(avgDailyDisplay, decimals: 1, localeIdentifier: locale),
                unit: distanceSymbol,
                systemImage: "road.lanes"
            )
        ]

        return LifetimeStatsProjection(
            coreStats: coreStats,
            wideStats: wideStats,
            compactValue: distanceValue,
            distanceSymbol: distanceSymbol
        )
    }

    private static func makeCoreStats(
        stats: LifetimeStatsDTO,
        locale: String,
        distanceValue: String,
        distanceSymbol: String
    ) -> [LifetimeStatItem] {
        [
            LifetimeStatItem(
                id: "total-distance",
                labelKey: "widget.lifetimeStats.totalDistance",
                labelFallback: "Total Distance",
                value: distanceValue,
                unit: distanceSymbol,
                systemImage: "road.lanes"
            ),
            LifetimeStatItem(
                id: "total-drives",
                labelKey: "widget.lifetimeStats.totalDrives",
                labelFallback: "Total Drives",
                value: LifetimeStatsWidgetFormat.integer(stats.totalDrives, localeIdentifier: locale),
                unit: nil,
                systemImage: "car.fill"
            ),
            LifetimeStatItem(
                id: "total-energy",
                labelKey: "widget.lifetimeStats.totalEnergy",
                labelFallback: "Total Energy",
                value: LifetimeStatsWidgetFormat.number(stats.totalEnergyKwh, decimals: 1, localeIdentifier: locale),
                unit: "kWh",
                systemImage: "bolt.fill"
            ),
            LifetimeStatItem(
                id: "co2-saved",
                labelKey: "widget.lifetimeStats.co2Saved",
                labelFallback: "CO₂ Saved",
                value: LifetimeStatsWidgetFormat.number(stats.co2OffsetKg, decimals: 0, localeIdentifier: locale),
                unit: "kg",
                systemImage: "leaf.fill"
            )
        ]
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the stat grid. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum LifetimeStatsAccessibility {
    /// One spoken sentence per visible stat, e.g. "Total Distance 31 km. Total Drives 1,234. …",
    /// prefixed by the surface title.
    public static func summary(for projection: LifetimeStatsProjection, isWide: Bool) -> String {
        let title = LifetimeStatsStrings.string("widget.lifetimeStats.title", "Lifetime Stats")
        var parts = [title]
        for item in projection.stats(isWide: isWide) {
            if let unit = item.unit {
                parts.append("\(item.label) \(item.value) \(unit)")
            } else {
                parts.append("\(item.label) \(item.value)")
            }
        }
        return parts.joined(separator: ". ")
    }
}
