//
//  RangeEstimateWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0077 · RangeEstimateWidget (Apple)
//
//  Pure (Foundation-only) projection: a cached `RangeStateDTO` + `RangeUnitPrefs`
//  → display strings, reproducing the web source's numeric pipeline VERBATIM so the
//  native surface shows the exact same values as
//  features/dashboard/widgets/RangeEstimateWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be
//  compiled and executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Distance conversion (ported 1:1 from web lib/unitConversion.ts)

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in
/// `lib/unitConversion.ts` — a divide by the unit's metres-per-unit factor. The web
/// widget feeds it `state.rated_range` / `state.ideal_range`, which arrive in METERS
/// (the SI-floor noted in the source), so this is a straight SI → display conversion.
/// Non-finite inputs collapse to 0 to match the web `safeNumber` guard upstream.
func convertRangeDistanceFromSI(_ meters: Double, to unit: RangeDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtNumber`)

/// Locale-aware decimal formatting that mirrors the web `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), rounding half
/// away from zero to match `Intl.NumberFormat`'s default `halfExpand`.
public enum RangeEstimateFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, half-away-from-zero.
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
}

// MARK: - Projected metric (web rated / ideal range block)

/// One projected range metric: a localized label, a formatted value, the distance unit
/// symbol and an emphasis flag. Mirrors the two `<div>` blocks the web source renders
/// (rated range — emphasized/accent; ideal range — primary).
public struct RangeMetric: Identifiable, Equatable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let unit: String
    public let emphasized: Bool

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        unit: String,
        emphasized: Bool
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.unit = unit
        self.emphasized = emphasized
    }

    /// The resolved (localized) label for display + accessibility.
    public var label: String {
        RangeEstimateStrings.string(labelKey, labelFallback)
    }
}

// MARK: - Projection

/// The fully-projected widget content: the rated + ideal metrics and the shared distance
/// symbol. Computed once per snapshot by the model so the view stays declarative.
public struct RangeEstimateProjection: Equatable {
    public let rated: RangeMetric
    public let ideal: RangeMetric
    public let distanceSymbol: String

    public init(rated: RangeMetric, ideal: RangeMetric, distanceSymbol: String) {
        self.rated = rated
        self.ideal = ideal
        self.distanceSymbol = distanceSymbol
    }

    /// Both metrics in source order (rated, then ideal).
    public var metrics: [RangeMetric] {
        [rated, ideal]
    }
}

/// Pure projector: `RangeStateDTO` + `RangeUnitPrefs` → `RangeEstimateProjection`. Every
/// value is computed with the exact same arithmetic + formatting as the web widget:
/// `fmtNumber(convertDistanceFromSI(meters ?? 0, unit), 0)`.
public enum RangeEstimateProjector {
    public static func project(state: RangeStateDTO, units: RangeUnitPrefs) -> RangeEstimateProjection {
        let locale = units.localeIdentifier
        let symbol = units.distance.symbol

        let ratedDisplay = convertRangeDistanceFromSI(state.ratedRangeMeters ?? 0, to: units.distance)
        let idealDisplay = convertRangeDistanceFromSI(state.idealRangeMeters ?? 0, to: units.distance)

        let rated = RangeMetric(
            id: "rated-range",
            labelKey: "widget.ratedRange",
            labelFallback: "Rated Range",
            value: RangeEstimateFormat.number(ratedDisplay, decimals: 0, localeIdentifier: locale),
            unit: symbol,
            emphasized: true
        )
        let ideal = RangeMetric(
            id: "ideal-range",
            labelKey: "widget.idealRange",
            labelFallback: "Ideal Range",
            value: RangeEstimateFormat.number(idealDisplay, decimals: 0, localeIdentifier: locale),
            unit: symbol,
            emphasized: false
        )

        return RangeEstimateProjection(rated: rated, ideal: ideal, distanceSymbol: symbol)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the range block. Pure + public so the a11y
/// label content can be unit-tested without rendering the view.
public enum RangeEstimateAccessibility {
    /// One spoken clause per metric, e.g. "Range Estimate. Rated Range 405 km. Ideal Range 450 km".
    public static func summary(for projection: RangeEstimateProjection) -> String {
        let title = RangeEstimateStrings.string("widget.rangeEstimate.title", "Range Estimate")
        var parts = [title]
        for metric in projection.metrics {
            parts.append("\(metric.label) \(metric.value) \(metric.unit)")
        }
        return parts.joined(separator: ". ")
    }
}
