//
//  DriveScoreWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0040 · DriveScoreWidget (Apple)
//
//  The testable projection core: the cached fleet-analytics snapshot → the view-ready
//  gauge readout. It reproduces the web widget's three derivations, 1:1 with
//  features/dashboard/widgets/DriveScoreWidget.tsx:
//    • SI→display efficiency conversion (web `toEfficiencyDisplay`: ×1.609344 for miles).
//    • efficiency→score formula (web `Math.min(100, Math.round((250 / efficiency) * 100))`).
//    • score→color band (web `score > 75 ? green : score > 50 ? amber : red`).
//  Plus the VoiceOver summary builder. Everything here is pure + dependency-light so it
//  unit-tests without a store, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Distance preference (web `useUnits().unitPrefs.distance`)

/// The display distance preference that drives the efficiency unit + conversion,
/// mirroring the web `unitPrefs.distance === 'mi'` branch. Only the metric/imperial
/// split matters for efficiency, so the shared distance label (`km` | `mi` | `ft`)
/// collapses to these two cases — any non-`mi` label reads as kilometers, exactly like
/// the web equality check.
public enum DriveScoreDistancePreference: Sendable, Equatable {
    case kilometers
    case miles

    /// Resolves a shared unit label (`km` / `mi` / `ft`) into the efficiency split,
    /// matching the web `unitPrefs.distance === 'mi'` test (only `mi` → imperial).
    public static func from(label: String) -> DriveScoreDistancePreference {
        label.lowercased() == "mi" ? .miles : .kilometers
    }

    /// The efficiency unit suffix shown beneath the gauge (web `efficiencyUnit`).
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

// MARK: - Score band (web gauge color thresholds)

/// The score-quality band that tints the gauge arc — the native port of the web
/// gauge `color: score > 75 ? '#10b981' : score > 50 ? '#f59e0b' : '#ef4444'`. The web
/// conveys the band purely by color; the native surface additionally speaks it through
/// VoiceOver via `localization`.
public enum DriveScoreBand: Sendable, Equatable, CaseIterable {
    case strong
    case fair
    case weak

    /// Classifies a 0...100 score into the web color band: `> 75` green (strong),
    /// `> 50` amber (fair), else red (weak).
    public static func classify(score: Int) -> DriveScoreBand {
        if score > 75 { return .strong }
        if score > 50 { return .fair }
        return .weak
    }

    /// The shared chip/gauge tone (web `#10b981`/`#f59e0b`/`#ef4444` →
    /// success/warning/danger), so light/dark/high-contrast theming keeps working.
    public var tone: TSTone {
        switch self {
        case .strong: .success
        case .fair: .warning
        case .weak: .danger
        }
    }

    /// The i18n key + English fallback for the spoken quality word (VoiceOver only).
    public var localization: (key: String, fallback: String) {
        switch self {
        case .strong: ("widget.driveScore.bandStrong", "strong score")
        case .fair: ("widget.driveScore.bandFair", "fair score")
        case .weak: ("widget.driveScore.bandWeak", "score needs improvement")
        }
    }
}

// MARK: - Cached input (web `analytics` from useFleetAnalytics)

/// One cached fleet-analytics snapshot (web `analytics`). Only the SI efficiency drives
/// this surface; the optional mirrors the web `analytics?.avg_efficiency_wh_km ?? 0`
/// null-coalescing applied in the projection. The presence of the value object itself
/// (vs `nil` in the update) is what distinguishes the content state from empty.
public struct DriveScoreInput: Sendable, Equatable {
    public var avgEfficiencyWhKm: Double?

