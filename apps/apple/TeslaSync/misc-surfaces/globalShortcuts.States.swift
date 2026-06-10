//
//  globalShortcuts.States.swift
//  TeslaSync — P4 misc surface · 0002 · globalShortcuts (Apple)
//
//  The P4 leaf-contract chrome composed by `GlobalShortcuts` when the surface is not in
//  its data state: the loading skeleton (shimmer sections), the empty state (no
//  registered shortcuts), and the error tile with a retry affordance. Each keeps the
//  surface's shape so it never collapses to a blank box. All copy resolves through the
//  P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web parent `isLoading`)

/// The initial-fetch chrome — two skeleton group sections, each a skeleton header
/// over skeleton rows in a card, so the surface keeps its shape while the registry
/// resolves.
struct GlobalShortcutsLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< 2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 120, height: 12)
                    TSCard {
                        VStack(spacing: TSSpacing.md) {
                            ForEach(0 ..< 3, id: \.self) { _ in
                                HStack(spacing: TSSpacing.md) {
                                    TSSkeleton(width: 160, height: 12)
                                    Spacer(minLength: TSSpacing.sm)
                                    TSSkeleton(width: 48, height: 20, cornerRadius: TSRadius.sm)
                                }
                            }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: GlobalShortcutsStrings.string(
            "shortcuts.loadingA11y", "Loading keyboard shortcuts"
        )))
    }
}

// MARK: - Empty (resolved, no registered shortcuts)

/// The empty render (resolved, no registered shortcuts) — a friendly empty-state card
/// with a keyboard glyph, never a blank box.
struct GlobalShortcutsEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(GlobalShortcutsStrings.string(
                    "shortcuts.empty", "No shortcuts registered"
                )),
                message: LocalizedStringKey(GlobalShortcutsStrings.string(
                    "shortcuts.emptyMessage", "Keyboard shortcuts will appear here once they're registered."
                )),
                systemImage: "keyboard"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The fetch-failure state (web `QueryError` peer) — a compact error card with a retry
/// affordance. The message is the runtime failure reason, rendered verbatim.
struct GlobalShortcutsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: GlobalShortcutsStrings.string("shortcuts.errorTitle", "Couldn't load shortcuts"))
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
                    Text(verbatim: GlobalShortcutsStrings.string("shortcuts.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: GlobalShortcutsStrings.string("shortcuts.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
