//
//  FleetStatsBarWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0050 · FleetStatsBarWidget (Apple)
//
//  Pure (Foundation-only) projection: cached `FleetStatsBarDTO` + `FleetStatsBarUnitPrefs`
//  → display strings, reproducing the web source's numeric pipeline VERBATIM so the native
//  surface shows the exact same values as features/dashboard/widgets/FleetStatsBarWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be compiled
//  and executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Distance conversion (ported 1:1 from lib/unitConversion.ts)

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in
/// lib/unitConversion.ts — a divide by the unit's metres-per-unit factor.
///
/// IMPORTANT parity note: the web `FleetStatsBarWidget` feeds this function the analytics
/// `total_distance_km` value DIRECTLY (`convertDistanceFromSI(analytics.total_distance_km, …)`)
/// — it does NOT pre-multiply by `KM_TO_MI` the way `LifetimeStatsWidget` does. We reproduce
/// that exact call chain (no "correction"), so a user with the web and native dashboards open
/// side by side sees identical numbers. See `FleetStatsBarProjector.project`.
func convertFleetStatsBarDistanceFromSI(_ value: Double, to unit: FleetStatsBarDistanceUnit) -> Double {
    let safe = value.isFinite ? value : 0
    return safe / unit.metersPerUnit
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware number formatting that mirrors the web `fmtNumber` (`Intl.NumberFormat` via
/// `Number.prototype.toLocaleString`) and the raw `{value}` rendering React performs for a
/// numeric `StatCard` value.
public enum FleetStatsBarFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away
    /// from zero to match `Intl.NumberFormat`'s default `halfExpand` (identical to half-up for
    /// the non-negative fleet totals this surface formats).
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

    /// The raw integer count rendering React performs for a numeric `StatCard` `value`
    /// (`{stats.vehicleCount}` → `String(n)`): no grouping separators, matching the web exactly.
    public static func count(_ value: Int) -> String {
        String(value)
    }

    /// `fmtNumber((online / total) * 100, 0) + '%'` — the web online-share string. Grouped,
    /// zero fraction digits (no grouping ever shows for a 0–100 percentage), with a `%` suffix.
    public static func percent(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier) + "%"
    }
}

// MARK: - Projected stat item (web `StatGridItem` / `StatCard`)

/// One projected stat tile: a localized label, a formatted value, an optional unit suffix and
/// an SF Symbol. Mirrors the web `StatGridItem` (`label`, `value`, `unit`, `icon`).
public struct FleetStatsBarStatItem: Identifiable, Equatable {
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
        FleetStatsBarStrings.string(labelKey, labelFallback)
    }
}

// MARK: - Projection

/// The fully-projected widget content: the four stat tiles plus the supporting online-share
/// figures (count + percent) the web computes for the `Vehicles`/`Online Now` tiles. Computed
/// once per snapshot by the model.
public struct FleetStatsBarProjection: Equatable {
    public let items: [FleetStatsBarStatItem]
    public let onlineCount: Int
    /// `vehicleCount > 0 ? fmtNumber(onlineShare, 0) + '%' : undefined` — nil when there are no
    /// vehicles to divide by, matching the web's `onlinePct` guard.
    public let onlinePercent: String?

    public init(
        items: [FleetStatsBarStatItem],
        onlineCount: Int,
        onlinePercent: String?
    ) {
        self.items = items
        self.onlineCount = onlineCount
        self.onlinePercent = onlinePercent
    }
}

/// Pure projector: `FleetStatsBarDTO` + `FleetStatsBarUnitPrefs` → `FleetStatsBarProjection`.
/// Every value is computed with the exact same arithmetic + formatting as the web widget.
public enum FleetStatsBarProjector {
    public static func project(stats: FleetStatsBarDTO, units: FleetStatsBarUnitPrefs) -> FleetStatsBarProjection {
        let locale = units.localeIdentifier

        // Distance pipeline, ported verbatim from the web source:
        //   totalDistance = convertDistanceFromSI(analytics.total_distance_km ?? 0, distancePref)
        // (NB: the km value is fed straight in — NO `* KM_TO_MI` — see the converter's note.)
        let displayDistance = convertFleetStatsBarDistanceFromSI(stats.totalDistanceKm, to: units.distance)
        let distanceSymbol = units.distance.symbol

        // Online share, ported verbatim:
        //   onlinePct = vehicleCount > 0 ? `${fmtNumber((online / vehicleCount) * 100, 0)}%` : undefined
        let onlinePercent: String? = stats.vehicleCount > 0
            ? FleetStatsBarFormat.percent(
                (Double(stats.onlineCount) / Double(stats.vehicleCount)) * 100,
                localeIdentifier: locale
            )
            : nil

        let items: [FleetStatsBarStatItem] = [
            FleetStatsBarStatItem(
                id: "vehicles",
                labelKey: "widget.fleetStatsBar.vehicles",
                labelFallback: "Vehicles",
                value: FleetStatsBarFormat.count(stats.vehicleCount),
                unit: nil,
                systemImage: "car.fill"
            ),
            FleetStatsBarStatItem(
                id: "online-now",
                labelKey: "widget.fleetStatsBar.onlineNow",
                labelFallback: "Online Now",
                value: FleetStatsBarFormat.count(stats.onlineCount),
                unit: nil,
                systemImage: "wifi"
            ),
            FleetStatsBarStatItem(
                id: "distance-30d",
                labelKey: "widget.fleetStatsBar.distance30d",
                labelFallback: "Distance (30d)",
                value: FleetStatsBarFormat.number(displayDistance, decimals: 1, localeIdentifier: locale),
                unit: distanceSymbol,
                systemImage: "road.lanes"
            ),
            FleetStatsBarStatItem(
                id: "energy-30d",
                labelKey: "widget.fleetStatsBar.energy30d",
                labelFallback: "Energy (30d)",
                value: FleetStatsBarFormat.number(stats.totalEnergyKwh, decimals: 1, localeIdentifier: locale),
                unit: "kWh",
                systemImage: "bolt.fill"
            )
        ]

        return FleetStatsBarProjection(
            items: items,
            onlineCount: stats.onlineCount,
            onlinePercent: onlinePercent
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the stat grid. Pure + public so the a11y label
/// content can be unit-tested without rendering the view. It surfaces the supporting
/// online-share figures (the web `Vehicles`/`Online Now` `trendValue`s — `"{n} online"` and the
/// online percent) that the web composition computes; on Apple they enrich the spoken label
/// rather than adding a visible row, keeping strict visual parity with the web grid.
public enum FleetStatsBarAccessibility {
    public static func summary(for projection: FleetStatsBarProjection) -> String {
        let title = FleetStatsBarStrings.string("widget.fleetStatsBar.title", "Fleet Stats")
        var parts = [title]
        for item in projection.items {
            if let unit = item.unit {
                parts.append("\(item.label) \(item.value) \(unit)")
            } else {
                parts.append("\(item.label) \(item.value)")
            }
        }
        let online = FleetStatsBarStrings.string("widget.fleetStatsBar.online", "online")
        parts.append("\(projection.onlineCount) \(online)")
        if let percent = projection.onlinePercent {
            parts.append(percent)
        }
        return parts.joined(separator: ". ")
    }
}
