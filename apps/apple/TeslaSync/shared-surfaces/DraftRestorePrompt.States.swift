//
//  DraftRestorePrompt.States.swift
//  TeslaSync — P4 shared surface · 0117 · DraftRestorePrompt (Apple)
//
//  The P4 leaf-contract chrome composed by `DraftRestorePrompt` when the surface is not in its data
//  state: the loading skeleton (the toast card's shape as shimmer while the index is read), the empty
//  state (no drafts to restore — the friendly native improvement over the web rendering nothing, never
//  a blank box), and the error tile with a retry affordance (web `QueryError` peer, which the web
//  surface lacks). All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (cross-tab grace window / index read)

/// The initial-read chrome — a skeleton card that keeps the prompt's shape (warning chip + title + body
/// + two actions) while the draft index is read and the cross-tab grace window elapses.
struct DraftRestoreLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 28, height: 28, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 150, height: 14)
                TSSkeleton(height: 12)
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 72, height: 24, cornerRadius: TSRadius.md)
                    TSSkeleton(width: 72, height: 24, cornerRadius: TSRadius.md)
                }
            }
            Spacer(minLength: 0)
            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 384, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: DraftRestoreStrings.string(
            "draft.recovery.loadingA11y", "Loading drafts"
        )))
    }
}

// MARK: - Empty (no drafts to restore)

/// The empty render — a friendly card stating there are no drafts to restore (web
/// `draft.recovery.empty`, "No drafts to restore."), the native improvement over the web rendering
/// nothing. Per the P4 leaf contract the surface never collapses to a blank box while it is showing.
struct DraftRestoreEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(DraftRestoreStrings.string(
                    "draft.recovery.empty", "No drafts to restore."
                )),
                message: LocalizedStringKey(DraftRestoreStrings.string(
                    "draft.recovery.emptyMessage",
                    "Unsaved work you start on this device will be offered for recovery here."
                )),
                systemImage: "checkmark.circle"
            )
        }
        .frame(maxWidth: 384)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The index-read-failure state (web `QueryError` peer) — a compact error card with a retry affordance.
/// The message is the runtime failure reason, rendered verbatim.
struct DraftRestoreErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: DraftRestoreStrings.string(
                    "draft.recovery.errorTitle", "Couldn't load drafts"
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
                    Text(verbatim: DraftRestoreStrings.string("draft.recovery.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: DraftRestoreStrings.string(
                    "draft.recovery.retry", "Retry"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: 384)
        .accessibilityElement(children: .combine)
    }
}
