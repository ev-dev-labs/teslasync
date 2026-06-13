//
//  CommandPalette.States.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The P4 always-render leaf states of the command palette — the chrome composed when the surface is not in
//  its loaded "content" state, so it never collapses to a blank box: the loading skeleton rows (initial feed
//  fetch), the error tile with a retry affordance (the web has no `QueryError` peer — added here), the
//  friendly empty message (web empty-state ternary, resolved from ``PaletteEmptyMessageKind``), and the
//  freshness chip on the orthogonal stale / offline connectivity axis. All copy resolves through the P1/S10
//  facade; all color comes from the P1/S9 tokens; the shared `TSSkeleton` / `TSButton` primitives back the
//  loading + retry chrome.
//

import SwiftUI

// MARK: - Loading rows (initial feed fetch — skeleton chrome)

/// The initial-fetch results body — five skeleton rows shaped like a glyph + label + sublabel, so the card
/// keeps its shape while the composed feed resolves (never a blank box).
struct CommandPaletteLoadingRows: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 5, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 20, height: 20, cornerRadius: TSRadius.sm)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 168, height: 12)
                        TSSkeleton(width: 104, height: 10)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: CommandPaletteStrings.loadingA11y))
    }
}

// MARK: - Error tile (web `QueryError` peer)

/// The feed-failure state — a compact error tile with a retry affordance. The message is the runtime failure
/// reason, rendered verbatim.
struct CommandPaletteErrorTile: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: CommandPaletteStrings.errorTitle)
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
                Text(verbatim: CommandPaletteStrings.retry)
            }
            .accessibilityLabel(Text(verbatim: CommandPaletteStrings.retry))
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.xl)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty message (web empty-state ternary)

/// The friendly empty message — the native parity of the web empty-state copy, resolved from the pure
/// ``PaletteEmptyMessageKind`` so it never shows a bare box. Uses the shared `TSEmptyState`.
struct CommandPaletteEmptyMessage: View {
    let kind: PaletteEmptyMessageKind

    private var message: String {
        switch kind {
        case .noVehicles: CommandPaletteStrings.noVehicles
        case let .scopeEmpty(scope): CommandPaletteStrings.scopeEmpty(scope)
        case let .noResults(query): CommandPaletteStrings.noResults(query)
        }
    }

    private var glyph: String {
        switch kind {
        case .noVehicles: "car"
        case .scopeEmpty, .noResults: "magnifyingglass"
        }
    }

    var body: some View {
        TSEmptyState(title: LocalizedStringKey(message), systemImage: glyph)
            .accessibilityLabel(Text(verbatim: message))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown in the footer when the feed is not live — a colored dot + a `Stale` / `Offline`
/// label. It is a button so VoiceOver + pointer users can re-request the feed.
struct CommandPaletteFreshnessChip: View {
    let connection: PaletteConnection
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
        case .live: CommandPaletteStrings.live
        case .stale: CommandPaletteStrings.stale
        case .offline: CommandPaletteStrings.offline
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live: label
        case .stale: CommandPaletteStrings.staleA11y
        case .offline: CommandPaletteStrings.offlineA11y
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
