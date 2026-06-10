//
//  ConfirmDialog.States.swift
//  TeslaSync — P4 modal / dialog · 0012 · ConfirmDialog (Apple)
//
//  The non-content states `ConfirmDialog` switches over — loading (the request is still being
//  resolved), empty (resolved with nothing to confirm, e.g. an intentionally-presented dialog),
//  error (delivery failed → `QueryError` with retry), the inline reload error, and the live-state
//  freshness chip + cached-data banner. Every state renders real chrome — never a blank box. Copy
//  via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Severity tone (web `severityTokens` foreground/border tint)

/// Maps the resolved severity to its semantic token color (web `severityTokens[sev]`). Kept here so
/// the pure `ConfirmSeverity` core stays SwiftUI-free.
extension ConfirmSeverity {
    var tone: Color {
        switch self {
        case .critical: Color.TS.statusDanger
        case .warn: Color.TS.statusWarning
        }
    }
}

// MARK: - Loading (request still resolving)

/// The first-paint loading state rendered under the header, so the layout doesn't reflow when the
/// confirm request resolves.
struct ConfirmDialogLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            ConfirmDialogStrings.text("confirm.loading", "Preparing…")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (resolved with nothing to confirm)

/// The resolved-but-no-request state over a native `ContentUnavailableView` (never a blank box). The
/// web modal simply wouldn't open here; an intentionally-presented dialog shows this friendly
/// "nothing to confirm" state instead of vanishing (engineering guideline #6).
struct ConfirmDialogEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                ConfirmDialogStrings.text("confirm.empty", "Nothing to confirm")
            } icon: {
                Image(systemName: "checkmark.circle")
            }
        } description: {
            ConfirmDialogStrings.text(
                "confirm.emptyMessage", "There's no pending action that needs your confirmation."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The delivery-failure state with a retry affordance (web `QueryError` — a first-load failure
/// rendered as a panel with a retry, never a blank box).
struct ConfirmDialogErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ConfirmDialogStrings.text("confirm.errorTitle", "Couldn't load this confirmation")
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
            ConfirmDialogStrings.text("confirm.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(ConfirmDialogStrings.text("confirm.retry", "Retry"))
    }
}

// MARK: - Inline reload error (web cached-request-with-failure)

/// The inline reload error shown above the confirm content when a refresh failed but a cached
/// request remains, so the prompt stays usable while the failure is surfaced.
struct ConfirmDialogInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            ConfirmDialogStrings.text("confirm.errorTitle", "Couldn't load this confirmation")
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
struct ConfirmDialogFreshnessChip: View {
    let connection: ConfirmConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            ConfirmDialogStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ConfirmDialogStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: ConfirmConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "confirm.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "confirm.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "confirm.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the body when the bound source is not live, so a confirm
/// prompt assembled from a cached context is clearly labeled (ADR-013).
struct ConfirmDialogConnectivityBanner: View {
    let connection: ConfirmConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "confirm.offlineBanner" : "confirm.staleBanner"
        let fallback = offline
            ? "Offline — this prompt is from your last sync"
            : "Reconnecting — this prompt may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            ConfirmDialogStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
