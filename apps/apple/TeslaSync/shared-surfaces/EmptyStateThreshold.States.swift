//
//  EmptyStateThreshold.States.swift
//  TeslaSync — P4 shared surface · 0119 · EmptyStateThreshold (Apple)
//
//  The P4 leaf-contract chrome composed by `EmptyStateThreshold` when the surface is not in its
//  `.threshold` state: the loading skeleton (the card shape as shimmer while the counts resolve), the
//  empty state (the section is no longer gated — a friendly "unlocked" card, never a blank box), and
//  the error tile with a retry affordance (web `QueryError` peer). All copy resolves through the
//  P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (counts resolving)

/// The initial-fetch chrome — a skeleton that keeps the surface's shape (a leading glyph + the title
/// and two message lines) while the host resolves the counts.
struct EmptyStateThresholdLoadingView: View {
    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 20, height: 20, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 140, height: 12)
                TSSkeleton(height: 12)
                TSSkeleton(width: 220, height: 12)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: shape)
        .overlay(shape.strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: EmptyStateThresholdStrings.string(
            "emptyStateThreshold.loadingA11y", "Loading section status"
        )))
    }
}

// MARK: - Empty (section no longer gated)

/// The empty render — a friendly card stating the section is ready, the native parity of the web host
/// no longer mounting the gate once the threshold is met (improved to never collapse to a blank box,
/// per the P4 leaf contract).
struct EmptyStateThresholdEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(EmptyStateThresholdStrings.string(
                    "emptyStateThreshold.empty", "Section ready"
                )),
                message: LocalizedStringKey(EmptyStateThresholdStrings.string(
                    "emptyStateThreshold.emptyMessage",
                    "There's enough data to show meaningful patterns here."
                )),
                systemImage: "checkmark.seal"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The count-feed failure state (web `QueryError` peer) — a compact error card with a retry
/// affordance. The message is the runtime failure reason, rendered verbatim.
struct EmptyStateThresholdErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: EmptyStateThresholdStrings.string(
                    "emptyStateThreshold.errorTitle", "Couldn't load section status"
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
                    Text(verbatim: EmptyStateThresholdStrings.string("emptyStateThreshold.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: EmptyStateThresholdStrings.string(
                    "emptyStateThreshold.retry", "Retry"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
