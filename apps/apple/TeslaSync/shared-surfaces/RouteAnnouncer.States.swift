//
//  RouteAnnouncer.States.swift
//  TeslaSync — P4 shared surface · 0002 · RouteAnnouncer (Apple)
//
//  The P4 leaf-contract chrome composed by `RouteAnnouncer` when the surface is not in its data
//  state: the loading skeleton (the region card + a recent-navigation row as shimmer), the empty
//  state (nothing announced yet — the web region that is silent on first paint), and the error
//  tile with a retry affordance. Each keeps the surface's shape so it never collapses to a blank
//  box. All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web parent `isLoading`)

/// The initial-fetch chrome — a skeleton region card over a skeleton history row, so the surface
/// keeps its shape while the feed resolves.
struct RouteAnnouncerLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSCard {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 110, height: 10)
                    TSSkeleton(height: 16)
                }
            }
            TSCard {
                VStack(spacing: TSSpacing.sm) {
                    ForEach(0 ..< 2, id: \.self) { _ in
                        HStack(spacing: TSSpacing.md) {
                            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
                            TSSkeleton(height: 12)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: RouteAnnouncerStrings.loadingA11y))
    }
}

// MARK: - Empty (resolved, nothing announced yet)

/// The empty render (resolved, nothing announced yet) — a friendly empty-state card with a
/// signpost glyph, never a blank box. The native peer of the web region that starts empty and is
/// silent on first paint.
struct RouteAnnouncerEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(RouteAnnouncerStrings.empty),
                message: LocalizedStringKey(RouteAnnouncerStrings.emptyMessage),
                systemImage: "signpost.right.and.left"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance.
/// The message is the runtime failure reason, rendered verbatim.
struct RouteAnnouncerErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: RouteAnnouncerStrings.errorTitle)
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
                    Text(verbatim: RouteAnnouncerStrings.retry)
                }
                .accessibilityLabel(Text(verbatim: RouteAnnouncerStrings.retry))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
