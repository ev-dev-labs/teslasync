//
//  ProjectedRangeWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0074 · ProjectedRangeWidget (Apple)
//
//  The testable projection core: the cached `ProjectedRangeInput` DTO → the
//  view-ready `ProjectedRangeStats` (display-unit conversion, health-tier badge,
//  projected-vs-EPA ratio, the range-factor rows), the SI→display distance
//  conversion (parity with the web `convertDistanceFromSI`), the locale-aware
//  number formatter (web `fmtNumber`), and the VoiceOver summary builder. All pure
//  + dependency-free so the adapter can be unit-tested without a store, a bundle,
//  or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Distance conversion (web `convertDistanceFromSI`)

/// Converts the API's kilometre distances into the user's display unit, reproducing
/// the web path exactly: the payload is in km, promoted to SI metres (`× 1000`) and
/// then divided by the unit's metres-per-unit constant. Metric is the identity (km);
/// imperial divides metres by `1609.344` to yield miles.
public enum ProjectedRangeUnits {
    public static let metersPerKilometer = 1000.0
    public static let metersPerMile = 1609.344

    public static func distanceFromKilometers(_ kilometers: Double, system: MeasurementSystem) -> Double {
        let meters = kilometers * metersPerKilometer
        switch system {
        case .metric: return meters / metersPerKilometer
        case .imperial: return meters / metersPerMile
        }
    }
}

// MARK: - Number formatting (web `fmtNumber`)

/// Locale-aware fixed-precision decimal formatter mirroring the web `fmtNumber`
/// (`toLocaleString` with equal min/max fraction digits + grouping). `locale` is
/// injectable so tests stay deterministic regardless of the host locale.
public enum ProjectedRangeFormat {
    public static func number(
        _ value: Double,
        fractionDigits: Int,
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(fractionDigits)f", value)
    }
}

// MARK: - Health tier (web `healthBadge`)

/// The battery-health confidence tier projected from `health_score`, mapped to a
/// shared `TSTone` for the badge tint. Mirrors the web `healthBadge` thresholds
/// (≥90 Excellent, ≥70 Good, ≥50 Fair, else Poor) and their success/warning/error
/// variants.
public enum ProjectedRangeHealthTier: Sendable, Equatable, CaseIterable {
    case excellent
    case good
    case fair
    case poor

    /// The badge tint (web `variant` → `success | warning | error`).
    public var tone: TSTone {
        switch self {
        case .excellent, .good: .success
        case .fair: .warning
        case .poor: .danger
        }
    }

    /// The i18n key + web English fallback for the tier label.
    public var labelKey: String {
        switch self {
        case .excellent: "widget.projectedRange.excellent"
        case .good: "widget.projectedRange.good"
        case .fair: "widget.projectedRange.fair"
        case .poor: "widget.projectedRange.poor"
        }
    }

    public var labelFallback: String {
        switch self {
        case .excellent: "Excellent"
        case .good: "Good"
        case .fair: "Fair"
        case .poor: "Poor"
        }
    }

    /// Resolves the tier for a health score using the web thresholds.
    public static func tier(for score: Double) -> ProjectedRangeHealthTier {
        if score >= 90 { return .excellent }
        if score >= 70 { return .good }
        if score >= 50 { return .fair }
        return .poor
    }
}

// MARK: - Range factor (web wide-view `factors`)

/// One row in the wide-view "Range Factors" list — the native port of the web
/// `factors` entries, carrying the resolved (localized) label, the SF Symbol that
/// stands in for the web Lucide glyph, and the pre-formatted value string.
public struct ProjectedRangeFactor: Identifiable, Equatable, Sendable {
    public let id: String
    public let systemImage: String
    public let label: String
    public let value: String

    public init(id: String, systemImage: String, label: String, value: String) {
        self.id = id
        self.systemImage = systemImage
        self.label = label
        self.value = value
    }
}

// MARK: - Stats projection (web `useMemo` derivations)

/// The view-ready projection the compact / standard / wide layouts render, derived
/// from the cached `ProjectedRangeInput` + the active `MeasurementSystem`. Every
/// display string is pre-formatted here (web `fmtNumber` / `Math.round`) so the
/// views stay purely presentational and the whole projection is unit-testable.
public struct ProjectedRangeStats: Equatable, Sendable {
    public let projectedRange: Double?
    public let epaRange: Double?
    public let avgDaily: Double?
    public let healthScore: Double?
    public let healthTier: ProjectedRangeHealthTier?
    public let healthLabel: String?
    public let rangePct: Int?
    public let distanceUnit: String
    public let projectedDisplay: String?
    public let epaDisplay: String?
    public let healthScoreDisplay: String?
    public let factors: [ProjectedRangeFactor]

