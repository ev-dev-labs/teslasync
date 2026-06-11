//
//  ReloadPrompt.States.swift
//  TeslaSync — P4 shared surface · 0136 · ReloadPrompt (Apple)
//
//  The P4 leaf-contract chrome composed by `ReloadPrompt` when the surface is not in its data state: the
//  loading skeleton (the banner shape as shimmer while the first update check is in flight), the empty
//  state (no newer build — the friendly native improvement over the web rendering `null`, never a blank
//  box), and the error tile with a retry affordance (web `QueryError` peer, for a failed registration).
//  All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (first update check in flight)

/// The initial-check chrome — a skeleton banner that keeps the surface's shape (icon badge + title +
/// status line + two actions) while the registration reports its first update check.
struct ReloadPromptLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.md)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 140, height: 12)
                TSSkeleton(width: 96, height: 10)
            }
            Spacer(minLength: TSSpacing.md)
            TSSkeleton(width: 56, height: 28, cornerRadius: TSRadius.md)
            TSSkeleton(width: 88, height: 28, cornerRadius: TSRadius.md)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: ReloadPromptStrings.string(
            "pwa.checkingA11y", "Checking for updates"
        )))
    }
}

// MARK: - Empty (no newer build — "up to date")

/// The empty render — a friendly card stating the app is on the latest version, the native improvement
/// over the web rendering `null` when `needRefresh` is false (per the P4 leaf contract, the surface
/// never collapses to a blank box).
struct ReloadPromptEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(ReloadPromptStrings.string(
                    "pwa.upToDate", "You're up to date"
                )),
                message: LocalizedStringKey(ReloadPromptStrings.string(
                    "pwa.upToDateMessage",
                    "You're running the latest version. We'll let you know the moment an update is ready."
                )),
                systemImage: "checkmark.seal"
            )
        }
        .frame(maxWidth: 420)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The registration-failure state (web `onRegisterError` / `QueryError` peer) — a compact error card
/// with a retry affordance. The message is the runtime failure reason, rendered verbatim.
struct ReloadPromptErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: ReloadPromptStrings.string(
                    "pwa.errorTitle", "Couldn't check for updates"
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
                    Text(verbatim: ReloadPromptStrings.string("pwa.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: ReloadPromptStrings.string("pwa.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: 420)
        .accessibilityElement(children: .combine)
    }
}
