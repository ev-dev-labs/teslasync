//
//  NotificationRow.Chrome.swift
//  TeslaSync — P4 feature view · 0191 · NotificationRow (Apple)
//
//  The state-envelope chrome around the inbox notification row: the freshness chip
//  (Live / Stale / Offline), the stale/offline connectivity banner, the loading
//  skeleton, the resolved-empty state, the error state with a retry affordance, and
//  the inline action toast. All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9).
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct NotificationRowFreshnessChip: View {
    let connection: NotificationRowConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: NotificationRowStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: NotificationRowStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: NotificationRowConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "notifications.inbox.row.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "notifications.inbox.row.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "notifications.inbox.row.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the row when the bound source is not live, so
/// the cached row is clearly labeled.
struct NotificationRowConnectivityBanner: View {
    let connection: NotificationRowConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "notifications.inbox.row.offlineBanner" : "notifications.inbox.row.staleBanner"
        let fallback = offline
            ? "Offline — showing the last known notification"
            : "Reconnecting — this notification may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: NotificationRowStrings.string(key, fallback)).font(Font.TS.caption)
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

/// Initial-fetch skeleton chrome for the row (web `Skeleton`), respecting Reduce
/// Motion via `TSSkeleton`.
struct NotificationRowLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            TSSkeleton(width: 20, height: 20, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 64, height: 16, cornerRadius: TSRadius.pill)
                    TSSkeleton(width: 80, height: 12)
                }
                TSSkeleton(width: 220, height: 14)
                TSSkeleton(width: 280, height: 12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: NotificationRowStrings.string(
            "notifications.inbox.row.loading",
            "Loading notification"
        )))
    }
}

/// The resolved-but-empty state — never a blank box.
struct NotificationRowEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: NotificationRowStrings.string("notifications.inbox.row.empty", "No notification"))
            } icon: {
                Image(systemName: "bell.slash")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 100)
        .accessibilityElement(children: .combine)
    }
}

/// The fetch-failure state with a retry affordance (web `QueryError`).
struct NotificationRowErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: NotificationRowStrings.string(
                "notifications.inbox.row.errorTitle",
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
                Text(verbatim: NotificationRowStrings.string("notifications.inbox.row.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: NotificationRowStrings.string("notifications.inbox.row.retry", "Retry")))
        }
        .frame(maxWidth: .infinity, minHeight: 100)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Action toast (web inline action feedback)

/// The inline toast raised after a per-row action fails (so errors are never silently
/// dropped).
struct NotificationRowToastView: View {
    let toast: NotificationRowToast

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
