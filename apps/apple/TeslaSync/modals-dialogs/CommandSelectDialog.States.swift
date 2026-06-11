//
//  CommandSelectDialog.States.swift
//  TeslaSync — P4 modal / dialog · 0031 · CommandSelectDialog (Apple)
//
//  The non-content states `CommandSelectDialog` switches over — loading (the request is still being
//  resolved), empty (resolved with no options to choose from), error (delivery failed → `QueryError`
//  with retry), the inline reload error, and the live-state freshness chip + cached-data banner.
//  Every state renders real chrome — never a blank box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (request still resolving)

/// The first-paint loading state rendered under the header, so the layout doesn't reflow when the
/// option list resolves.
struct CommandSelectLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            CommandSelectStrings.text(
                CommandSelectProjection.Keys.loading,
                CommandSelectProjection.Fallbacks.loading
            )
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (resolved with no options)

/// The resolved-but-no-options state over a native `ContentUnavailableView` (never a blank box). The
/// web would render an empty list here; an intentionally-presented dialog shows this friendly state
/// instead of an empty panel (engineering guideline #6).
struct CommandSelectEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                CommandSelectStrings.text(
                    CommandSelectProjection.Keys.empty,
                    CommandSelectProjection.Fallbacks.empty
                )
            } icon: {
                Image(systemName: "slider.horizontal.3")
            }
        } description: {
            CommandSelectStrings.text(
                CommandSelectProjection.Keys.emptyMessage,
                CommandSelectProjection.Fallbacks.emptyMessage
            )
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The delivery-failure state with a retry affordance (web `QueryError` — a first-load failure
/// rendered as a panel with a retry, never a blank box).
struct CommandSelectErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            CommandSelectStrings.text(
                CommandSelectProjection.Keys.errorTitle,
                CommandSelectProjection.Fallbacks.errorTitle
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
            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            CommandSelectStrings.text(
                CommandSelectProjection.Keys.retry,
                CommandSelectProjection.Fallbacks.retry
            )
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.16), in: Capsule())
            .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(CommandSelectStrings.text(
            CommandSelectProjection.Keys.retry,
            CommandSelectProjection.Fallbacks.retry
        ))
    }
}

// MARK: - Inline reload error (web cached-request-with-failure)

/// The inline reload error shown above the option list when a refresh failed but a cached request
/// remains, so the picker stays usable while the failure is surfaced.
struct CommandSelectInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            CommandSelectStrings.text(
                CommandSelectProjection.Keys.errorTitle,
                CommandSelectProjection.Fallbacks.errorTitle
            )
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
struct CommandSelectFreshnessChip: View {
    let connection: CommandSelectConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            CommandSelectStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(CommandSelectStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: CommandSelectConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "command.select.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "command.select.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "command.select.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the body when the bound source is not live, so an option list
/// assembled from a cached command context is clearly labeled (ADR-013).
struct CommandSelectConnectivityBanner: View {
    let connection: CommandSelectConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "command.select.offlineBanner" : "command.select.staleBanner"
        let fallback = offline
            ? "Offline — these options are from your last sync"
            : "Reconnecting — these options may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            CommandSelectStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
