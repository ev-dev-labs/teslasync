//
//  SessionExpiringModal.States.swift
//  TeslaSync — P4 modal / dialog · 0009 · SessionExpiringModal (Apple)
//
//  The non-content states `SessionExpiringModal` switches over — loading (initial `/auth/session`
//  poll), empty (resolved with no countdown to show, e.g. open mode / no near-expiry under an
//  intentionally-presented dialog), error (poll failed → `QueryError` with retry), the inline
//  reload error, and the live-state freshness chip + cached-data banner. Every state renders real
//  chrome — never a blank box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (initial session poll)

/// The first-paint loading state under the header (web initial poll), so the layout doesn't reflow
/// when the session snapshot resolves.
struct SessionExpiringLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            SessionExpiringStrings.text("session.expiring.loading", "Checking your session…")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (resolved with no countdown)

/// The resolved-but-no-countdown state over a native `ContentUnavailableView` (never a blank box).
/// The web modal simply wouldn't open here; an intentionally-presented dialog shows this friendly
/// "session active" state instead of vanishing (engineering guideline #6).
struct SessionExpiringEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SessionExpiringStrings.text("session.expiring.emptyTitle", "Your session is active")
            } icon: {
                Image(systemName: "checkmark.shield")
            }
        } description: {
            SessionExpiringStrings.text(
                "session.expiring.emptyMessage", "We'll warn you here before it expires."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The poll-failure state with a retry affordance (web `QueryError`), so a first-load failure with
/// no cached countdown isn't a blank box.
struct SessionExpiringErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SessionExpiringStrings.text("session.expiring.errorTitle", "Couldn't check your session")
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
            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            SessionExpiringStrings.text("session.expiring.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SessionExpiringStrings.text("session.expiring.retry", "Retry"))
    }
}

// MARK: - Inline reload error (web cached-countdown-with-failure)

/// The inline reload error shown above the content when a refresh failed but a cached countdown
/// remains, so the warning stays usable while the failure is surfaced.
struct SessionExpiringInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            SessionExpiringStrings.text("session.expiring.errorTitle", "Couldn't check your session")
                .font(Font.TS.caption)
            if !message.isEmpty {
                Text(verbatim: message).font(Font.TS.caption)
            }
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct SessionExpiringFreshnessChip: View {
    let connection: SessionExpiringConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            SessionExpiringStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SessionExpiringStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: SessionExpiringConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "session.expiring.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "session.expiring.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "session.expiring.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the body when the bound source is not live, so a countdown
/// driven by a cached poll is clearly labeled (ADR-013).
struct SessionExpiringConnectivityBanner: View {
    let connection: SessionExpiringConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "session.expiring.offlineBanner" : "session.expiring.staleBanner"
        let fallback = offline
            ? "Offline — this countdown is from the last check"
            : "Reconnecting — this countdown may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            SessionExpiringStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
