//
//  AchievementUnlockListener.States.swift
//  TeslaSync — P4 shared surface · 0112 · AchievementUnlockListener (Apple)
//
//  The P4 leaf-contract chrome composed by `AchievementUnlockListener` when it is not presenting the
//  celebration stack: the loading skeleton (a toast-shaped shimmer), the two friendly empty states
//  (the steady "no new achievements" queue-empty state and the "celebrations off" opt-out state — the
//  native parity of the web `if (!prefs.showToasts) return null` / empty `recent`, never a blank box),
//  and the error tile with a retry affordance (web `QueryError` peer). All copy resolves through the
//  P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (SSE feed resolving)

/// The initial-fetch chrome — a toast-shaped skeleton (medallion + two text lines + a small action)
/// so the layout does not jump when the first celebration lands. Shimmer respects Reduce Motion via
/// the shared `TSSkeleton`.
struct AchievementUnlockListenerLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 44, height: 44, cornerRadius: TSRadius.pill)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 120, height: 10)
                TSSkeleton(width: 180, height: 12)
                TSSkeleton(width: 64, height: 24, cornerRadius: TSRadius.sm)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 360, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AchievementUnlockListenerStrings.string(
            "achievements.listener.loadingA11y",
            "Loading achievement celebrations"
        )))
    }
}

// MARK: - Empty (no visible toast — web empty `recent` / `!showToasts`)

/// The empty render — a friendly state describing why no celebration is showing: the queue is empty
/// (the steady state) or the user switched celebrations off. The native parity of the web listener
/// rendering nothing, improved to never collapse to a blank box (P4 leaf contract).
struct AchievementUnlockListenerEmptyView: View {
    let reason: AchievementUnlockListenerEmptyReason

    private var title: String {
        switch reason {
        case .noUnlocks:
            AchievementUnlockListenerStrings.string("achievements.listener.empty.title", "No new achievements")
        case .celebrationsOff:
            AchievementUnlockListenerStrings.string(
                "achievements.listener.off.title",
                "Celebrations are off"
            )
        }
    }

    private var message: String {
        switch reason {
        case .noUnlocks:
            AchievementUnlockListenerStrings.string(
                "achievements.listener.empty.message",
                "Newly unlocked achievements will be celebrated here."
            )
        case .celebrationsOff:
            AchievementUnlockListenerStrings.string(
                "achievements.listener.off.message",
                "Turn on celebration toasts in Settings to see unlocks here. Your achievements are still tracked."
            )
        }
    }

    private var systemImage: String {
        reason == .celebrationsOff ? "bell.slash" : "trophy"
    }

    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(title),
            message: LocalizedStringKey(message),
            systemImage: systemImage
        )
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Unavailable (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance that
/// re-subscribes to the unlock stream.
struct AchievementUnlockListenerUnavailableView: View {
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: AchievementUnlockListenerStrings.string(
                    "achievements.listener.errorTitle",
                    "Couldn't load achievement celebrations"
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    Text(verbatim: AchievementUnlockListenerStrings.string(
                        "achievements.listener.retry",
                        "Retry"
                    ))
                }
                .accessibilityLabel(Text(verbatim: AchievementUnlockListenerStrings.string(
                    "achievements.listener.retryA11y",
                    "Retry loading achievement celebrations"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }
}
