//
//  SkipToContent.States.swift
//  TeslaSync — P4 shared surface · 0139 · SkipToContent (Apple)
//
//  The P4 leaf-contract chrome composed by `SkipToContent` when the surface is not in its data
//  state: the loading skeleton (the skip-link rows as shimmer), the empty state (no landmark
//  registered yet → nothing to skip to), and the error tile with a retry affordance. Each keeps
//  the surface's shape so it never collapses to a blank box. All copy resolves through the
//  P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web parent `isLoading`)

/// The initial-fetch chrome — two skeleton skip-link rows, so the surface keeps its shape while
/// the landmark registry resolves.
struct SkipToContentLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 2, id: \.self) { _ in
                TSCard {
                    HStack(spacing: TSSpacing.md) {
                        TSSkeleton(width: 24, height: 24, cornerRadius: TSRadius.sm)
                        TSSkeleton(height: 14)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SkipToContentStrings.string(
            "skip.loadingA11y", "Loading skip navigation"
        )))
    }
}

// MARK: - Empty (resolved, no landmark registered)

/// The empty render (resolved, nothing registered yet) — a friendly empty-state card, never a
/// blank box. The native peer of the web anchor whose `#main-content` target is not in the DOM.
struct SkipToContentEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(SkipToContentStrings.string(
                    "skip.empty", "No landmarks to skip to"
                )),
                message: LocalizedStringKey(SkipToContentStrings.string(
                    "skip.emptyMessage",
                    "Skip links appear here once the page registers its main content landmark."
                )),
                systemImage: "arrow.down.to.line"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance.
/// The message is the runtime failure reason, rendered verbatim.
struct SkipToContentErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: SkipToContentStrings.string(
                    "skip.errorTitle", "Couldn't load skip navigation"
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
                    Text(verbatim: SkipToContentStrings.string("skip.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: SkipToContentStrings.string("skip.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
