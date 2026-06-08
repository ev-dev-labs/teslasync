//
//  ActiveSessionsSection.States.swift
//  TeslaSync — P4 feature view · 0197 · ActiveSessionsSection (Apple)
//
//  The non-content states `ActiveSessionsSection` switches over — loading (web
//  Spinner), open-mode (web AUTH_MODE_OPEN notice), empty, error (web
//  `QueryError` with retry), the inline list-error, and the live-state freshness chip
//  + cached-data banner. Every state renders real chrome — never a blank box. Copy via
//  P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web Spinner + "Loading sessions…")

/// The first-paint loading state rendered inside the panel chrome (web `<GlassPanel>…
/// <Spinner/> Loading sessions…`), so the layout doesn't reflow when data arrives.
struct ActiveSessionsLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            ActiveSessionsStrings.text("sessions.loading", "Loading sessions…")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Open mode (web AUTH_MODE_OPEN notice)

/// The forward-auth-required notice shown when the backend reports
/// AUTH_MODE_OPEN, so per-device sessions can't be tracked (web open-mode branch).
struct ActiveSessionsOpenModeState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                ActiveSessionsStrings.text("sessions.openMode.title", "Active sessions")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            ActiveSessionsStrings.text("sessions.openMode.message", Self.messageFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private static let messageFallback =
        "Active session tracking requires forward-auth mode. Configure your reverse proxy to inject "
            + "X-Forwarded-User then reload."
}

// MARK: - Empty (web "No active sessions for this account.")

/// The resolved-but-no-sessions state (web `DataTable` `emptyMessage`) over a native
/// `ContentUnavailableView`. Never a blank box.
struct ActiveSessionsEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                ActiveSessionsStrings.text("sessions.empty", "No active sessions for this account.")
            } icon: {
                Image(systemName: "laptopcomputer.slash")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web inline error widened to a
/// `QueryError`-style panel so a first-load failure isn't a blank box).
struct ActiveSessionsErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ActiveSessionsStrings.text("sessions.errors.load", "Failed to load active sessions.")
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
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            ActiveSessionsStrings.text("sessions.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(ActiveSessionsStrings.text("sessions.retry", "Retry"))
    }
}

// MARK: - Inline list-error (web inline `ErrorText` above the table)

/// The inline list-load error shown above the populated rows when a reload failed but
/// cached rows remain (web `{sessions.isError ? <ErrorText> : null}`).
struct ActiveSessionsInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            ActiveSessionsStrings.text("sessions.errors.load", "Failed to load active sessions.")
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
struct ActiveSessionsFreshnessChip: View {
    let connection: ActiveSessionsConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            ActiveSessionsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ActiveSessionsStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: ActiveSessionsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "sessions.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "sessions.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "sessions.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the content when the bound source is not live,
/// so a cached list is clearly labeled (ADR-013).
struct ActiveSessionsConnectivityBanner: View {
    let connection: ActiveSessionsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "sessions.offlineBanner" : "sessions.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded sessions"
            : "Reconnecting — this list may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            ActiveSessionsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
