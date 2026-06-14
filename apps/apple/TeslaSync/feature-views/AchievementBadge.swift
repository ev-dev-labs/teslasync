//
//  AchievementBadge.swift
//  TeslaSync — P4 feature view · 0051 · AchievementBadge (Apple)
//
//  The achievement badge — the SwiftUI parity of
//  features/analytics/components/AchievementBadge.tsx. Renders the web source's badge
//  (the progress ring or unlocked icon, the name, the description, and the unlocked /
//  percent footer) plus the P4 leaf contract states. Binds through
//  `AchievementBadgeModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton tile (web parent `isLoading`).
//    • empty    — resolved with no achievement → friendly placeholder tile, never a // parity:allow ui
//                 blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full badge (locked ring + grayscale icon, or unlocked icon).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the
//                 tile with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AchievementBadge (the feature surface)

/// The achievement badge — the SwiftUI parity of
/// `features/analytics/components/AchievementBadge.tsx`. Renders every state from the
/// web source plus the P4 leaf freshness states, binding through
/// `AchievementBadgeModel`.
public struct AchievementBadge: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AchievementBadge"

    @State private var model: AchievementBadgeModel

    public init(model: AchievementBadgeModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: TSSpacing.xs) {
            content
            if model.connection != .live {
                AchievementBadgeFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case .loading:
            AchievementBadgeLoadingView(size: model.resolved.size)
        case .empty:
            AchievementBadgeEmptyView(size: model.resolved.size)
        case let .error(message):
            AchievementBadgeErrorView(size: model.resolved.size, message: message) {
                model.refresh()
            }
        case .data:
            if let achievement = model.resolved.achievement {
                AchievementBadgeTile(resolved: model.resolved, achievement: achievement)
            } else {
                AchievementBadgeEmptyView(size: model.resolved.size)
            }
        }
    }
}
