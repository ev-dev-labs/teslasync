//
//  DrivingCoachSection.Projection.swift
//  TeslaSync — P4 feature view · 0167 · DrivingCoachSection (Apple)
//
//  The projected, view-ready output types for the "Driving Coach" section (the score gauge model, the
//  style-breakdown split + legend, the threshold pattern bars, the weekly-trend line series, the
//  recommendation rows, and the per-drive score rows), the diagnostics surface slug, and the VoiceOver
//  summary builders. Foundation-only so it executes on a plain host and is pinned by tests. The pure
//  projection that fills these in lives in DrivingCoachSection.Adapter.swift.
//

import Foundation

// MARK: - Score gauge (web `RadialGauge value={overall_score} max={100}`)

/// The resolved score-gauge model: the raw score, its display text, the clamped 0...1 ring fraction, and
/// the colour band. The view layers the SwiftUI ring + centred readout + "Driving Score" label on top.
public struct DrivingCoachGauge: Sendable, Equatable {
    public var score: Double
    public var scoreText: String
    public var fraction: Double
    public var band: DrivingCoachBand

    public init(score: Double, scoreText: String, fraction: Double, band: DrivingCoachBand) {
        self.score = score
        self.scoreText = scoreText
        self.fraction = fraction
        self.band = band
    }

    public static let zero = DrivingCoachGauge(score: 0, scoreText: "0", fraction: 0, band: .bad)
}

// MARK: - Style breakdown (web split bar + legend)

/// One coloured segment of the style split bar (web `style_breakdown` segment): the style it represents and
/// its share of the analysed drives as a clamped 0...1 fraction. Only segments with a positive share are
/// projected (web `if (pct <= 0) return null`).
public struct DrivingCoachStyleSegment: Sendable, Equatable, Identifiable {
    public var style: DrivingCoachStyle
    public var fraction: Double

    public var id: String {
        style.rawValue
    }

    public init(style: DrivingCoachStyle, fraction: Double) {
        self.style = style
        self.fraction = fraction
    }
}

/// One legend row beneath the split bar (web legend): the style and its drive count. All three styles are
/// always present (web maps the fixed `[efficient, moderate, aggressive]` list).
public struct DrivingCoachStyleLegendRow: Sendable, Equatable, Identifiable {
    public var style: DrivingCoachStyle
    public var count: Int

    public var id: String {
        style.rawValue
    }

    public init(style: DrivingCoachStyle, count: Int) {
        self.style = style
        self.count = count
    }
}

/// The resolved style-breakdown panel (web `coachData.total_drives_analyzed > 0 ? bar+legend : EmptyState`):
/// the data flag, the positive bar segments, and the always-present legend rows.
public struct DrivingCoachStyleBreakdownVM: Sendable, Equatable {
    public var hasData: Bool
    public var segments: [DrivingCoachStyleSegment]
    public var legend: [DrivingCoachStyleLegendRow]

    public init(
        hasData: Bool,
        segments: [DrivingCoachStyleSegment],
        legend: [DrivingCoachStyleLegendRow]
    ) {
        self.hasData = hasData
        self.segments = segments
        self.legend = legend
    }

    public static let empty = DrivingCoachStyleBreakdownVM(hasData: false, segments: [], legend: [])
}

// MARK: - Pattern bar (web `patterns.map` threshold bars)

/// One driving-pattern threshold bar (web `patterns` entry): its label (i18n key + web fallback), the
/// formatted percentage text, the clamped 0...1 fill fraction (web `min(100, value)`), and the colour band
/// derived from the per-pattern `lo` / `hi` thresholds.
public struct DrivingCoachPatternRow: Sendable, Equatable, Identifiable {
    public var labelKey: String
    public var labelFallback: String
    public var valueText: String
    public var fraction: Double
    public var band: DrivingCoachBand

    public var id: String {
        labelKey
    }

    public init(
        labelKey: String,
        labelFallback: String,
        valueText: String,
        fraction: Double,
        band: DrivingCoachBand
    ) {
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.valueText = valueText
        self.fraction = fraction
        self.band = band
    }
}

// MARK: - Weekly trend point (web `LineChart` datum)

/// One weekly-trend line point (web `weekly_trend` datum): the week label (x) and the clamped 0-100 score
/// (y). Projected slim so the chart is a pure function of this series.
public struct DrivingCoachTrendPoint: Sendable, Equatable, Identifiable {
    public var week: String
    public var score: Double

    public var id: String {
        week
    }

    public init(week: String, score: Double) {
        self.week = week
        self.score = score
    }
}

// MARK: - Recommendation row (web `recommendations.map`)

/// One recommendation row (web `recommendations` entry): the impact (for the badge + band) and the tip copy
/// rendered verbatim. The impact label resolves through the i18n facade at the view boundary.
public struct DrivingCoachRecommendationRow: Sendable, Equatable, Identifiable {
    public var id: Int
    public var impact: DrivingCoachImpact
    public var tip: String

    public var band: DrivingCoachBand {
        impact.band
    }

    public init(id: Int, impact: DrivingCoachImpact, tip: String) {
        self.id = id
        self.impact = impact
        self.tip = tip
    }
}

