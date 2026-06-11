//
//  AchievementUnlockedToast.States.swift
//  TeslaSync — P4 shared surface · 0111 · AchievementUnlockedToast (Apple)
//
//  The P4 leaf-contract chrome composed by `AchievementUnlockedToastStack` when the surface is not in
//  its data state: the loading skeleton (the toast shape as shimmer), the empty state (no pending
//  unlocks — the friendly native improvement over the web stack rendering nothing, never a blank box),
//  and the error tile with a retry affordance (web `QueryError` peer). All copy resolves through the
//  P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (feed connecting / initial fetch)

/// The initial-fetch chrome — a skeleton toast that keeps the surface's shape (badge circle + eyebrow
/// + name + description + an action) while the unlock feed connects.
struct AchievementUnlockedLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 48, height: 48, cornerRadius: TSRadius.md)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 120, height: 10)
                TSSkeleton(width: 160, height: 14)
                TSSkeleton(height: 12)
                TSSkeleton(width: 64, height: 12)
            }
            Spacer(minLength: 0)
            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AchievementUnlockedStrings.string(
            "achievements.loadingA11y", "Loading achievements"
        )))
    }
}

// MARK: - Empty (no pending unlocks)

/// The empty render — a friendly card stating that no achievements have been unlocked yet, the native
/// improvement over the web stack rendering nothing (per the P4 leaf contract, the surface never
/// collapses to a blank box).
struct AchievementUnlockedEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(AchievementUnlockedStrings.string(
                    "achievements.empty", "No new achievements"
                )),
                message: LocalizedStringKey(AchievementUnlockedStrings.string(
                    "achievements.emptyMessage",
                    "Unlocked achievements are celebrated here as you reach new milestones."
                )),
                systemImage: "trophy"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim.
struct AchievementUnlockedErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: AchievementUnlockedStrings.string(
                    "achievements.errorTitle", "Couldn't load achievements"
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
                    Text(verbatim: AchievementUnlockedStrings.string("achievements.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: AchievementUnlockedStrings.string(
                    "achievements.retry", "Retry"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
