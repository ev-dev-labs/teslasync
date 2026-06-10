//
//  AcknowledgeAlertDialog.States.swift
//  TeslaSync — P4 modal/dialog · 0017 · AcknowledgeAlertDialog (Apple)
//
//  The non-content states `AcknowledgeAlertDialog` switches over — loading (web Spinner equivalent),
//  empty (no alert to acknowledge), error (web `QueryError` with retry), the inline reload error, and
//  the live-state freshness chip + cached-data banner. Every state renders real chrome — never a blank
//  box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web Spinner)

/// The first-paint loading state rendered under the header, so the layout doesn't reflow when the alert
/// context resolves.
struct AckAlertLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            AckAlertStrings.text("alerts.ack.state.loading", "Loading the alert…")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (no alert to acknowledge)

/// The resolved-but-no-target state over a native `ContentUnavailableView` (never a blank box). The web
/// only renders the dialog from a row's "Acknowledge" button; this surfaces a friendly empty state so
/// the dialog always renders something if it is opened with no target.
struct AckAlertEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                AckAlertStrings.text("alerts.ack.state.empty", "No alert selected to acknowledge")
            } icon: {
                Image(systemName: "checkmark.seal")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The load-failure state with a retry affordance (web `QueryError` — a first-resolve failure rendered
/// as a panel with a retry, never a blank box).
struct AckAlertErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            AckAlertStrings.text("alerts.ack.state.error", "Couldn't load the alert.")
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
            AckAlertStrings.text("alerts.ack.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(AckAlertStrings.text("alerts.ack.retry", "Retry"))
    }
}

// MARK: - Inline reload error (web cached-context-with-failure)

/// The inline reload error shown above the form when a refresh failed but a cached context remains (web
/// reload-failure-with-cached-data).
struct AckAlertInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            AckAlertStrings.text("alerts.ack.state.error", "Couldn't load the alert.")
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
struct AckAlertFreshnessChip: View {
    let connection: AckAlertConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            AckAlertStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(AckAlertStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: AckAlertConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "alerts.ack.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "alerts.ack.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "alerts.ack.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the form when the bound source is not live, so the user knows the
/// alert context may be momentarily out of date (ADR-013).
struct AckAlertConnectivityBanner: View {
    let connection: AckAlertConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "alerts.ack.offlineBanner" : "alerts.ack.staleBanner"
        let fallback = offline
            ? "Offline — your acknowledgement will sync when you reconnect"
            : "Reconnecting — the alert may be momentarily out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            AckAlertStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