// MARK: - Per-drive score row (web `DataTable` row)

/// One per-drive score row (web `CoachDriveScore` rendered by `DataTable`): the formatted date, the score
/// (raw + text + band for the badge), the style (+ band), and the formatted efficiency / distance. The raw
/// numeric fields back the sortable column comparators.
public struct DrivingCoachDriveRow: Sendable, Equatable, Identifiable {
    public var id: Int
    public var dateText: String
    public var dateSortValue: Double
    public var score: Double
    public var scoreText: String
    public var scoreBand: DrivingCoachBand
    public var style: DrivingCoachStyle
    public var efficiency: Double
    public var efficiencyText: String
    public var distance: Double
    public var distanceText: String

    public var styleBand: DrivingCoachBand {
        style.band
    }

    public init(
        id: Int,
        dateText: String,
        dateSortValue: Double,
        score: Double,
        scoreText: String,
        scoreBand: DrivingCoachBand,
        style: DrivingCoachStyle,
        efficiency: Double,
        efficiencyText: String,
        distance: Double,
        distanceText: String
    ) {
        self.id = id
        self.dateText = dateText
        self.dateSortValue = dateSortValue
        self.score = score
        self.scoreText = scoreText
        self.scoreBand = scoreBand
        self.style = style
        self.efficiency = efficiency
        self.efficiencyText = efficiencyText
        self.distance = distance
        self.distanceText = distanceText
    }
}

// MARK: - Whole-section projection

/// The whole projected section: the score gauge, the analysed-drive count, the style breakdown, the avg /
/// best efficiency readouts, the threshold pattern bars, the weekly-trend series, the recommendation rows,
/// and the per-drive score rows. Each `has*` flag reproduces the corresponding web panel's inner empty
/// branch.
public struct DrivingCoachSectionProjection: Sendable, Equatable {
    public var gauge: DrivingCoachGauge
    public var drivesAnalyzed: Int
    public var styleBreakdown: DrivingCoachStyleBreakdownVM
    public var avgEfficiencyText: String
    public var bestEfficiencyText: String
    public var patterns: [DrivingCoachPatternRow]
    public var trend: [DrivingCoachTrendPoint]
    public var recommendations: [DrivingCoachRecommendationRow]
    public var perDriveRows: [DrivingCoachDriveRow]

    public init(
        gauge: DrivingCoachGauge,
        drivesAnalyzed: Int,
        styleBreakdown: DrivingCoachStyleBreakdownVM,
        avgEfficiencyText: String,
        bestEfficiencyText: String,
        patterns: [DrivingCoachPatternRow],
        trend: [DrivingCoachTrendPoint],
        recommendations: [DrivingCoachRecommendationRow],
        perDriveRows: [DrivingCoachDriveRow]
    ) {
        self.gauge = gauge
        self.drivesAnalyzed = drivesAnalyzed
        self.styleBreakdown = styleBreakdown
        self.avgEfficiencyText = avgEfficiencyText
        self.bestEfficiencyText = bestEfficiencyText
        self.patterns = patterns
        self.trend = trend
        self.recommendations = recommendations
        self.perDriveRows = perDriveRows
    }

    /// Whether the weekly-trend line renders (web `weekly_trend.length > 1`).
    public var hasTrend: Bool {
        trend.count > 1
    }

    /// Whether the recommendations list renders (web `recommendations.length > 0`).
    public var hasRecommendations: Bool {
        !recommendations.isEmpty
    }

    /// Whether the per-drive table renders (web `per_drive_scores.length > 0`).
    public var hasPerDrive: Bool {
        !perDriveRows.isEmpty
    }

    /// The placeholder projection used for the loading / empty chrome (all-zero gauge + bars). // parity:allow ui
    public static let empty = DrivingCoachSectionProjection(
        gauge: .zero,
        drivesAnalyzed: 0,
        styleBreakdown: .empty,
        avgEfficiencyText: "",
        bestEfficiencyText: "",
        patterns: [],
        trend: [],
        recommendations: [],
        perDriveRows: []
    )
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free core so it
/// is reachable from the projection's unit tests.
public enum DrivingCoachSectionSurface {
    public static let slug = "DrivingCoachSection"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly like the view's
/// P1/S10 facade.
public enum DrivingCoachSectionAccessibility {
    /// The score-gauge spoken label: "Driving Score, {value}".
    public static func gaugeLabel(
        for gauge: DrivingCoachGauge,
        localize: (String, String) -> String
    ) -> String {
        "\(localize("dynamics.coach.overallScore", "Driving Score")), \(gauge.scoreText)"
    }

    /// The section-level summary spoken for the whole surface: the "Driving Coach" title, the score, and the
    /// number of analysed drives.
    public static func sectionSummary(
        for projection: DrivingCoachSectionProjection,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("dynamics.coach.title", "Driving Coach")
        let score = gaugeLabel(for: projection.gauge, localize: localize)
        let drives = String(
            format: localize("dynamics.coach.drivesAnalyzed", "%lld drives analyzed"),
            projection.drivesAnalyzed
        )
        return [title, score, drives].joined(separator: ". ")
    }
}
