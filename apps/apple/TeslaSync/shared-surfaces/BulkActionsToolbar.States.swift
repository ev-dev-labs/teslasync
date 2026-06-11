//
//  BulkActionsToolbar.States.swift
//  TeslaSync — P4 shared surface · 0078 · BulkActionsToolbar (Apple)
//
//  The P4 leaf-contract chrome composed by `BulkActionsToolbar` when the surface is not in its active
//  state: the loading skeleton (the toolbar bar as shimmer), the empty state (no rows selected — the
//  web component renders nothing, here a friendly card so the surface never collapses to a blank
//  box), and the error tile with a retry affordance. All copy resolves through the P1/S10 facade; all
//  color comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web parent `isLoading`)

/// The initial-fetch chrome — a skeleton count chip over two skeleton action pills and a clear pill,
/// shaped like the toolbar so the surface keeps its shape while the feed resolves.
struct BulkActionsLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSSkeleton(width: 96, height: 22, cornerRadius: TSRadius.pill)
            Spacer(minLength: TSSpacing.md)
            TSSkeleton(width: 84, height: 28, cornerRadius: TSRadius.md)
            TSSkeleton(width: 84, height: 28, cornerRadius: TSRadius.md)
            TSSkeleton(width: 64, height: 28, cornerRadius: TSRadius.md)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .tsGlassPanel()
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: BulkActionsToolbarStrings.string(
            "bulk.loadingA11y", "Loading bulk actions"
        )))
    }
}

// MARK: - Empty (web "render nothing" — no rows selected)

/// The empty render — a friendly empty-state card with a selection glyph, never a blank box. The
/// native parity of the web component returning `null` while `selectedIds` is empty.
struct BulkActionsEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(BulkActionsToolbarStrings.string(
                    "bulk.empty.title", "No items selected"
                )),
                message: LocalizedStringKey(BulkActionsToolbarStrings.string(
                    "bulk.empty.message",
                    "Select one or more rows to act on them in bulk."
                )),
                systemImage: "checklist"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim.
struct BulkActionsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: BulkActionsToolbarStrings.string(
                    "bulk.error.title", "Couldn't load bulk actions"
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
                    Text(verbatim: BulkActionsToolbarStrings.string("bulk.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: BulkActionsToolbarStrings.string("bulk.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
