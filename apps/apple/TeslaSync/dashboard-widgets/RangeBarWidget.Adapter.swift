//
//  RangeBarWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0076 · RangeBarWidget (Apple)
//
//  Pure (Foundation-only) projection: a cached `RangeBarStateDTO` + `RangeBarUnitPrefs`
//  → display strings + bar fractions, reproducing the web source's numeric pipeline
//  VERBATIM so the native surface shows the exact same values as
//  features/dashboard/widgets/RangeBarWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting + bar math can
//  be compiled and executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Distance conversion (ported 1:1 from web lib/unitConversion.ts)

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in
/// `lib/unitConversion.ts` — a divide by the unit's metres-per-unit factor. The web
/// widget feeds it `state.rated_range` / `state.ideal_range`, which arrive in METERS
/// (the SI-floor noted in the source), so this is a straight SI → display conversion.
/// Non-finite inputs collapse to 0 to match the web `safeNumber` guard upstream.
func convertRangeBarDistanceFromSI(_ meters: Double, to unit: RangeBarDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtNumber`)

/// Locale-aware decimal formatting that mirrors the web `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), rounding half
/// away from zero to match `Intl.NumberFormat`'s default `halfExpand`.
public enum RangeBarFormat {
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

// MARK: - Bar tone (web MetricBar `color`)

/// The semantic color slot for a bar, mapped to the web hex palette at the SwiftUI boundary
/// (rated → `#22d3ee`, ideal → `#a78bfa`). Kept SwiftUI-free so the projection stays testable.
public enum RangeBarTone: String, Equatable, Sendable {
    case rated
    case ideal
}

// MARK: - Projected bar (web `MetricBar`)

/// One projected horizontal bar: a localized label, the formatted value + unit, the readout
/// `sublabel` the web passes (`"{value} {unit}"`), the fill `fraction` (0…1, the web
/// `value / max`), and the `tone`. Mirrors the two `MetricBar`s the web source renders.
public struct RangeBarMetric: Identifiable, Equatable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let valueText: String
    public let unit: String
    public let sublabel: String
    public let fraction: Double
    public let tone: RangeBarTone

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        valueText: String,
        unit: String,
        sublabel: String,
        fraction: Double,
        tone: RangeBarTone
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.valueText = valueText
        self.unit = unit
        self.sublabel = sublabel
        self.fraction = fraction
        self.tone = tone
    }

    /// The resolved (localized) label for display + accessibility.
    public var label: String {
        RangeBarStrings.string(labelKey, labelFallback)
    }
}

// MARK: - EPA variance (web `epaComparison` block)

/// The EPA-variance readout shown when both ranges are positive: a pre-signed percent string
/// (`"+11.1%"` / `"-10.0%"`) plus the sign for tone. Mirrors the web
/// `{ideal >= rated ? '+' : ''}{fmtNumber(((ideal - rated) / rated) * 100, 1)}%`.
public struct RangeBarVariance: Equatable {
    public let percentText: String
    public let isPositive: Bool

    public init(percentText: String, isPositive: Bool) {
        self.percentText = percentText
        self.isPositive = isPositive
    }
}

// MARK: - Projection

/// The fully-projected widget content: the rated + ideal bars, the optional EPA variance, the
/// compact headline value (`fmtNumber(ratedConverted, 0)`) and the shared distance symbol.
/// Computed once per snapshot by the model so the view stays declarative.
public struct RangeBarProjection: Equatable {
    public let rated: RangeBarMetric
    public let ideal: RangeBarMetric
    public let variance: RangeBarVariance?
    public let compactValueText: String
    public let distanceSymbol: String

    public init(
        rated: RangeBarMetric,
        ideal: RangeBarMetric,
        variance: RangeBarVariance?,
        compactValueText: String,
        distanceSymbol: String
    ) {
        self.rated = rated
        self.ideal = ideal
        self.variance = variance
        self.compactValueText = compactValueText
        self.distanceSymbol = distanceSymbol
    }

    /// Both bars in source order (rated, then ideal).
    public var metrics: [RangeBarMetric] {
        [rated, ideal]
    }
}

/// Pure projector: `RangeBarStateDTO` + `RangeBarUnitPrefs` → `RangeBarProjection`. Every value
/// is computed with the exact same arithmetic + formatting as the web widget.
public enum RangeBarProjector {
    /// The web `hasData = state != null && (rated > 0 || ideal > 0)` guard. The DTO already
    /// encodes "state present"; this adds the "has a positive range" requirement.
    public static func hasData(state: RangeBarStateDTO) -> Bool {
        (state.ratedRangeMeters ?? 0) > 0 || (state.idealRangeMeters ?? 0) > 0
    }

