//
//  EditConflictBanner.States.swift
//  TeslaSync — P4 shared surface · 0118 · EditConflictBanner (Apple)
//
//  The P4 leaf-contract chrome composed by `EditConflictBanner` when the surface is not in its data
//  state: the loading skeleton (the banner shape as shimmer while the lease election is in flight — the
//  web hook's pre-election window), the empty state (no conflict — the friendly native improvement over
//  the web component rendering nothing, never a blank box), and the error tile with a retry affordance
//  (web `QueryError` peer). All copy resolves through the P1/S10 facade; all colour comes from the
//  P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (lease election / initial fetch)

/// The initial-read chrome — a skeleton banner that keeps the surface's shape (icon + title line + an
/// action shape) while the lease election is in flight.
struct EditConflictLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(height: 12)
                TSSkeleton(width: 220, height: 10)
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 120, height: 24, cornerRadius: TSRadius.md)
                    TSSkeleton(width: 96, height: 12)
                }
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: EditConflictStrings.string(
            "editConflict.loadingA11y",
            "Checking for edit conflicts"
        )))
    }
}

// MARK: - Empty (no conflict)

/// The empty render — a friendly card stating there is no edit conflict, the native improvement over
/// the web component rendering nothing (per the P4 leaf contract, the surface never collapses to a
/// blank box).
struct EditConflictEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(EditConflictStrings.string("editConflict.empty", "No edit conflict")),
                message: LocalizedStringKey(EditConflictStrings.string(
                    "editConflict.emptyMessage",
                    "No other tab is editing this right now."
                )),
                systemImage: "checkmark.circle"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim.
struct EditConflictErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: EditConflictStrings.string(
                    "editConflict.errorTitle",
                    "Couldn't check for edit conflicts"
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
                    Text(verbatim: EditConflictStrings.string("editConflict.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: EditConflictStrings.string("editConflict.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
