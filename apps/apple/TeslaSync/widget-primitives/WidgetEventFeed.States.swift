//
//  WidgetEventFeed.States.swift
//  TeslaSync — P4 widget primitive · 0005 · WidgetEventFeed (Apple)
//
//  The P4 leaf-contract chrome composed by `WidgetEventFeed` when the surface is not showing its
//  list: the loading skeleton (timeline-shaped shimmer rows while the host's query resolves) and the
//  error tile with a retry affordance (web `QueryError` peer). The empty state is the shared
//  `TSEmptyState` (web `EmptyState`) and lives in the main surface file. All copy resolves through the
//  P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (items resolving)

/// The initial-fetch chrome — a small stack of skeleton rows that keep the timeline's shape (a
/// leading icon box, a title line, and a meta line) while the host resolves the feed.
struct WidgetEventFeedLoadingView: View {
    /// How many skeleton rows to show — matches a compact (3) vs full (4) feed silhouette.
    let rowCount: Int

    init(rowCount: Int = 4) {
        self.rowCount = max(1, rowCount)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< rowCount, id: \.self) { _ in
                row
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: WidgetEventFeedStrings.string(
            "widgetEventFeed.loadingA11y", "Loading recent events"
        )))
    }

    private var row: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.md)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSSkeleton(height: 12)
                TSSkeleton(width: 80, height: 10)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error tile with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim; the title + retry resolve through the
/// P1/S10 facade.
struct WidgetEventFeedErrorView: View {
    let message: String
    let onRetry: () -> Void

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: WidgetEventFeedStrings.string(
                "widgetEventFeed.errorTitle", "Couldn't load events"
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
                Text(verbatim: WidgetEventFeedStrings.string("widgetEventFeed.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: WidgetEventFeedStrings.string("widgetEventFeed.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: shape)
        .overlay(shape.strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}
