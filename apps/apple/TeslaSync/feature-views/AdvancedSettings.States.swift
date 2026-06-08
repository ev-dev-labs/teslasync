//
//  AdvancedSettings.States.swift
//  TeslaSync — P4 feature view · 0198 · AdvancedSettings (Apple)
//
//  The load-state envelope for the "Restore confirmation prompts" panel: the initial-read skeleton
//  chrome, the resolved-but-empty no-prompts state (web `EmptyState`), and the read-failure state with
//  a retry affordance (the standard P4 error envelope). Token-driven (P1/S9); copy via the P1/S10
//  facade. Never a blank panel.
//

import SwiftUI

// MARK: - Loading skeleton (initial read)

/// The initial-read skeleton: a few greyed bars in the same bordered container the resolved list
/// uses, so the panel never flashes a blank box while the persisted set is read. Static (Reduce-Motion
/// safe) and hidden from VoiceOver behind a single "loading" label.
struct AdvancedSettingsLoadingView: View {
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0 ..< 3, id: \.self) { index in
                HStack(spacing: TSSpacing.md) {
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .fill(Color.TS.textMuted.opacity(0.16))
                        .frame(width: 160, height: 12)
                    Spacer(minLength: TSSpacing.sm)
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .fill(Color.TS.textMuted.opacity(0.12))
                        .frame(width: 64, height: 22)
                }
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.sm)
                if index < 2 {
                    Divider().overlay(Color.TS.border)
                }
            }
        }
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(AdvancedSettingsStrings.text(
            "advanced.restoreConfirms.loading",
            "Loading silenced prompts…"
        ))
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The resolved-but-empty state (web `silenced.length === 0`): a friendly `ContentUnavailableView`
/// carrying the web's "tick Don't ask again to silence" hint — never a blank box.
struct AdvancedSettingsEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                AdvancedSettingsStrings.text("advanced.restoreConfirms.emptyTitle", "No silenced prompts")
            } icon: {
                Image(systemName: "checkmark.circle")
            }
        } description: {
            AdvancedSettingsStrings.text(
                "advanced.restoreConfirms.empty",
                "No silenced prompts. Tick “Don’t ask again” on a confirmation dialog to silence it."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 140)
    }
}

// MARK: - Error state (standard P4 error envelope with retry)

/// The read-failure state with a retry affordance. Mirrors the inline error treatment used across the
/// feature-view surfaces (web `QueryError`).
struct AdvancedSettingsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            AdvancedSettingsStrings.text("advanced.restoreConfirms.errorTitle", "Couldn't load silenced prompts")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                AdvancedSettingsStrings.text("advanced.restoreConfirms.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(AdvancedSettingsStrings.text("advanced.restoreConfirms.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
