//
//  Layout.Shell.swift
//  TeslaSync — P4 shared surface · 0169 · Layout (Apple)
//
//  The outer-shell chrome of the app layout — the native peers of the web shell regions beyond the sidebar:
//  the compact header bar (web mobile top bar — menu / brand / bell / theme), the main content region (web
//  `<main>` with the breadcrumb-row quick-search hint + the routed `<Outlet>` slot), the P4 freshness chip,
//  and the always-render leaf states (loading skeleton chrome, empty-navigation state, error retry tile) so
//  the surface is never a blank box. Token-driven; every interactive element carries a VoiceOver label.
//

import SwiftUI

// MARK: - Header bar (web mobile top bar)

/// The compact header bar — the SwiftUI parity of the web mobile top bar (`role="banner"`,
/// `a11y.primaryHeader`): a sidebar toggle (`nav.openSidebar`), the brand lockup, the bell, and the theme
/// switcher. Used as the compact-width chrome; the wide layout keeps the sidebar permanently visible.
struct LayoutHeaderBar: View {
    let unread: Int
    let onOpenSidebar: () -> Void
    let onCustomizeTheme: () -> Void
    let onOpenNotifications: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Button(action: onOpenSidebar) {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: LayoutStrings.navOpenSidebar))

            TSLogo(showsWordmark: true)
            Spacer(minLength: TSSpacing.sm)
            LayoutBellTrigger(unread: unread, onOpen: onOpenNotifications)
            LayoutThemeSwitcher(onCustomize: onCustomizeTheme)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface)
        .overlay(alignment: .bottom) { Divider().overlay(Color.TS.border) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: LayoutStrings.a11yPrimaryHeader))
    }
}

// MARK: - Content region (web `<main>` + breadcrumb hint + Outlet)

/// The main content region — the SwiftUI parity of the web `<main role="main">`: the breadcrumb-row quick
/// search hint (`nav.quickSearchHint`) over the routed content slot (web `<Outlet>`).
struct LayoutContentRegion<Content: View>: View {
    let showHint: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if showHint {
                HStack {
                    Spacer(minLength: 0)
                    Text(verbatim: LayoutStrings.navQuickSearchHint)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                .overlay(alignment: .bottom) { Divider().overlay(Color.TS.border) }
                .padding(.bottom, TSSpacing.xs)
            }
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: LayoutStrings.mainContent))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown when the shell feeds are not live — a colored dot + a label (`Stale` / `Offline`).
/// It is a button so VoiceOver and pointer users can re-request the shell feeds.
struct LayoutShellFreshnessChip: View {
    let connection: LayoutConnection
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
        case .live: LayoutStrings.live
        case .stale: LayoutStrings.stale
        case .offline: LayoutStrings.offline
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live: LayoutStrings.live
        case .stale: LayoutStrings.staleA11y
        case .offline: LayoutStrings.offlineA11y
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

// MARK: - Loading (skeleton chrome)

/// The initial-fetch state — skeleton rows shaped like the sidebar so the surface keeps its shape while the
/// shell feeds resolve (web has no shell loading state; never a blank box).
struct LayoutLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 160, height: 28, cornerRadius: TSRadius.md)
            ForEach(0 ..< 6, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 28, height: 28, cornerRadius: TSRadius.sm)
                    TSSkeleton(height: 14)
                }
            }
        }
        .padding(TSSpacing.md)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: LayoutStrings.loadingA11y))
    }
}

// MARK: - Empty (fully-filtered navigation)

/// The empty-navigation state. The web shell never fully empties, but the P4 always-render contract turns a
/// fully-filtered nav (e.g. open mode with no fleet) into a friendly state rather than a blank box.
struct LayoutEmptyView: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "sidebar.left")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: LayoutStrings.emptyTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: LayoutStrings.emptyMessage)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (failed shell feed)

/// The fetch-failure state — an inline tile with a retry affordance. The message is the runtime failure
/// reason, exposed to VoiceOver but visually elided to keep the tile compact.
struct LayoutErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: LayoutStrings.errorTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: LayoutStrings.retry)
            }
            .accessibilityLabel(Text(verbatim: LayoutStrings.retry))
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    private var accessibilityText: String {
        message.isEmpty ? LayoutStrings.errorTitle : "\(LayoutStrings.errorTitle). \(message)"
    }
}
