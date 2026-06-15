//
//  AiConfirmDialog.States.swift
//  TeslaSync — P4 modal / dialog · 0001 · ConfirmDialog (Apple)
//
//  The non-content states `AiConfirmDialog` switches over — loading (the request is still resolving),
//  empty (resolved with nothing to approve, e.g. an intentionally-presented dialog), error (delivery
//  failed → `QueryError` with retry), the inline reload error, and the live-state freshness chip +
//  cached-data banner. Every state renders real chrome — never a blank box. Copy via P1/S10; chrome via
//  P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (request still resolving)

/// The first-paint loading state rendered under the header, so the layout doesn't reflow when the
/// request resolves.
struct AiConfirmLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            AiConfirmStrings.text("ai.confirm.loading", "Preparing…")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (resolved with nothing to approve)

/// The resolved-but-no-request state over a native `ContentUnavailableView` (never a blank box). The
/// web modal simply wouldn't open here; an intentionally-presented dialog shows this friendly
/// "nothing to approve" state instead of vanishing (engineering guideline #6).
struct AiConfirmEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                AiConfirmStrings.text("ai.confirm.empty", "Nothing to approve")
            } icon: {
                Image(systemName: "checkmark.seal")
            }
        } description: {
            AiConfirmStrings.text(
                "ai.confirm.emptyMessage", "The assistant has no action awaiting your approval."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The delivery-failure state with a retry affordance (web `QueryError` — a first-load failure rendered
/// as a panel with a retry, never a blank box).
struct AiConfirmErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            AiConfirmStrings.text("ai.confirm.errorTitle", "Couldn't load this action")
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
            AiConfirmStrings.text("ai.confirm.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(AiConfirmStrings.text("ai.confirm.retry", "Retry"))
    }
}

// MARK: - Inline reload error (web cached-request-with-failure)

/// The inline reload error shown above the approval content when a refresh failed but a cached request
/// remains, so the prompt stays usable while the failure is surfaced.
struct AiConfirmInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            AiConfirmStrings.text("ai.confirm.errorTitle", "Couldn't load this action")
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
struct AiConfirmFreshnessChip: View {
    let connection: AiConfirmConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            AiConfirmStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(AiConfirmStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: AiConfirmConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "ai.confirm.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "ai.confirm.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "ai.confirm.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the body when the bound source is not live, so an approval prompt
/// assembled from a cached confirm-request is clearly labeled (ADR-013).
struct AiConfirmConnectivityBanner: View {
    let connection: AiConfirmConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "ai.confirm.offlineBanner" : "ai.confirm.staleBanner"
        let fallback = offline
            ? "Offline — this request is from your last sync"
            : "Reconnecting — this request may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            AiConfirmStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
