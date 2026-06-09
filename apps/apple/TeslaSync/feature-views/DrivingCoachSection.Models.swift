//
//  DrivingCoachSection.Models.swift
//  TeslaSync — P4 feature view · 0167 · DrivingCoachSection (Apple)
//
//  The Foundation-only value types for the driving-dynamics "Driving Coach" section: the inbound coach
//  payload (the web `DrivingCoachData` prop), its sub-shapes (patterns / style breakdown / weekly trend /
//  recommendations / per-drive scores), the colour-band classifiers, the injected pre-localized copy, and
//  the phase / status / connection enums. Free of SwiftUI so the projection logic compiles and tests on a
//  plain host. Parity target:
//  features/driving/components/driving-dynamics/DrivingCoachSection.tsx.
//
//  Unit note: the web source renders these numbers VERBATIM — efficiency in "Wh/km" and distance in "km"
//  exactly as the analytics API delivers them (the coach endpoint pre-aggregates into those display
//  fields, `efficiency_wh_km` / `distance`), so no SI conversion happens at this leaf. The native port
//  reproduces that contract; the unit glyphs are injected as localized copy rather than hardcoded.
//

import Foundation

// MARK: - Colour band (shared green / amber / red classifier)

/// The three semantic bands the coach surface maps a value onto. SwiftUI-free so the threshold logic is
/// host-testable; the view maps the band to the `Color.TS.status*` tokens (ADR-006 semantic mapping of the
/// web `#22c55e` / `#f59e0b` / `#ef4444`).
public enum DrivingCoachBand: String, Sendable, Equatable, CaseIterable {
    case good
    case warn
    case bad

    /// Web overall-score colour rule (`>= 75` green, `>= 50` amber, else red). A non-finite score collapses
    /// to the worst band (JS `NaN >= 75` is `false` all the way down).
    public static func score(_ value: Double) -> DrivingCoachBand {
        guard value.isFinite else { return .bad }
        if value >= 75 { return .good }
        if value >= 50 { return .warn }
        return .bad
    }

    /// Web pattern colour rule (`value <= lo` green, `value <= hi` amber, else red).
    public static func pattern(value: Double, lo: Double, hi: Double) -> DrivingCoachBand {
        guard value.isFinite else { return .bad }
        if value <= lo { return .good }
        if value <= hi { return .warn }
        return .bad
    }
}

// MARK: - Driving style (web per-drive `style` + style-breakdown keys)

/// A drive's coaching style — the native mirror of the web `'efficient' | 'moderate' | 'aggressive'`.
/// Unknown / missing strings fall back to `moderate` (the neutral middle band), so a malformed row never
/// crashes the table.
public enum DrivingCoachStyle: String, Sendable, Equatable, CaseIterable {
    case efficient
    case moderate
    case aggressive

    /// The localization key suffix the web builds (`dynamics.coach.style.${key}`).
    public var key: String {
        rawValue
    }

    /// The score band the web maps each style onto for the row badge (efficient → success, moderate →
    /// warning, aggressive → danger).
    public var band: DrivingCoachBand {
        switch self {
        case .efficient: .good
        case .moderate: .warn
        case .aggressive: .bad
        }
    }

    /// Tolerant parse of the API string (web reads the raw `style` field). Unknown ⇒ `moderate`.
    public static func parse(_ raw: String) -> DrivingCoachStyle {
        DrivingCoachStyle(rawValue: raw.lowercased()) ?? .moderate
    }
}

// MARK: - Recommendation impact (web `'high' | 'medium' | 'low'`)

/// A recommendation's impact — the native mirror of the web `rec.impact`. Drives the row badge tone (web
/// high → danger, medium → warning, low → success). Unknown ⇒ `low` (the least-alarming band).
public enum DrivingCoachImpact: String, Sendable, Equatable, CaseIterable {
    case high
    case medium
    case low

