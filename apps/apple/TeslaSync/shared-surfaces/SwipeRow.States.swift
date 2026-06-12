//
//  SwipeRow.States.swift
//  TeslaSync — P4 shared surface · 0189 · SwipeRow (Apple)
//
//  The P4 leaf-contract chrome `SwipeRow` renders when the wrapped row is not shown: the loading
//  skeleton row (an avatar + two text lines so the surface keeps a row's footprint while the host
//  resolves it), the friendly empty state (no row to show — never a blank box), and the error row
//  with a Retry affordance (web `QueryError` peer). Plus the orthogonal freshness axis the web pure
//  render has no concept of: a tappable chip + an inline banner shown when the feed is stale / offline
//  while the last row stays visible + swipeable. All copy resolves through the P1/S10 facade; all
//  colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (host resolving the row)

/// The initial-fetch chrome — a skeleton shaped like a list row (leading avatar + a title line + a
/// subtitle line) so the surface keeps its footprint while the host resolves the row. Shimmer honors
/// Reduce Motion via the shared `TSSkeleton`.
struct SwipeRowLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.pill)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 160, height: 12)
                TSSkeleton(height: 12)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SwipeRowStrings.string(
            "swipeRow.loadingA11y", "Loading row"
        )))
    }
}

// MARK: - Empty (no row to show)

/// The friendly empty state — the list resolved with no row to wrap, so rather than a blank box the
/// surface shows a localized message.
struct SwipeRowEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(SwipeRowStrings.string(
                    "swipeRow.empty.title", "Nothing here"
                )),
                message: LocalizedStringKey(SwipeRowStrings.string(
                    "swipeRow.empty.message", "There is nothing to show in this list yet."
                )),
                systemImage: "tray"
            )
        }
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("swipeRow-empty")
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error row with a Retry affordance. The
/// message is the runtime failure reason, surfaced through the shared error display.
struct SwipeRowErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSQueryError(
            message: message.isEmpty ? nil : LocalizedStringKey(message),
            onRetry: onRetry
        )
        .accessibilityIdentifier("swipeRow-error")
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown when the feed is not live — a coloured dot + label, tappable to refresh.
struct SwipeRowFreshnessChip: View {
    let connection: SwipeRowConnection
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
        case .live: SwipeRowStrings.string("swipeRow.live", "Live")
        case .stale: SwipeRowStrings.string("swipeRow.stale", "Stale")
        case .offline: SwipeRowStrings.string("swipeRow.offline", "Offline")
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live:
            label
        case .stale:
            SwipeRowStrings.string("swipeRow.staleA11y", "Stale — tap to refresh")
        case .offline:
            SwipeRowStrings.string("swipeRow.offlineA11y", "Offline — showing the last known row")
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
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Freshness banner (P4 connectivity axis)

/// The inline banner shown beneath the row when the feed is stale / offline — explains why the row
/// may be out of date while it stays interactive. Tappable to refresh.
struct SwipeRowFreshnessBanner: View {
    let connection: SwipeRowConnection
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var icon: String {
        connection == .offline ? "wifi.slash" : "clock.arrow.circlepath"
    }

    private var message: String {
        switch connection {
        case .offline:
            SwipeRowStrings.string(
                "swipeRow.offlineBanner", "You're offline — showing the last cached row."
            )
        default:
            SwipeRowStrings.string(
                "swipeRow.staleBanner", "Showing a slightly out-of-date row."
            )
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(tone)
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text(verbatim: SwipeRowStrings.string("swipeRow.refresh", "Refresh")))
    }
}
