//
//  HealthRecommendations.Adapter.swift
//  TeslaSync — P4 feature view · 0156 · HealthRecommendations (Apple)
//
//  The testable projection core: an `overallHealth` value → the ordered list of drivetrain-health
//  recommendations, reproducing the web `useMemo` tip pipeline VERBATIM so the native surface shows
//  the exact same advice (in the same order, with the same priorities) as
//  features/driving/components/drivetrain-health/HealthRecommendations.tsx.
//
//  Deliberately free of SwiftUI (Foundation only) so the projection + accessibility compile and run
//  on a plain host and are pinned by unit tests. The priority → token tint + SF Symbol mapping lives
//  in HealthRecommendations.Views.swift; here a label is resolved lazily through the P1/S10 facade so
//  the projector itself holds no SwiftUI.
//

import Foundation

// MARK: - Localized label (P1/S10 key + web English fallback)

/// One localizable label — a key plus its web English fallback — resolved lazily through the P1/S10
/// facade so the projection stays SwiftUI-free and host-testable.
public struct HealthRecommendationsLabel: Equatable, Sendable {
    public let key: String
    public let fallback: String

    public init(key: String, fallback: String) {
        self.key = key
        self.fallback = fallback
    }

    /// The resolved (localized) text for display + accessibility (P1/S10 facade).
    public var text: String {
        HealthRecommendationsStrings.string(key, fallback)
    }
}

// MARK: - Recommendation priority (web `tip.priority`)

/// The urgency of a recommendation — the native parity of the web union `'high' | 'medium' | 'low'`.
/// Drives the card's border + fill tint and its leading glyph (the warning triangle for high/medium,
/// the trend glyph for low) in HealthRecommendations.Views.swift, kept SwiftUI-free here so the
/// projection is host-testable.
public enum HealthRecommendationPriority: String, Sendable, Equatable, CaseIterable {
    case high
    case medium
    case low
}

// MARK: - Recommendation (web `Recommendation`)

/// One drivetrain-health recommendation — the native parity of the web `Recommendation`
/// (`{ key, text, priority }`). `key` is the stable identity the web `.map(key=…)` uses; `label`
/// carries the i18n key + web English fallback (resolved at the display boundary, not baked in); and
/// `priority` selects the card tint + glyph.
public struct HealthRecommendation: Equatable, Identifiable, Sendable {
    public let key: String
    public let label: HealthRecommendationsLabel
    public let priority: HealthRecommendationPriority

    public var id: String {
        key
    }

    /// The resolved (localized) recommendation text — the web already-translated `tip.text`.
    public var text: String {
        label.text
    }

    public init(key: String, label: HealthRecommendationsLabel, priority: HealthRecommendationPriority) {
        self.key = key
        self.label = label
        self.priority = priority
    }
}

// MARK: - Projection

/// The fully-projected surface content: the overall drivetrain condition plus the ordered list of
/// recommendations the panel renders — every entry computed with the exact same conditional logic +
/// ordering as the web component so the web and native surfaces show identical advice side by side.
public struct HealthRecommendationsProjection: Equatable, Sendable {
    public let status: HealthRecommendationsHealthStatus
    public let recommendations: [HealthRecommendation]

    public init(status: HealthRecommendationsHealthStatus, recommendations: [HealthRecommendation]) {
        self.status = status
        self.recommendations = recommendations
    }

    /// The panel title (web `t('drivetrain.recommendations', 'Health Recommendations')`).
    public var title: HealthRecommendationsLabel {
        HealthRecommendationsLabel(key: "drivetrain.recommendations", fallback: "Health Recommendations")
    }

    /// Whether any recommendation is present. The web list is always non-empty (there are always the
    /// four baseline low-priority tips); this guards the native empty state defensively so the panel
    /// never renders a blank box if a future status ever projects to nothing.
    public var isEmpty: Bool {
        recommendations.isEmpty
    }
}

// MARK: - Projector (pure, web-parity)

/// Pure projector: `overallHealth` → the ordered recommendation list. Reproduces the web `useMemo`
/// branch-by-branch and in the exact same push order so the native list matches the web list
/// position-for-position:
///   1. `critical` → the two high-priority "stop / urgent service" tips,
///   2. `warning` **or** `critical` → the three medium-priority "reduce load / coolant /
///      supercharging" tips,
///   3. always → the four low-priority maintenance tips.
public enum HealthRecommendationsProjector {
    public static func project(data: HealthRecommendationsInput) -> HealthRecommendationsProjection {
        HealthRecommendationsProjection(
            status: data.overallHealth,
            recommendations: recommendations(for: data.overallHealth)
        )
    }

