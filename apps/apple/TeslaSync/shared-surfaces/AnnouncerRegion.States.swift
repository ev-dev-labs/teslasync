//
//  AnnouncerRegion.States.swift
//  TeslaSync — P4 shared surface · 0001 · AnnouncerRegion (Apple)
//
//  The P4 leaf-contract chrome composed by `AnnouncerRegion` when the surface is not in its
//  data state: the loading skeleton (the two region cards as shimmer), the empty state (no
//  announcements voiced yet), and the error tile with a retry affordance. Each keeps the
//  surface's shape so it never collapses to a blank box. All copy resolves through the P1/S10
//  facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web parent `isLoading`)

/// The initial-fetch chrome — two skeleton region cards over a skeleton history row, so the
/// surface keeps its shape while the feed resolves.
struct AnnouncerLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 2, id: \.self) { _ in
                TSCard {
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        TSSkeleton(width: 90, height: 10)
                        TSSkeleton(height: 14)
                    }
                }
            }
            TSCard {
                VStack(spacing: TSSpacing.sm) {
                    ForEach(0 ..< 2, id: \.self) { _ in
                        HStack(spacing: TSSpacing.md) {
                            TSSkeleton(width: 56, height: 18, cornerRadius: TSRadius.sm)
                            TSSkeleton(height: 12)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AnnouncerRegionStrings.string(
            "announcer.loadingA11y", "Loading announcements"
        )))
    }
}

// MARK: - Empty (resolved, no announcements voiced yet)

/// The empty render (resolved, nothing voiced yet) — a friendly empty-state card with a
/// speaker glyph, never a blank box. The native peer of the web regions that start as empty
/// strings.
struct AnnouncerEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(AnnouncerRegionStrings.string(
                    "announcer.empty", "No announcements yet"
                )),
                message: LocalizedStringKey(AnnouncerRegionStrings.string(
                    "announcer.emptyMessage",
                    "Screen-reader announcements will appear here as the app voices them."
                )),
                systemImage: "speaker.wave.2"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry
/// affordance. The message is the runtime failure reason, rendered verbatim.
struct AnnouncerErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: AnnouncerRegionStrings.string(
                    "announcer.errorTitle", "Couldn't load announcements"
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
                    Text(verbatim: AnnouncerRegionStrings.string("announcer.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: AnnouncerRegionStrings.string("announcer.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
