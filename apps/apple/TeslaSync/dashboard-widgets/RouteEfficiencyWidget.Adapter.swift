//
//  RouteEfficiencyWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0082 · RouteEfficiencyWidget (Apple)
//
//  The testable projection core: cached route-summary DTOs → the view-ready ranked
//  rows, the efficiency-tier badge classifier (parity with the web `efficiencyBadge`),
//  the SI→display unit conversion (web `toEfficiencyDisplay`), and the VoiceOver
//  summary builder. All pure + dependency-light so the adapter can be unit-tested
//  without a store, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Distance preference (web `useUnits().unitPrefs.distance`)

/// The display distance preference that drives the efficiency unit + conversion,
/// mirroring the web `unitPrefs.distance === 'mi'` branch. Only the metric/imperial
/// split matters for efficiency, so the shared `DistanceUnitPref` (`km` | `mi` | `ft`)
/// collapses to these two cases — any non-`mi` label reads as kilometers, exactly like
/// the web equality check.
public enum RouteDistancePreference: Sendable, Equatable {
    case kilometers
    case miles

    /// Resolves a shared unit label (`km` / `mi` / `ft`) into the efficiency split,
    /// matching the web `unitPrefs.distance === 'mi'` test (only `mi` → imperial).
    public static func from(label: String) -> RouteDistancePreference {
        label.lowercased() == "mi" ? .miles : .kilometers
    }

    /// The efficiency unit suffix shown next to each value (web `efficiencyUnit`).
    public var efficiencyUnit: String {
        switch self {
        case .kilometers: "Wh/km"
        case .miles: "Wh/mi"
        }
    }

    /// Converts a raw SI efficiency (watt-hours per kilometer) into the display unit —
    /// web `toEfficiencyDisplay`: `whPerKm * 1.609344` for miles, identity otherwise.
    public func toDisplay(_ whPerKm: Double) -> Double {
        switch self {
        case .kilometers: whPerKm
        case .miles: whPerKm * 1.609344
        }
    }
}

// MARK: - Efficiency tier badge (web `efficiencyBadge`)

/// The efficiency-tier badge shown on each route row — the native port of the web
/// `efficiencyBadge`.
///
/// Parity note (no drift): the web classifier's parameter is named `rawWhPerMi`, but
/// it is *called* with the raw `avg_efficiency` (Wh/km, SI), so the 250/325/400
/// thresholds are applied to the **raw Wh/km** value. This port reproduces that exact
/// behavior — same thresholds, same raw input — so the tiers match the web 1:1.
public enum RouteEfficiencyBadge: Sendable, Equatable, CaseIterable {
    case excellent
    case good
    case fair
    case poor

    /// Classifies a raw SI efficiency (Wh/km) into a tier (web thresholds).
    public static func classify(rawWhPerKm: Double) -> RouteEfficiencyBadge {
        if rawWhPerKm <= 250 { return .excellent }
        if rawWhPerKm <= 325 { return .good }
        if rawWhPerKm <= 400 { return .fair }
        return .poor
    }

    /// The i18n key + web English fallback for the badge label.
    public var localization: (key: String, fallback: String) {
        switch self {
        case .excellent: ("widget.routeEfficiency.excellent", "Excellent")
        case .good: ("widget.routeEfficiency.good", "Good")
        case .fair: ("widget.routeEfficiency.fair", "Fair")
        case .poor: ("widget.routeEfficiency.poor", "Poor")
        }
    }

    /// The shared chip tone (web variant: excellent/good → success, fair → warning,
    /// poor → error/danger).
    public var tone: TSTone {
        switch self {
        case .excellent, .good: .success
        case .fair: .warning
        case .poor: .danger
        }
    }
}

// MARK: - Cached input (web `RouteSummary`)

/// One cached recurring route (web `RouteSummary`). Optional numerics mirror the web
/// `?? 0` / `?? Infinity` null-coalescing applied in the projection.
public struct RouteEfficiencyInput: Sendable, Equatable, Identifiable {
    public var id: Int
    public var startLocation: String?
    public var endLocation: String?
    public var avgEfficiency: Double?
    public var bestEfficiency: Double?
    public var worstEfficiency: Double?
    public var tripCount: Int?