    /// The badge band the web maps the impact onto.
    public var band: DrivingCoachBand {
        switch self {
        case .high: .bad
        case .medium: .warn
        case .low: .good
        }
    }

    /// Tolerant parse of the API string. Unknown ⇒ `low`.
    public static func parse(_ raw: String) -> DrivingCoachImpact {
        DrivingCoachImpact(rawValue: raw.lowercased()) ?? .low
    }
}

// MARK: - Pattern percentages (web `coachData.patterns`)

/// The five driving-pattern percentages the web charts as threshold bars (web `CoachPatterns`). Each is a
/// 0-100 percentage; the projector pairs them with the web's per-pattern `lo` / `hi` thresholds.
public struct DrivingCoachPatterns: Sendable, Equatable {
    public var hardAccelPct: Double
    public var hardBrakePct: Double
    public var highwayPct: Double
    public var shortTripPct: Double
    public var coldStartPct: Double

    public init(
        hardAccelPct: Double = 0,
        hardBrakePct: Double = 0,
        highwayPct: Double = 0,
        shortTripPct: Double = 0,
        coldStartPct: Double = 0
    ) {
        self.hardAccelPct = hardAccelPct
        self.hardBrakePct = hardBrakePct
        self.highwayPct = highwayPct
        self.shortTripPct = shortTripPct
        self.coldStartPct = coldStartPct
    }

    /// All-zero patterns (the web `?? 0` fallback when `coachData` is absent).
    public static let zero = DrivingCoachPatterns()
}

// MARK: - Style breakdown (web `coachData.style_breakdown` record)

/// The per-style drive counts the web reads from `style_breakdown[key]` for the split bar + legend. Modeled
/// as the three known buckets the web iterates (`['efficient', 'moderate', 'aggressive']`).
public struct DrivingCoachStyleBreakdown: Sendable, Equatable {
    public var efficient: Int
    public var moderate: Int
    public var aggressive: Int

    public init(efficient: Int = 0, moderate: Int = 0, aggressive: Int = 0) {
        self.efficient = efficient
        self.moderate = moderate
        self.aggressive = aggressive
    }

    /// The count for a given style bucket (web `style_breakdown[style] ?? 0`).
    public func count(for style: DrivingCoachStyle) -> Int {
        switch style {
        case .efficient: efficient
        case .moderate: moderate
        case .aggressive: aggressive
        }
    }
}

// MARK: - Weekly trend point (web `coachData.weekly_trend[]`)

/// One weekly-trend sample (web `CoachWeeklyTrend`): the ISO-week label and that week's average coach
/// score, plus the efficiency / drive count the upstream carries (unused by the line chart but kept for
/// payload fidelity).
public struct DrivingCoachWeeklyPoint: Sendable, Equatable, Identifiable {
    public var week: String
    public var score: Double
    public var efficiency: Double
    public var drives: Int

    public var id: String {
        week
    }

    public init(week: String, score: Double, efficiency: Double = 0, drives: Int = 0) {
        self.week = week
        self.score = score
        self.efficiency = efficiency
        self.drives = drives
    }
}

// MARK: - Recommendation (web `coachData.recommendations[]`)

/// One coaching recommendation (web `CoachRecommendation`): its category, its impact band, and the tip
/// copy. `id` is the source array position (web `key={i}`), so the list is stable + `Identifiable`.
public struct DrivingCoachRecommendation: Sendable, Equatable, Identifiable {
    public var id: Int
    public var category: String
    public var impact: DrivingCoachImpact
    public var tip: String

    public init(id: Int, category: String, impact: DrivingCoachImpact, tip: String) {
        self.id = id
        self.category = category
        self.impact = impact
        self.tip = tip
    }
}

// MARK: - Per-drive score (web `coachData.per_drive_scores[]`)