    public init(avgEfficiencyWhKm: Double? = nil) {
        self.avgEfficiencyWhKm = avgEfficiencyWhKm
    }
}

// MARK: - Projected readout (web gauge + stat)

/// The fully-derived gauge readout the view renders — the native port of the web
/// `gauge` (`GaugeHeroConfig`) + the single `stat` (`GaugeHeroStat`). Carries the
/// integer score, its color band, the gauge-center string, and the formatted efficiency
/// stat with its unit suffix.
public struct DriveScoreReadout: Sendable, Equatable {
    public let score: Int
    public let band: DriveScoreBand
    public let formattedScore: String
    public let efficiencyDisplay: Double
    public let formattedEfficiency: String
    public let efficiencyUnit: String

    public init(
        score: Int,
        band: DriveScoreBand,
        formattedScore: String,
        efficiencyDisplay: Double,
        formattedEfficiency: String,
        efficiencyUnit: String
    ) {
        self.score = score
        self.band = band
        self.formattedScore = formattedScore
        self.efficiencyDisplay = efficiencyDisplay
        self.formattedEfficiency = formattedEfficiency
        self.efficiencyUnit = efficiencyUnit
    }
}

// MARK: - Projection (web widget useMemo)

/// Builds the gauge readout from a cached analytics snapshot, reproducing the web
/// widget's derivations (efficiency `?? 0`, the 250-reference score formula, the
/// display conversion, the color band, and the integer-rounded formatting). Pure +
/// bundle-free so it unit-tests without `.main`.
public enum DriveScoreProjection {
    /// The web score reference constant — `250 / efficiency * 100`. A vehicle at exactly
    /// 250 Wh/km scores 100; lower Wh/km saturates at 100, higher scales down.
    public static let referenceEfficiencyWhKm = 250.0

    /// The web score ceiling — `Math.min(100, …)`.
    public static let maxScore = 100

    /// Derives the 0...100 driving score from raw SI efficiency, mirroring the web
    /// `efficiency > 0 ? Math.min(100, Math.round((250 / efficiency) * 100)) : 0`.
    /// Lower Wh/km ⇒ higher score; a non-positive efficiency yields 0. The cap is
    /// applied in `Double` space before the `Int` cast so an arbitrarily small positive
    /// efficiency can never overflow the integer.
    public static func score(fromEfficiencyWhKm efficiency: Double) -> Int {
        guard efficiency > 0 else { return 0 }
        let rounded = ((referenceEfficiencyWhKm / efficiency) * 100).rounded()
        return Int(min(Double(maxScore), rounded))
    }

    /// Builds the full gauge readout from the cached analytics snapshot + unit
    /// preference. A `nil`/missing efficiency coalesces to 0 (web `?? 0`), which yields
    /// a 0 score in the "weak" band — still the content state, never empty.
    public static func build(
        analytics: DriveScoreInput,
        unit: DriveScoreDistancePreference
    ) -> DriveScoreReadout {
        let efficiency = analytics.avgEfficiencyWhKm ?? 0
        let scoreValue = score(fromEfficiencyWhKm: efficiency)
        let display = unit.toDisplay(efficiency)
        return DriveScoreReadout(
            score: scoreValue,
            band: DriveScoreBand.classify(score: scoreValue),
            formattedScore: formatInt(scoreValue),
            efficiencyDisplay: display,
            formattedEfficiency: formatNumber(display),
            efficiencyUnit: unit.efficiencyUnit
        )
    }

    /// Locale-aware integer-rounded number (web `fmtNumber(value, 0)`).
    static func formatNumber(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0)))
    }

    /// Locale-aware integer (web `fmtNumber(score, 0)` over an integer score).
    static func formatInt(_ value: Int) -> String {
        value.formatted(.number)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver string for the gauge hero. Pure + public so the spoken content
/// can be unit-tested without rendering the view.
public enum DriveScoreAccessibility {
    public static func gaugeSummary(
        readout: DriveScoreReadout,
        scoreLabel: String,
        efficiencyLabel: String,
        band: String
    ) -> String {
        "\(scoreLabel): \(readout.formattedScore) / \(DriveScoreProjection.maxScore). "
            + "\(band). "
            + "\(efficiencyLabel): \(readout.formattedEfficiency) \(readout.efficiencyUnit)."
    }
}
