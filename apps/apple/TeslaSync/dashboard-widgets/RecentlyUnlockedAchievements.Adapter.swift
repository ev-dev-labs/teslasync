//
//  RecentlyUnlockedAchievements.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0080 · RecentlyUnlockedAchievements (Apple)
//
//  Pure (Foundation-only) projection: cached `[AchievementUnlock]` → the ranked list of
//  recently-unlocked badges the surface renders, reproducing the web source's selection
//  pipeline VERBATIM (filter unlocked + unlocked_at, sort unlocked_at desc, slice to the
//  layout limit) so the native surface shows the exact same badges, in the exact same order,
//  as features/dashboard/widgets/RecentlyUnlockedAchievements.tsx.
//
//  This file is deliberately free of SwiftUI so the selection logic can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Layout limits (ported from the web `isWide ? 5 : 3`)

/// How many badges the strip shows per layout width. The web widget derives `limit` from the
/// grid footprint: `const isWide = size.cols >= 3; const limit = isWide ? 5 : 3;`.
public enum RecentlyUnlockedLimits {
    /// Narrow (1–2 column) layouts show three badges.
    public static let narrow = 3
    /// Wide (3–4 column) layouts show five badges.
    public static let wide = 5
}

// MARK: - Projected badge (web `AchievementBadge` input)

/// One projected, recently-unlocked badge: a stable id (the deep-link target), the display
/// name + description + emoji icon, and the unlock instant used for ordering. Mirrors the
/// subset of the web `AchievementData` the `size="sm"` unlocked badge renders.
public struct RecentlyUnlockedItem: Identifiable, Equatable {
    public let id: String
    public let name: String
    public let detail: String
    public let icon: String
    public let unlockedAt: Date?

    public init(id: String, name: String, detail: String, icon: String, unlockedAt: Date?) {
        self.id = id
        self.name = name
        self.detail = detail
        self.icon = icon
        self.unlockedAt = unlockedAt
    }

    init(from unlock: AchievementUnlock) {
        id = unlock.id
        name = unlock.name
        detail = unlock.detail
        icon = unlock.icon
        unlockedAt = unlock.unlockedAt
    }

    /// The per-badge VoiceOver / `aria-label` text, ported from the web
    /// `t('achievements.viewNamed', 'View achievement: {{name}}', { name })`.
    public var accessibilityLabel: String {
        RecentlyUnlockedStrings.format("achievements.viewNamed", "View achievement: %@", name)
    }

    /// The "✓ Unlocked" status caption the `size="sm"` badge shows for an unlocked achievement
    /// (`t('lifetime.unlocked', '✓ Unlocked')`).
    public var statusText: String {
        RecentlyUnlockedStrings.string("lifetime.unlocked", "✓ Unlocked")
    }
}

// MARK: - Projection

/// The fully-ranked badge list for the surface. Holds the recently-unlocked badges sorted
/// newest-first and capped at the widest layout's limit; the view slices to the active layout
/// via `items(isWide:)`, exactly as the web widget slices `recent` to `limit`.
public struct RecentlyUnlockedProjection: Equatable {
    public let ranked: [RecentlyUnlockedItem]

    public init(ranked: [RecentlyUnlockedItem]) {
        self.ranked = ranked
    }

    /// No recently-unlocked badges → the surface shows the `noneYet` empty state.
    public var isEmpty: Bool {
        ranked.isEmpty
    }

    /// The badges shown for a given grid width: wide layouts show five, narrower layouts three —
    /// the native parity of the web `limit = isWide ? 5 : 3` slice.
    public func items(isWide: Bool) -> [RecentlyUnlockedItem] {
        Array(ranked.prefix(isWide ? RecentlyUnlockedLimits.wide : RecentlyUnlockedLimits.narrow))
    }
}

/// Pure projector: `[AchievementUnlock]` → `RecentlyUnlockedProjection`. Reproduces the web
/// `useMemo` selection VERBATIM:
///
///   const all = data?.achievements ?? [];
///   all.filter(a => a.unlocked && a.unlocked_at)
///      .sort((a, b) => Date.parse(b.unlocked_at) - Date.parse(a.unlocked_at))
///      .slice(0, limit);
///
/// The descending sort is made stable on ties (equal `unlocked_at`) by falling back to the
/// achievement's original array index, matching JavaScript's stable `Array.prototype.sort`.
public enum RecentlyUnlockedProjector {
    public static func project(achievements: [AchievementUnlock]) -> RecentlyUnlockedProjection {
        let unlocked = achievements.enumerated().filter { entry in
            entry.element.unlocked && entry.element.unlockedAt != nil
        }

        let sorted = unlocked.sorted { lhs, rhs in
            let lhsDate = lhs.element.unlockedAt ?? .distantPast
            let rhsDate = rhs.element.unlockedAt ?? .distantPast
            if lhsDate != rhsDate {
                return lhsDate > rhsDate
            }
            return lhs.offset < rhs.offset
        }

        let ranked = sorted
            .prefix(RecentlyUnlockedLimits.wide)
            .map { RecentlyUnlockedItem(from: $0.element) }

        return RecentlyUnlockedProjection(ranked: ranked)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the badge strip. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum RecentlyUnlockedAccessibility {
    /// One spoken phrase per visible badge (`View achievement: …`), prefixed by the surface
    /// title, e.g. "Recently Unlocked. View achievement: Road Warrior. View achievement: …".
    public static func summary(for items: [RecentlyUnlockedItem]) -> String {
        let title = RecentlyUnlockedStrings.string("widget.recentlyUnlocked.title", "Recently Unlocked")
        return ([title] + items.map(\.accessibilityLabel)).joined(separator: ". ")
    }
}
