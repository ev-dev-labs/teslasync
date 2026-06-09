//
//  DrivingCoachWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0043 · DrivingCoachWidget (Apple)
//
//  The testable projection core: the cached driving-coach payload → the view-ready
//  score string, the potential-savings percentage (web `savingsPct`), the tip-card
//  list (web `useMemo` over `recommendations` + `WidgetTipCards`), the impact-tier tone
//  + label mapping (web `impactBadgeMap` + `t('…impact.<impact>')`), and the VoiceOver
//  summary builders. All pure + dependency-light so the adapter can be unit-tested
//  without a store, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Impact tier (web `CoachRecommendation.impact` + `impactBadgeMap`)

/// A recommendation's impact tier — the native port of the web
/// `'high' | 'medium' | 'low'` union and its `impactBadgeMap` tone.
public enum CoachImpact: String, Sendable, Equatable, CaseIterable {
    case high
    case medium
    case low

    /// Parses the raw API string into a tier; an unknown/absent value reads as `nil`
    /// (web `rec.impact` is optionally rendered — no badge when missing).
    public static func from(raw: String?) -> CoachImpact? {
        guard let raw else { return nil }
        return CoachImpact(rawValue: raw.lowercased())
    }

    /// The shared chip tone (web `impactBadgeMap`: high → success, medium → warning,
    /// low → neutral).
    public var tone: TSTone {
        switch self {
        case .high: .success
        case .medium: .warning
        case .low: .neutral
        }
    }

    /// The i18n key + web English fallback for the impact label. The web fallback is the
    /// raw impact string itself (`t('widget.drivingCoach.impact.<impact>', rec.impact)`).
    public var localization: (key: String, fallback: String) {
        ("widget.drivingCoach.impact.\(rawValue)", rawValue)
    }
}

// MARK: - Cached input (web `DrivingCoachData` + `CoachRecommendation`)

/// One cached recommendation (web `CoachRecommendation`). Optional strings mirror the
/// web `rec.category ?? '—'` / `rec.tip ?? '—'` null-coalescing applied in the widget's
/// `useMemo`.
public struct CoachRecommendationInput: Sendable, Equatable, Identifiable {
    public var id: Int
    public var category: String?
    public var tip: String?
    public var impact: CoachImpact?

    public init(
        id: Int,
        category: String? = nil,
        tip: String? = nil,
        impact: CoachImpact? = nil
    ) {
        self.id = id
        self.category = category
        self.tip = tip
        self.impact = impact
    }
}

/// The cached driving-coach payload the widget renders (the subset of the web
/// `DrivingCoachData` the surface reads: the overall score, the current/best efficiency
/// that drive the savings chip, and the recommendation list). Its presence is what
/// separates the `content` phase from the `empty` phase.
public struct DrivingCoachInput: Sendable, Equatable {
    public var overallScore: Double
    public var efficiencyWhKm: Double
    public var bestEfficiencyWhKm: Double
    public var recommendations: [CoachRecommendationInput]

    public init(
        overallScore: Double = 0,
        efficiencyWhKm: Double = 0,
        bestEfficiencyWhKm: Double = 0,
        recommendations: [CoachRecommendationInput] = []
    ) {
        self.overallScore = overallScore
        self.efficiencyWhKm = efficiencyWhKm
        self.bestEfficiencyWhKm = bestEfficiencyWhKm
        self.recommendations = recommendations
    }
}

// MARK: - Projected tip (web `TipItem`)

/// One tip card the list renders — the native port of the web `TipItem` produced by the
/// widget's `useMemo`. Carries the localized title/description plus the impact tier and
/// its pre-localized label (web `impactLabel`).
public struct CoachTip: Identifiable, Equatable, Sendable {
    public let id: Int
    public let title: String
    public let description: String
    public let impact: CoachImpact?
    public let impactLabel: String?

    public init(
        id: Int,
        title: String,
        description: String,
        impact: CoachImpact?,
        impactLabel: String?
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.impact = impact
        self.impactLabel = impactLabel
    }
}

// MARK: - Projection (web widget `useMemo` + `savingsPct`)