    public init(
        id: Int,
        startLocation: String? = nil,
        endLocation: String? = nil,
        avgEfficiency: Double? = nil,
        bestEfficiency: Double? = nil,
        worstEfficiency: Double? = nil,
        tripCount: Int? = nil
    ) {
        self.id = id
        self.startLocation = startLocation
        self.endLocation = endLocation
        self.avgEfficiency = avgEfficiency
        self.bestEfficiency = bestEfficiency
        self.worstEfficiency = worstEfficiency
        self.tripCount = tripCount
    }
}

// MARK: - Projected row (web `RankedItem`)

/// One ranked route row the list renders — the native port of the web `RankedItem`
/// produced by the widget's `useMemo`. Carries the localized label + formatted value,
/// the inverted ranking `value` (lower Wh ⇒ higher value ⇒ ranks first), the tier
/// badge, and the `isBest` flag that tints the best route's bar.
public struct RouteEfficiencyRow: Identifiable, Equatable, Sendable {
    public let id: Int
    public let label: String
    public let value: Double
    public let formattedValue: String
    public let badge: RouteEfficiencyBadge
    public let isBest: Bool

    public init(
        id: Int,
        label: String,
        value: Double,
        formattedValue: String,
        badge: RouteEfficiencyBadge,
        isBest: Bool
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.formattedValue = formattedValue
        self.badge = badge
        self.isBest = isBest
    }
}

// MARK: - Projection builder (web widget `useMemo` + WidgetRankedList sort/slice)

/// Builds the ranked-row projection from the cached routes, reproducing the web
/// widget's `useMemo` (display conversion, inverted ranking value, formatted value,
/// tier badge, wide best/worst suffix) and the `WidgetRankedList` value-descending sort
/// + optional `maxItems` slice (compact 3 / standard 5). Pure + bundle-free: labels are
/// resolved through the injected `localize`, so it unit-tests without `.main`.
public enum RouteEfficiencyProjection {
    /// The em-dash sentinel the web uses for a missing start/end location.
    static let missingLabel = "—"

    public static func build(
        routes: [RouteEfficiencyInput],
        unit: RouteDistancePreference,
        isWide: Bool,
        limit: Int? = nil,
        localize: (String, String) -> String
    ) -> [RouteEfficiencyRow] {
        // web: bestRaw = Math.min(...routes.map(r => r.avgEfficiency ?? Infinity))
        let bestRaw = routes.map { $0.avgEfficiency ?? .infinity }.min() ?? .infinity

        let rows = routes.map { route -> RouteEfficiencyRow in
            let rawEff = route.avgEfficiency ?? 0
            let eff = unit.toDisplay(rawEff)
            let trips = route.tripCount ?? 0
            let isBest = rawEff == bestRaw && rawEff > 0

            var label = "\(route.startLocation ?? missingLabel) → \(route.endLocation ?? missingLabel)"
            if isWide {
                let bestEff = formatNumber(unit.toDisplay(route.bestEfficiency ?? 0))
                let worstEff = formatNumber(unit.toDisplay(route.worstEfficiency ?? 0))
                let bestLabel = localize("widget.routeEfficiency.best", "best")
                let worstLabel = localize("widget.routeEfficiency.worst", "worst")
                label += "  ·  \(bestLabel) \(bestEff) / \(worstLabel) \(worstEff) \(unit.efficiencyUnit)"
            }

            return RouteEfficiencyRow(
                id: route.id,
                label: label,
                value: eff > 0 ? 10000 / eff : 0,
                formattedValue: "\(formatNumber(eff)) \(unit.efficiencyUnit) · \(formatInt(trips))×",
                badge: RouteEfficiencyBadge.classify(rawWhPerKm: rawEff),
                isBest: isBest
            )
        }

        let sorted = rows.sorted { $0.value > $1.value }
        guard let limit else { return sorted }
        return Array(sorted.prefix(max(0, limit)))
    }

    /// Locale-aware integer-rounded number (web `fmtNumber(value, 0)`).
    static func formatNumber(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0)))
    }

    /// Locale-aware integer (web `fmtInt`).
    static func formatInt(_ value: Int) -> String {
        value.formatted(.number)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver string for a route row. Pure + public so the spoken content
/// can be unit-tested without rendering the view.
public enum RouteEfficiencyAccessibility {
    public static func rowSummary(
        rank: Int,
        row: RouteEfficiencyRow,
        localize: (String, String) -> String
    ) -> String {
        let badge = localize(row.badge.localization.key, row.badge.localization.fallback)
        return "\(rank). \(row.label). \(row.formattedValue). \(badge)"
    }
}
