//
//  GotoIndicator.States.swift
//  TeslaSync — P4 shared surface · 0121 · GotoIndicator (Apple)
//
//  The P4 leaf-contract chrome composed by `GotoIndicator` when the surface is not in its data state:
//  the loading skeleton (the indicator's pill shape as shimmer while the shortcut controller is read),
//  the empty state (the chord is not pending — the friendly native improvement over the web component
//  rendering nothing, never a blank box), and the error tile with a retry affordance (web `QueryError`
//  peer). All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (controller read / initial fetch)

/// The initial-read chrome — a skeleton pill that keeps the indicator's shape (prompt line + two key-cap
/// shapes) while the shortcut controller is read.
struct GotoLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSSkeleton(width: 54, height: 12)
            TSSkeleton(width: 22, height: 22, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 22, height: 22, cornerRadius: TSRadius.sm)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .background(TSMaterial.overlay, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: GotoStrings.string("shortcuts.loadingA11y", "Loading shortcut")))
    }
}

// MARK: - Empty (chord not pending)

/// The empty render — a friendly card stating no shortcut prompt is active, the native improvement over
/// the web component rendering nothing (per the P4 leaf contract, the surface never collapses to a blank
/// box).
struct GotoEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(GotoStrings.string("shortcuts.empty", "No shortcut active")),
                message: LocalizedStringKey(GotoStrings.string(
                    "shortcuts.emptyMessage",
                    "Press the shortcut key and the hint will appear here."
                )),
                systemImage: "keyboard"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The controller-failure state (web `QueryError` peer) — a compact error card with a retry affordance.
/// The message is the runtime failure reason, rendered verbatim.
struct GotoErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: GotoStrings.string("shortcuts.errorTitle", "Couldn't load the shortcut hint"))
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
                    Text(verbatim: GotoStrings.string("shortcuts.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: GotoStrings.string("shortcuts.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