/// Builds the view-ready projections from the cached coach payload, reproducing the web
/// widget's derived values: the formatted score (`fmtInt`), the potential-savings
/// percentage (`savingsPct`), the tip-card list (the `recommendations.map` in `useMemo`
/// + `WidgetTipCards` slice), and the interpolated savings label. Pure + bundle-free:
/// labels are resolved through the injected `localize`, so it unit-tests without `.main`.
public enum DrivingCoachProjection {
    /// The em-dash sentinel the web uses for a missing category/tip.
    static let missingLabel = "—"

    /// The maximum tip cards the standard layout shows (web `WidgetTipCards maxTips=3`).
    public static let standardTipLimit = 3

    /// Potential efficiency savings, in whole percent — web
    /// `currentEff > 0 ? Math.round(((currentEff - bestEff) / currentEff) * 100) : 0`.
    public static func savingsPercent(currentEff: Double, bestEff: Double) -> Int {
        guard currentEff > 0 else { return 0 }
        return Int((((currentEff - bestEff) / currentEff) * 100).rounded())
    }

    /// The tip-card projection — web `recommendations.map((rec, i) => ({ … }))`. Missing
    /// category/tip fall back to the em-dash; the impact label is pre-localized when the
    /// tier is present (web `rec.impact ? t('…impact.<impact>', rec.impact) : undefined`).
    public static func tips(
        from recommendations: [CoachRecommendationInput],
        localize: (String, String) -> String
    ) -> [CoachTip] {
        recommendations.map { rec in
            CoachTip(
                id: rec.id,
                title: rec.category ?? missingLabel,
                description: rec.tip ?? missingLabel,
                impact: rec.impact,
                impactLabel: rec.impact.map { localize($0.localization.key, $0.localization.fallback) }
            )
        }
    }

    /// The interpolated potential-savings chip label — web
    /// `t('widget.drivingCoach.potentialSavings', 'Potential savings: {{pct}}%', { pct })`.
    /// The `{{pct}}` token is replaced with the locale-formatted percentage so the
    /// per-surface catalog value stays verbatim with the web source.
    public static func potentialSavingsLabel(
        pct: Int,
        localize: (String, String) -> String
    ) -> String {
        let template = localize("widget.drivingCoach.potentialSavings", "Potential savings: {{pct}}%")
        return template.replacingOccurrences(of: "{{pct}}", with: formatInt(pct))
    }

    /// Locale-aware integer score (web `fmtInt(score)` = `fmtNumber(score, 0)`).
    public static func formatScore(_ score: Double) -> String {
        formatInt(Int(score.rounded()))
    }

    /// Locale-aware integer (web `fmtInt`).
    public static func formatInt(_ value: Int) -> String {
        value.formatted(.number.precision(.fractionLength(0)))
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver strings for the surface. Pure + public so the spoken content can
/// be unit-tested without rendering the view.
public enum DrivingCoachAccessibility {
    /// The score header summary — "Driving score 82 out of 100. Potential savings: 12%".
    public static func scoreSummary(
        scoreText: String,
        savingsPct: Int,
        localize: (String, String) -> String
    ) -> String {
        let prefix = localize("widget.drivingCoach.scoreA11y", "Driving score")
        let outOf = localize("widget.drivingCoach.scoreLabel", "/ 100")
        var summary = "\(prefix) \(scoreText) \(outOf)"
        if savingsPct > 0 {
            summary += ". " + DrivingCoachProjection.potentialSavingsLabel(pct: savingsPct, localize: localize)
        }
        return summary
    }

    /// One tip's spoken summary — "Tip 1. Smooth acceleration. Ease off the pedal… High".
    public static func tipSummary(
        index: Int,
        tip: CoachTip,
        localize: (String, String) -> String
    ) -> String {
        let prefix = localize("widget.drivingCoach.tipA11y", "Tip")
        var summary = "\(prefix) \(index). \(tip.title). \(tip.description)"
        if let label = tip.impactLabel {
            summary += ". \(label)"
        }
        return summary
    }
}
