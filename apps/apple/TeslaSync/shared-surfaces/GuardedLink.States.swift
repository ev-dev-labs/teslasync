//
//  GuardedLink.States.swift
//  TeslaSync — P4 shared surface · 0122 · GuardedLink (Apple)
//
//  The P4 leaf-contract chrome composed by `GuardedLink` when the surface is not in its data state:
//  the loading skeleton (the link shape as shimmer while the guard feed is read), the empty state (no
//  destination — the friendly native improvement over a broken/blank link, never a blank box), and the
//  error tile with a retry affordance (web `QueryError` peer). All copy resolves through the P1/S10
//  facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (guard-feed read / initial fetch)

/// The initial-read chrome — a skeleton that keeps the link's shape (a single text line) while the
/// guard feed is read.
struct GuardedLinkLoadingView: View {
    var body: some View {
        TSSkeleton(width: 120, height: 14, cornerRadius: TSRadius.sm)
            .frame(maxWidth: 120, alignment: .leading)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: GuardedLinkStrings.string("guardedLink.loadingA11y", "Loading link")))
    }
}

// MARK: - Empty (no destination)

/// The empty render — a friendly card stating there is no destination, the native improvement over a
/// broken link with no `to` (per the P4 leaf contract, the surface never collapses to a blank box).
struct GuardedLinkEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(GuardedLinkStrings.string("guardedLink.empty", "No destination")),
                message: LocalizedStringKey(GuardedLinkStrings.string(
                    "guardedLink.emptyMessage",
                    "This link has no destination yet."
                )),
                systemImage: "link.badge.plus"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The guard-feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance.
/// The message is the runtime failure reason, rendered verbatim.
struct GuardedLinkErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: GuardedLinkStrings.string("guardedLink.errorTitle", "Couldn't load this link"))
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
                    Text(verbatim: GuardedLinkStrings.string("guardedLink.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: GuardedLinkStrings.string("guardedLink.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
