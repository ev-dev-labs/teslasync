//
//  AchievementBadge.Adapter.swift
//  TeslaSync — P4 feature view · 0051 · AchievementBadge (Apple)
//
//  The testable projection core for the achievement badge — the SwiftUI parity of
//  features/analytics/components/AchievementBadge.tsx. Everything here is pure +
//  dependency-free (no store, no bundle, no rendered view) so the achievement data
//  model, the size enum, the unlock/near-complete logic, the rounded percentage, the
//  clamped ring fraction, the `pct%` label, and the VoiceOver summary are all unit
//  tested in isolation.
//
//  Parity note: the web component derives two numbers from the achievement —
//  `isNearComplete = !unlocked && progress >= 0.8` and `pct = Math.round(progress *
//  100)` — and feeds `<ProgressRing value={pct} max={100} … />` for the locked badge.
//  This core reproduces that arithmetic verbatim: the percentage uses round-half-away
//  (matching JS `Math.round` over the non-negative progress domain), and the ring's
//  arc fraction is `pct / 100` clamped to 0...1 (matching the web ring's internal
//  `value / max` clamp), so the rendered sweep equals the rounded percentage exactly.
//

import Foundation

// MARK: - Achievement model (web `AchievementData` interface)

/// One achievement as the badge consumes it — the native mirror of the web
/// `AchievementData` interface. `progress` is the 0...1 completion fraction the web
/// uses for both the percentage and the near-complete threshold; `unlockedAt`,
/// `target`, and `current` are carried for parity with the source shape even though
/// this presentational leaf does not render them (the web component does not either).
public struct AchievementBadgeData: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let description: String
    public let icon: String
    public let unlocked: Bool
    public let unlockedAt: String?
    public let progress: Double
    public let target: Double
    public let current: Double

    public init(
        id: String,
        name: String,
        description: String,
        icon: String,
        unlocked: Bool,
        unlockedAt: String? = nil,
        progress: Double,
        target: Double = 0,
        current: Double = 0
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.icon = icon
        self.unlocked = unlocked
        self.unlockedAt = unlockedAt
        self.progress = progress
        self.target = target
        self.current = current
    }
}

// MARK: - Size variant (web `size?: 'sm' | 'md' | 'lg'`)

/// The badge size variant — the native mirror of the web `size` prop. The cases are
/// kept here (pure, presentation-free); the per-size layout metrics (ring diameter,
/// stroke, icon point size, spacing, name font) live in the view layer so this core
/// stays dependency-free. `md` is the web default.
public enum AchievementBadgeSize: String, Sendable, Equatable, CaseIterable {
    case sm
    case md
    case lg
}

// MARK: - Derived metrics (web `isNearComplete` + `pct` + ring `value/max`)

/// The pure numbers the web component derives from an achievement. Unit tested across
/// the unlocked / near-complete / partial / zero / over-unit / non-finite cases.
public enum AchievementBadgeMetrics {
    /// Web `!achievement.unlocked && achievement.progress >= 0.8`. A non-finite
    /// progress can never satisfy the threshold, so it is treated as not-near.
    public static func isNearComplete(unlocked: Bool, progress: Double) -> Bool {
        guard !unlocked, progress.isFinite else { return false }
        return progress >= 0.8
    }

    /// Web `Math.round(achievement.progress * 100)`. Non-finite progress coerces to 0;
    /// the round is half-away-from-zero, which equals `Math.round` over the
    /// non-negative progress domain the source produces.
    public static func percentInt(progress: Double) -> Int {
        guard progress.isFinite else { return 0 }
        return Int((progress * 100).rounded(.toNearestOrAwayFromZero))
    }

    /// The locked ring's arc fraction — web `<ProgressRing value={pct} max={100} />`
    /// sweeps `pct / 100`, clamped to 0...1 by the ring. Reproduced here so the view
    /// is a pure function of this value.
    public static func ringFraction(progress: Double) -> Double {
        let fraction = Double(percentInt(progress: progress)) / 100
        return min(max(fraction, 0), 1)
    }
}

// MARK: - Label formatting (web `{pct}%` template literal)

/// The badge's value label. The web renders the percentage with a plain template
/// literal (`{pct}%`), i.e. Western digits with no grouping — reproduced verbatim so
/// the locked badge's footer matches the source exactly.
public enum AchievementBadgeFormat {
    /// Web `` `${pct}%` `` — the rounded integer percentage with a trailing `%`.
    public static func percentLabel(progress: Double) -> String {
        "\(AchievementBadgeMetrics.percentInt(progress: progress))%"
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver string for the badge from already-localised parts, so the
/// spoken content is asserted without rendering the view. Mirrors the web a11y
/// surface: the icon carries `aria-label={name}`, and the tile conveys the name, the
/// description, and the unlocked / progress status.
public enum AchievementBadgeAccessibility {
    /// The composed spoken label: "{name}, {description}, {status}".
    public static func badgeLabel(name: String, description: String, status: String) -> String {
        [name, description, status]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}