    public init(
        projectedRange: Double?,
        epaRange: Double?,
        avgDaily: Double?,
        healthScore: Double?,
        healthTier: ProjectedRangeHealthTier?,
        healthLabel: String?,
        rangePct: Int?,
        distanceUnit: String,
        projectedDisplay: String?,
        epaDisplay: String?,
        healthScoreDisplay: String?,
        factors: [ProjectedRangeFactor]
    ) {
        self.projectedRange = projectedRange
        self.epaRange = epaRange
        self.avgDaily = avgDaily
        self.healthScore = healthScore
        self.healthTier = healthTier
        self.healthLabel = healthLabel
        self.rangePct = rangePct
        self.distanceUnit = distanceUnit
        self.projectedDisplay = projectedDisplay
        self.epaDisplay = epaDisplay
        self.healthScoreDisplay = healthScoreDisplay
        self.factors = factors
    }

    /// The comparison-bar tint for a projected/EPA ratio (web inline style:
    /// ≥80% green, ≥60% amber, else red — `nil` reads as the red "below target"
    /// branch). Computed in the view so the `Sendable`/`Equatable` stats need not
    /// store a non-`Sendable` `TSTone`.
    public static func comparisonTone(rangePct: Int?) -> TSTone {
        guard let pct = rangePct else { return .danger }
        if pct >= 80 { return .success }
        if pct >= 60 { return .warning }
        return .danger
    }

    /// Projects the cached payload + units into the view stats, reproducing the web
    /// `useMemo` derivations (display conversion, EPA ratio, factor rows) and the
    /// `?? 0` fallbacks the factor values apply.
    public static func project(
        data: ProjectedRangeInput,
        units: MeasurementSystem,
        localize: (String, String) -> String = ProjectedRangeStrings.string,
        format: (Double, Int) -> String = { ProjectedRangeFormat.number($0, fractionDigits: $1) }
    ) -> ProjectedRangeStats {
        let unit = units.distanceLabel
        let projected = data.currentRangeKm.map { ProjectedRangeUnits.distanceFromKilometers($0, system: units) }
        let epa = data.newRangeKm.map { ProjectedRangeUnits.distanceFromKilometers($0, system: units) }
        let avgDaily = data.avgDailyKm.map { ProjectedRangeUnits.distanceFromKilometers($0, system: units) }
        let tier = data.healthScore.map(ProjectedRangeHealthTier.tier(for:))

        let rangePct: Int? = {
            guard let projected, let epa, epa > 0 else { return nil }
            return min(100, Int((projected / epa * 100).rounded()))
        }()

        let factors = [
            ProjectedRangeFactor(
                id: "degradation",
                systemImage: "gauge.medium",
                label: localize("widget.projectedRange.degradation", "Battery Degradation"),
                value: "\(format(data.degradationPct ?? 0, 1))%"
            ),
            ProjectedRangeFactor(
                id: "avgDaily",
                systemImage: "location.north.fill",
                label: localize("widget.projectedRange.avgDaily", "Avg Daily Usage"),
                value: "\(format(avgDaily ?? 0, 0)) \(unit)"
            ),
            ProjectedRangeFactor(
                id: "capacity",
                systemImage: "thermometer.medium",
                label: localize("widget.projectedRange.capacity", "Current Capacity"),
                value: "\(format(data.currentCapacityPct ?? 0, 1))%"
            ),
            ProjectedRangeFactor(
                id: "cycles",
                systemImage: "mountain.2.fill",
                label: localize("widget.projectedRange.cycles", "Battery Cycles"),
                value: format(data.totalCycles ?? 0, 0)
            )
        ]

        return ProjectedRangeStats(
            projectedRange: projected,
            epaRange: epa,
            avgDaily: avgDaily,
            healthScore: data.healthScore,
            healthTier: tier,
            healthLabel: tier.map { localize($0.labelKey, $0.labelFallback) },
            rangePct: rangePct,
            distanceUnit: unit,
            projectedDisplay: projected.map { format($0.rounded(), 0) },
            epaDisplay: epa.map { "\(format($0, 0)) \(unit)" },
            healthScoreDisplay: data.healthScore.map { "\(format($0, 0))%" },
            factors: factors
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the primary range readout. Pure + public
/// so the spoken content can be unit-tested without rendering the view.
public enum ProjectedRangeAccessibility {
    public static func summary(
        for stats: ProjectedRangeStats,
        localize: (String, String) -> String
    ) -> String {
        var parts = [localize("widget.projectedRange.title", "Projected Range")]
        if let projected = stats.projectedDisplay {
            parts.append("\(projected) \(stats.distanceUnit)")
        } else {
            parts.append(localize("widget.projectedRange.noData", "No projected range data"))
        }
        if let label = stats.healthLabel, let score = stats.healthScoreDisplay {
            parts.append("\(label), \(score)")
        }
        if let pct = stats.rangePct {
            parts.append("\(pct)% \(localize("widget.projectedRange.ofEpa", "of EPA rated"))")
        }
        return parts.joined(separator: ". ")
    }
}