    /// The native parity of the web `recommendations` memo — same conditionals, same push order:
    /// the high-priority tips (critical only), then the medium-priority tips (warning or critical),
    /// then the always-present low-priority maintenance tips.
    public static func recommendations(
        for overallHealth: HealthRecommendationsHealthStatus
    ) -> [HealthRecommendation] {
        var tips: [HealthRecommendation] = []
        if overallHealth == .critical {
            tips.append(contentsOf: highPriorityTips)
        }
        if overallHealth == .warning || overallHealth == .critical {
            tips.append(contentsOf: mediumPriorityTips)
        }
        tips.append(contentsOf: lowPriorityTips)
        return tips
    }

    /// The high-priority tips, shown only for `critical` (web `overallHealth === 'critical'` block).
    private static let highPriorityTips: [HealthRecommendation] = [
        HealthRecommendation(
            key: "critical-stop",
            label: HealthRecommendationsLabel(
                key: "drivetrain.tips.criticalStop",
                fallback: "Temperatures are critically high. Consider pulling over safely and "
                    + "letting the vehicle cool down."
            ),
            priority: .high
        ),
        HealthRecommendation(
            key: "service-urgent",
            label: HealthRecommendationsLabel(
                key: "drivetrain.tips.serviceUrgent",
                fallback: "Schedule an urgent service appointment. Critical temperatures may "
                    + "indicate a coolant system issue."
            ),
            priority: .high
        )
    ]

    /// The medium-priority tips, shown for `warning` or `critical` (web combined block).
    private static let mediumPriorityTips: [HealthRecommendation] = [
        HealthRecommendation(
            key: "reduce-load",
            label: HealthRecommendationsLabel(
                key: "drivetrain.tips.reduceLoad",
                fallback: "Reduce driving intensity and avoid hard acceleration to allow "
                    + "components to cool."
            ),
            priority: .medium
        ),
        HealthRecommendation(
            key: "check-coolant",
            label: HealthRecommendationsLabel(
                key: "drivetrain.tips.checkCoolant",
                fallback: "Schedule a service appointment to inspect the coolant system and "
                    + "fluid levels."
            ),
            priority: .medium
        ),
        HealthRecommendation(
            key: "avoid-supercharging",
            label: HealthRecommendationsLabel(
                key: "drivetrain.tips.avoidSupercharging",
                fallback: "Avoid Supercharging while temperatures are elevated. Use Level 2 "
                    + "charging instead."
            ),
            priority: .medium
        )
    ]

    /// The baseline low-priority maintenance tips, always present (web unconditional `push`es).
    private static let lowPriorityTips: [HealthRecommendation] = [
        HealthRecommendation(
            key: "regular-service",
            label: HealthRecommendationsLabel(
                key: "drivetrain.tips.regularService",
                fallback: "Keep up with regular service intervals for optimal drivetrain health and "
                    + "longevity."
            ),
            priority: .low
        ),
        HealthRecommendation(
            key: "gentle-accel",
            label: HealthRecommendationsLabel(
                key: "drivetrain.tips.gentleAccel",
                fallback: "Gentle acceleration helps maintain lower motor temperatures and extends "
                    + "component life."
            ),
            priority: .low
        ),
        HealthRecommendation(
            key: "precondition",
            label: HealthRecommendationsLabel(
                key: "drivetrain.tips.precondition",
                fallback: "Precondition the battery in cold weather for better thermal performance "
                    + "and driving efficiency."
            ),
            priority: .low
        ),
        HealthRecommendation(
            key: "monitor-temps",
            label: HealthRecommendationsLabel(
                key: "drivetrain.tips.monitorTemps",
                fallback: "Monitor drivetrain temperatures after spirited driving sessions or long "
                    + "highway stretches."
            ),
            priority: .low
        )
    ]
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver phrasing for the surface. Pure + public so the spoken content can be
/// unit-tested without rendering the view. Callers pass already-localized strings (the labels) so the
/// summary holds no English literals itself.
public enum HealthRecommendationsAccessibility {
    /// The spoken priority prefix for a row, so the visual priority (conveyed by color + glyph in the
    /// web source) is not lost to VoiceOver.
    public static func priorityLabel(_ priority: HealthRecommendationPriority) -> String {
        switch priority {
        case .high:
            HealthRecommendationsStrings.string("drivetrain.healthRecommendations.priority.high", "High priority")
        case .medium:
            HealthRecommendationsStrings.string("drivetrain.healthRecommendations.priority.medium", "Medium priority")
        case .low:
            HealthRecommendationsStrings.string("drivetrain.healthRecommendations.priority.low", "Tip")
        }
    }

    /// One row's spoken label, e.g. "High priority: Temperatures are critically high…".
    public static func rowSummary(for recommendation: HealthRecommendation) -> String {
        "\(priorityLabel(recommendation.priority)): \(recommendation.text)"
    }

    /// The whole-panel spoken label: the title followed by every recommendation row.
    public static func summary(for projection: HealthRecommendationsProjection) -> String {
        let rows = projection.recommendations
            .map { rowSummary(for: $0) }
            .joined(separator: ". ")
        return "\(projection.title.text). \(rows)"
    }
}