    public static func project(state: RangeBarStateDTO, units: RangeBarUnitPrefs) -> RangeBarProjection {
        let locale = units.localeIdentifier
        let symbol = units.distance.symbol

        // SI meters (web `state.rated_range ?? 0` / `state.ideal_range ?? 0`).
        let ratedMeters = state.ratedRangeMeters ?? 0
        let idealMeters = state.idealRangeMeters ?? 0
        // web `maxRange = Math.max(rated, ideal, 1)` — the shared bar denominator.
        let maxMeters = max(ratedMeters, idealMeters, 1)

        // Bar fill: web `pct = min((converted / maxConverted) * 100, 100)`. Conversion is a
        // linear divide, so the SI ratio is identical and avoids float drift.
        let ratedFraction = min(ratedMeters / maxMeters, 1)
        let idealFraction = min(idealMeters / maxMeters, 1)

        let ratedDisplay = convertRangeBarDistanceFromSI(ratedMeters, to: units.distance)
        let idealDisplay = convertRangeBarDistanceFromSI(idealMeters, to: units.distance)
        let ratedValue = RangeBarFormat.number(ratedDisplay, decimals: 0, localeIdentifier: locale)
        let idealValue = RangeBarFormat.number(idealDisplay, decimals: 0, localeIdentifier: locale)

        let rated = RangeBarMetric(
            id: "rated-range",
            labelKey: "widget.ratedRange",
            labelFallback: "Rated Range",
            valueText: ratedValue,
            unit: symbol,
            sublabel: "\(ratedValue) \(symbol)",
            fraction: ratedFraction,
            tone: .rated
        )
        let ideal = RangeBarMetric(
            id: "ideal-range",
            labelKey: "widget.idealRange",
            labelFallback: "Ideal Range",
            valueText: idealValue,
            unit: symbol,
            sublabel: "\(idealValue) \(symbol)",
            fraction: idealFraction,
            tone: .ideal
        )

        return RangeBarProjection(
            rated: rated,
            ideal: ideal,
            variance: variance(ratedMeters: ratedMeters, idealMeters: idealMeters, localeIdentifier: locale),
            compactValueText: ratedValue,
            distanceSymbol: symbol
        )
    }

    /// web EPA-variance block — rendered only when `rated > 0 && ideal > 0`. The percentage is a
    /// ratio so it is unit-independent; the `'+'` is added for non-negative deltas (the `'-'`
    /// comes from the formatter), matching `ideal >= rated ? '+' : ''`.
    private static func variance(
        ratedMeters: Double,
        idealMeters: Double,
        localeIdentifier: String
    ) -> RangeBarVariance? {
        guard ratedMeters > 0, idealMeters > 0 else { return nil }
        let percent = ((idealMeters - ratedMeters) / ratedMeters) * 100
        let isPositive = idealMeters >= ratedMeters
        let sign = isPositive ? "+" : ""
        let text = "\(sign)\(RangeBarFormat.number(percent, decimals: 1, localeIdentifier: localeIdentifier))%"
        return RangeBarVariance(percentText: text, isPositive: isPositive)
    }
}

// MARK: - Layout (web `isCompact`)

/// The web `isCompact = size.cols === 1 && size.rows === 1`. Kept as a pure helper so the
/// layout rule is unit-testable and the SwiftUI view stays declarative. The canonical registry
/// min size is 1×2, so a registered/clamped instance never satisfies this (the bars always
/// render) — exactly matching the web grid, which also enforces the 1×2 minimum.
public enum RangeBarLayout {
    public static func isCompact(cols: Int, rows: Int) -> Bool {
        cols == 1 && rows == 1
    }
}

// MARK: - Bar fill percent (accessibility value)

/// Whole-percent string for a bar's accessibility value (e.g. "90%"), clamped to 0…100. Pure so
/// the spoken value can be unit-tested without rendering the SwiftUI bar.
public enum RangeBarMeterPercent {
    public static func value(_ fraction: Double) -> String {
        let clamped = min(max(fraction, 0), 1)
        return "\(Int((clamped * 100).rounded()))%"
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the range block. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum RangeBarAccessibility {
    /// One spoken clause per bar plus the variance, e.g.
    /// "Range. Rated Range 405 km. Ideal Range 450 km. EPA variance +11.1%".
    public static func summary(for projection: RangeBarProjection) -> String {
        let title = RangeBarStrings.string("widget.rangeBar", "Range")
        var parts = [title]
        for metric in projection.metrics {
            parts.append("\(metric.label) \(metric.sublabel)")
        }
        if let variance = projection.variance {
            let epa = RangeBarStrings.string("widget.epaComparison", "EPA variance")
            parts.append("\(epa) \(variance.percentText)")
        }
        return parts.joined(separator: ". ")
    }
}
