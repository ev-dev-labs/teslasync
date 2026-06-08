//
//  NotificationGroupRow.Chrome.swift
//  TeslaSync — P4 feature view · 0190 · NotificationGroupRow (Apple)
//
//  The state-envelope chrome around the notification thread: the freshness chip
//  (Live / Stale / Offline), the stale/offline connectivity banner, the loading
//  skeleton, the resolved-empty state, the error state with a retry affordance, and
//  the action toast (web `useToast`). All copy resolves through the P1/S10 facade;
//  all chrome is token-driven (P1/S9).
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct NotificationGroupFreshnessChip: View {
    let connection: NotificationConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: NotificationGroupStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: NotificationGroupStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: NotificationConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "notifications.group.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "notifications.group.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "notifications.group.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the thread when the bound source is not
/// live, so the cached thread is clearly labeled.
struct NotificationGroupConnectivityBanner: View {
    let connection: NotificationConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "notifications.group.offlineBanner" : "notifications.group.staleBanner"
        let fallback = offline
            ? "Offline — showing the last known thread"
            : "Reconnecting — this thread may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: NotificationGroupStrings.string(key, fallback)).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading / empty / error envelope

/// Initial-fetch skeleton chrome for the thread (web `Skeleton`), respecting Reduce
/// Motion via `TSSkeleton`.
struct NotificationGroupLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(height: 56, cornerRadius: TSRadius.md)
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 90, height: 20, cornerRadius: TSRadius.pill)
                TSSkeleton(width: 60, height: 20, cornerRadius: TSRadius.pill)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: NotificationGroupStrings.string(
            "notifications.group.loading",
            "Loading notification"
        )))
    }
}

/// The resolved-but-empty state — never a blank box.
struct NotificationGroupEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: NotificationGroupStrings.string("notifications.group.empty", "No notifications"))
            } icon: {
                Image(systemName: "bell.slash")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .accessibilityElement(children: .combine)
    }
}

/// The fetch-failure state with a retry affordance (web `QueryError`).
struct NotificationGroupErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: NotificationGroupStrings.string(
                "notifications.group.errorTitle",
                "Couldn't load notification"
            ))
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
                Text(verbatim: NotificationGroupStrings.string("notifications.group.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: NotificationGroupStrings.string("notifications.group.retry", "Retry")))
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Action toast (web `useToast`)

/// The inline toast raised after the group mark-read action (web success/error toast).
struct NotificationGroupToastView: View {
    let toast: NotificationGroupToast

    private var tone: Color {
        switch toast.kind {
        case .success: Color.TS.statusSuccess
        case .error: Color.TS.statusDanger
        }
    }

    private var symbol: String {
        switch toast.kind {
        case .success: "checkmark.circle.fill"
        case .error: "exclamationmark.circle.fill"
        }
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: symbol).font(.system(size: 13, weight: .semibold))
            Text(verbatim: toast.message).font(Font.TS.caption)
            Spacer(minLength: 0)
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(tone.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: toast.message))
    }
}
