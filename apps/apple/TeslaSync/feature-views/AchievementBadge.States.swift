//
//  AchievementBadge.States.swift
//  TeslaSync — P4 feature view · 0051 · AchievementBadge (Apple)
//
//  The P4 leaf-contract chrome composed by `AchievementBadge` when the surface is not
//  in its data state: the loading skeleton, the empty placeholder, and the error tile // parity:allow ui
//  with a retry affordance. Each keeps the badge's rounded tile shape (the shared
//  `achievementBadgeSurface` modifier) so the surface never collapses to a blank box.
//  All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web parent `isLoading`)

/// The initial-fetch chrome — a circular skeleton over name / description / status
/// skeleton lines, so the badge keeps its shape while the parent query resolves.
struct AchievementBadgeLoadingView: View {
    let size: AchievementBadgeSize

    private var layout: AchievementBadgeLayout {
        AchievementBadgeLayout.of(size)
    }

    var body: some View {
        VStack(spacing: layout.gap) {
            TSSkeleton(
                width: layout.ringDiameter,
                height: layout.ringDiameter,
                cornerRadius: layout.ringDiameter / 2
            )
            TSSkeleton(width: layout.contentWidth * 0.7, height: 12)
            TSSkeleton(width: layout.contentWidth, height: 10)
            TSSkeleton(width: 36, height: 10)
        }
        .achievementBadgeSurface(background: Color.TS.textPrimary.opacity(0.04), border: Color.TS.border)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AchievementBadgeStrings.string(
            "achievement.loadingA11y", "Loading achievement"
        )))
    }
}

// MARK: - Empty (resolved, no achievement)

/// The empty render (resolved, no achievement) — a friendly placeholder tile with a // parity:allow ui
/// muted trophy glyph, never a blank box.
struct AchievementBadgeEmptyView: View {
    let size: AchievementBadgeSize

    private var layout: AchievementBadgeLayout {
        AchievementBadgeLayout.of(size)
    }

    var body: some View {
        VStack(spacing: layout.gap) {
            Image(systemName: "trophy")
                .font(.system(size: layout.iconPointSize))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: layout.ringDiameter, height: layout.ringDiameter)
                .accessibilityHidden(true)
            Text(verbatim: AchievementBadgeStrings.string("achievement.empty", "No achievement yet"))
                .font(.system(size: layout.captionPointSize))
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: layout.contentWidth)
        }
        .achievementBadgeSurface(background: Color.TS.textPrimary.opacity(0.04), border: Color.TS.border)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The fetch-failure state (web `QueryError` peer) — a compact error tile with a
/// retry affordance.
struct AchievementBadgeErrorView: View {
    let size: AchievementBadgeSize
    let message: String
    let onRetry: () -> Void

    private var layout: AchievementBadgeLayout {
        AchievementBadgeLayout.of(size)
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: layout.iconPointSize * 0.7))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: AchievementBadgeStrings.string("achievement.errorTitle", "Couldn't load achievement"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: AchievementBadgeStrings.string("achievement.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: AchievementBadgeStrings.string("achievement.retry", "Retry")))
        }
        .achievementBadgeSurface(background: Color.TS.textPrimary.opacity(0.04), border: Color.TS.border)
        .frame(maxWidth: layout.contentWidth + TSSpacing.x2xl)
        .accessibilityElement(children: .combine)
    }
}
