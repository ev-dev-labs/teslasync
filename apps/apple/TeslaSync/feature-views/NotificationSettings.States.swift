//
//  NotificationSettings.States.swift
//  TeslaSync — P4 feature view · 0208 · NotificationSettings (Apple)
//
//  The load-envelope chrome for the settings "Notifications" feature view: the initial-fetch skeleton
//  (redacted rows), the resolved-but-empty surface state (web `EmptyState`), and the fetch-failure state
//  with a retry affordance (web `QueryError`). Token-driven (P1/S9); copy via the P1/S10 facade. Never a
//  blank panel.
//

import SwiftUI

// MARK: - Loading state (web skeleton chrome)

/// One redacted skeleton row. Static bars (no shimmer) so it is reduce-motion-safe by construction.
struct NotificationSkeletonRow: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(Color.TS.border.opacity(0.4))
                .frame(width: 160, height: 12)
            Spacer()
            Capsule()
                .fill(Color.TS.border.opacity(0.4))
                .frame(width: 40, height: 22)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// The initial-fetch skeleton (web `<Skeleton>` shell): a stack of redacted toggle rows in the same shape
/// as the resolved content. Never a blank panel.
struct NotificationSettingsLoading: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 4, id: \.self) { _ in
                NotificationSkeletonRow()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            NotificationSettingsStrings.text("notifications.settings.loading", "Loading notification settings")
        )
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The resolved-but-empty surface state: a friendly `ContentUnavailableView`, never a blank box. Reached
/// only when the read reports no notification capability and no channels.
struct NotificationSettingsEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                NotificationSettingsStrings.text(
                    "notifications.settings.empty.title",
                    "Notification settings are unavailable"
                )
            } icon: {
                Image(systemName: "bell.slash")
            }
        } description: {
            NotificationSettingsStrings.text(
                "notifications.settings.empty.hint",
                "Notification and sound options will appear here once this device supports them."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 180)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Surfaces the failure message under
/// the title when present, and mirrors the inline error treatment used across the feature-view surfaces.
struct NotificationSettingsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            NotificationSettingsStrings.text(
                "notifications.settings.error.title",
                "Couldn't load notification settings"
            )
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
                NotificationSettingsStrings.text("notifications.settings.error.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                NotificationSettingsStrings.text("notifications.settings.error.retry", "Retry")
            )
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
