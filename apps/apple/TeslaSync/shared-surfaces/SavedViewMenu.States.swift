//
//  SavedViewMenu.States.swift
//  TeslaSync — P4 shared surface · 0102 · SavedViewMenu (Apple)
//
//  The P4 leaf-contract chrome composed by `SavedViewMenu` / its popover when the surface is not in
//  its loaded state: the loading skeleton trigger + skeleton rows, the error tile with a retry
//  affordance (the web menu has no `QueryError` peer — added here so the surface never collapses to a
//  blank box), the friendly empty state with a "Save current view…" action (the web popover's
//  `EmptyState`), and the freshness chip (the orthogonal stale / offline connectivity axis). All copy
//  resolves through the P1/S10 facade; all color comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading trigger (initial fetch — skeleton chrome)

/// The initial-fetch trigger — a skeleton pill shaped like the trigger button, so the surface keeps
/// its shape while the saved-views feed resolves (never a blank box).
struct SavedViewMenuLoadingTrigger: View {
    var body: some View {
        TSSkeleton(width: 148, height: 30, cornerRadius: TSRadius.md)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: SavedViewMenuStrings.string(
                "savedViews.loadingA11y", "Loading saved views"
            )))
    }
}

// MARK: - Loading rows (popover body while refreshing)

/// The popover body shown while a refresh is in flight with nothing cached — three skeleton rows
/// shaped like the saved-view rows.
struct SavedViewMenuLoadingRows: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 18, cornerRadius: TSRadius.sm)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SavedViewMenuStrings.string(
            "savedViews.loadingA11y", "Loading saved views"
        )))
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state — a compact error tile with a retry affordance, shown inside the popover.
/// The message is the runtime failure reason, rendered verbatim.
struct SavedViewMenuErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: SavedViewMenuStrings.string("savedViews.errorTitle", "Couldn't load saved views"))
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
                Text(verbatim: SavedViewMenuStrings.string("savedViews.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: SavedViewMenuStrings.string("savedViews.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (web popover `EmptyState` + Save action)

/// The empty render — a friendly empty-state card with a "Save current view…" action, the native
/// parity of the web popover's `EmptyState` (which carries the same save action), never a blank box.
struct SavedViewMenuEmptyView: View {
    let message: String
    let saveLabel: String
    let onSave: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TSEmptyState(
                title: LocalizedStringKey(message),
                systemImage: "bookmark"
            )
            TSButton(variant: .secondary, size: .small, action: onSave) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "plus").font(.system(size: 12, weight: .semibold))
                        .accessibilityHidden(true)
                    Text(verbatim: saveLabel)
                }
            }
            .accessibilityLabel(Text(verbatim: saveLabel))
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beside the trigger when the feed is not live — a colored dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the feed.
struct SavedViewFreshnessChip: View {
    let connection: SavedViewMenuConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: SavedViewMenuStrings.string("savedViews.live", "Live")
        case .stale: SavedViewMenuStrings.string("savedViews.stale", "Stale")
        case .offline: SavedViewMenuStrings.string("savedViews.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            SavedViewMenuStrings.string("savedViews.staleA11y", "Stale — tap to refresh")
        case .offline:
            SavedViewMenuStrings.string("savedViews.offlineA11y", "Offline — showing the last saved views")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
