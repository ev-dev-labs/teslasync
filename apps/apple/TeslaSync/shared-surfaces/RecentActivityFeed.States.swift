//
//  RecentActivityFeed.States.swift
//  TeslaSync — P4 shared surface · 0100 · RecentActivityFeed (Apple)
//
//  The P4 leaf-contract chrome composed by `RecentActivityFeed` when the surface is not showing its
//  timeline: the loading skeleton (the feed's shape as shimmer while the entries resolve), the empty
//  state (the web `EmptyState` — a history glyph + "No recent activity in this window.", never a blank
//  box), and the error tile with a retry affordance (web `QueryError` peer). All copy resolves through
//  the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (entries resolving)

/// The initial-fetch chrome — a skeleton timeline that keeps the surface's shape (a connector rail of
/// dot + title + subtitle rows) while the host resolves the entries.
struct RecentActivityFeedLoadingView: View {
    private let rowCount = 4

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< rowCount, id: \.self) { _ in
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    TSSkeleton(width: 22, height: 22, cornerRadius: TSRadius.pill)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 160, height: 12)
                        TSSkeleton(width: 220, height: 10)
                    }
                    Spacer(minLength: 0)
                    TSSkeleton(width: 36, height: 10)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: RecentActivityFeedStrings.string(
            "recentActivityFeed.loadingA11y", "Loading recent activity"
        )))
    }
}

// MARK: - Empty (web `EmptyState`)

/// The empty render — the native parity of the web `EmptyState`: a centred history glyph over the
/// friendly message (the caller's `emptyMessage` override, else the web default). Never a blank box.
struct RecentActivityFeedEmptyView: View {
    let message: String?

    private var resolvedMessage: String {
        message ?? RecentActivityFeedStrings.string(
            "activity.myActivity.empty", "No recent activity in this window."
        )
    }

    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(resolvedMessage),
            systemImage: "clock.arrow.circlepath"
        )
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim.
struct RecentActivityFeedErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: RecentActivityFeedStrings.string(
                    "recentActivityFeed.errorTitle", "Couldn't load recent activity"
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    Text(verbatim: RecentActivityFeedStrings.string("recentActivityFeed.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: RecentActivityFeedStrings.string(
                    "recentActivityFeed.retry", "Retry"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }
}
