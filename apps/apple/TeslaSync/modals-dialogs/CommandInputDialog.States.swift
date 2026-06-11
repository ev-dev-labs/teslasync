//
//  CommandInputDialog.States.swift
//  TeslaSync — P4 modal/dialog · 0030 · CommandInputDialog (Apple)
//
//  The non-content states `CommandInputDialog` switches over — loading (web Spinner equivalent), empty
//  (no command selected), error (web `QueryError` with retry), plus the live-state freshness chip + the
//  cached-data banner. Every state renders real chrome — never a blank box. Copy via P1/S10; chrome via
//  P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web Spinner)

/// The first-paint loading state rendered under the header, so the layout doesn't reflow when the
/// command context resolves.
struct CommandInputLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            CommandInputStrings.text("commands.input.state.loading", "Preparing command…")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (no command selected)

/// The resolved-but-no-command state over a native `ContentUnavailableView` (never a blank box). The web
/// simply hides the modal when nothing is selected; this surfaces a friendly empty state so the dialog
/// always renders something.
struct CommandInputEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                CommandInputStrings.text("commands.input.state.empty", "No command selected")
            } icon: {
                Image(systemName: "terminal")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The load-failure state with a retry affordance (web `QueryError` — a first-resolve failure rendered
/// as a panel with a retry, never a blank box).
struct CommandInputErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            CommandInputStrings.text("commands.input.state.error", "Couldn't load this command.")
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
            CommandInputStrings.text("commands.input.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(CommandInputStrings.text("commands.input.retry", "Retry"))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct CommandInputFreshnessChip: View {
    let connection: CommandInputConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            CommandInputStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(CommandInputStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: CommandInputConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "commands.input.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "commands.input.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "commands.input.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the form when the bound source is not live, so the user knows the
/// command may be momentarily out of date or undeliverable while connectivity recovers (ADR-013).
struct CommandInputConnectivityBanner: View {
    let connection: CommandInputConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "commands.input.offlineBanner" : "commands.input.staleBanner"
        let fallback = offline
            ? "Offline — reconnect to send this command"
            : "Reconnecting — the command may need to be re-sent"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            CommandInputStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
