//
//  DraftRecoveryBanner.States.swift
//  TeslaSync — P4 shared surface · 0116 · DraftRecoveryBanner (Apple)
//
//  The P4 leaf-contract chrome composed by `DraftRecoveryBanner` when the surface is not in its data
//  state: the loading skeleton (the banner shape as shimmer while the draft store is read), the empty
//  state (no recovered draft — the friendly native improvement over the web component rendering
//  nothing, never a blank box), and the error tile with a retry affordance (web `QueryError` peer).
//  All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (store read / initial fetch)

/// The initial-read chrome — a skeleton banner that keeps the surface's shape (icon + message line +
/// two action shapes) while the draft store is read.
struct DraftRecoveryLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(height: 12)
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 72, height: 24, cornerRadius: TSRadius.md)
                    TSSkeleton(width: 88, height: 24, cornerRadius: TSRadius.md)
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
        .accessibilityLabel(Text(verbatim: DraftRecoveryStrings.string("draft.loadingA11y", "Loading draft")))
    }
}

// MARK: - Empty (no recovered draft)

/// The empty render — a friendly card stating there is no draft to restore, the native improvement
/// over the web component rendering nothing (per the P4 leaf contract, the surface never collapses to
/// a blank box).
struct DraftRecoveryEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(DraftRecoveryStrings.string("draft.empty", "No draft to restore")),
                message: LocalizedStringKey(DraftRecoveryStrings.string(
                    "draft.emptyMessage",
                    "Your unsaved edits will appear here if you leave and come back."
                )),
                systemImage: "arrow.uturn.backward"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The store-failure state (web `QueryError` peer) — a compact error card with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim.
struct DraftRecoveryErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: DraftRecoveryStrings.string("draft.errorTitle", "Couldn't load your draft"))
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
                    Text(verbatim: DraftRecoveryStrings.string("draft.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: DraftRecoveryStrings.string("draft.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