/// One per-drive coach score row (web `CoachDriveScore`): the drive id, its ISO date, the 0-100 score, the
/// style, the efficiency (Wh/km), and the distance (km). The web renders the efficiency + distance verbatim
/// with `fmtNumber`, so the values stay raw here and are formatted at the boundary.
public struct DrivingCoachDriveScore: Sendable, Equatable, Identifiable {
    public var id: Int
    public var date: String
    public var score: Double
    public var style: DrivingCoachStyle
    public var efficiency: Double
    public var distance: Double

    public init(
        id: Int,
        date: String,
        score: Double,
        style: DrivingCoachStyle,
        efficiency: Double,
        distance: Double
    ) {
        self.id = id
        self.date = date
        self.score = score
        self.style = style
        self.efficiency = efficiency
        self.distance = distance
    }
}

// MARK: - Inbound payload (web `DrivingCoachData` prop)

/// The whole coach payload the web component is fed (web `DrivingCoachData`). The native surface treats a
/// `nil` payload (or one with `totalDrivesAnalyzed == 0`) as the resolved-but-empty state.
public struct DrivingCoachData: Sendable, Equatable {
    public var overallScore: Double
    public var efficiencyWhKm: Double
    public var bestEfficiencyWhKm: Double
    public var totalDrivesAnalyzed: Int
    public var styleBreakdown: DrivingCoachStyleBreakdown
    public var patterns: DrivingCoachPatterns
    public var weeklyTrend: [DrivingCoachWeeklyPoint]
    public var recommendations: [DrivingCoachRecommendation]
    public var perDriveScores: [DrivingCoachDriveScore]

    public init(
        overallScore: Double = 0,
        efficiencyWhKm: Double = 0,
        bestEfficiencyWhKm: Double = 0,
        totalDrivesAnalyzed: Int = 0,
        styleBreakdown: DrivingCoachStyleBreakdown = DrivingCoachStyleBreakdown(),
        patterns: DrivingCoachPatterns = .zero,
        weeklyTrend: [DrivingCoachWeeklyPoint] = [],
        recommendations: [DrivingCoachRecommendation] = [],
        perDriveScores: [DrivingCoachDriveScore] = []
    ) {
        self.overallScore = overallScore
        self.efficiencyWhKm = efficiencyWhKm
        self.bestEfficiencyWhKm = bestEfficiencyWhKm
        self.totalDrivesAnalyzed = totalDrivesAnalyzed
        self.styleBreakdown = styleBreakdown
        self.patterns = patterns
        self.weeklyTrend = weeklyTrend
        self.recommendations = recommendations
        self.perDriveScores = perDriveScores
    }
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized unit glyphs the projector embeds in projected values: the distance unit the web writes
/// inline (`" km"`), the efficiency unit (`" Wh/km"`), and the em-dash fallback for an unparseable date (web
/// `formatDateShort` `'—'`). Injected so the projection stays Foundation-only and host-testable (the view
/// resolves the real catalog copy through the P1/S10 facade).
public struct DrivingCoachCopy: Sendable, Equatable {
    public var distanceUnit: String
    public var efficiencyUnit: String
    public var emDash: String

    public init(distanceUnit: String = "km", efficiencyUnit: String = "Wh/km", emDash: String = "—") {
        self.distanceUnit = distanceUnit
        self.efficiencyUnit = efficiencyUnit
        self.emDash = emDash
    }

    /// English fallbacks (matches the web source literals) — used by previews + tests.
    public static let fallback = DrivingCoachCopy()
}

// MARK: - Render phase (load envelope around the web composition)

/// What the surface should render. The web `DrivingCoachSection` is a pure presentational component; its
/// parent owns the loading / error / empty envelope. The native surface reproduces that whole envelope so
/// every prompt-required state renders here.
public enum DrivingCoachPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status (web parent `isLoading` / resolved / failure).
public enum DrivingCoachSectionLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so cached content is
/// clearly labelled while reconnecting / offline.
public enum DrivingCoachSectionConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}
