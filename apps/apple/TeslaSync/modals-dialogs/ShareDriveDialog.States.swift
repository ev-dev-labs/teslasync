//
//  ShareDriveDialog.States.swift
//  TeslaSync — P4 modal / dialog · 0028 · ShareDriveDialog (Apple)
//
//  The non-content states the "Active Share Links" section switches over — loading (web initial
//  `sharesLoading` spinner), empty (web no-rows, widened into a friendly empty state rather than a
//  hidden section), error (web query failure rendered as a `QueryError` with retry), the inline reload
//  error, and the live-state freshness chip + cached-data banner. Every state renders real chrome —
//  never a blank box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web `sharesLoading` spinner)

/// The links-section loading state (web centered `<Spinner />` while `sharesLoading`).
struct ShareDriveLinksLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            ShareDriveStrings.text("share.loading", "Loading share links…")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (web no-rows → friendly empty state)

/// The resolved-but-no-links state over a native `ContentUnavailableView` (never a hidden section). The
/// web hides the list when empty; the native surface always shows the section with a friendly prompt to
/// generate the first link.
struct ShareDriveLinksEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                ShareDriveStrings.text("share.empty", "No active share links")
            } icon: {
                Image(systemName: "link.badge.plus")
            }
        } description: {
            ShareDriveStrings.text(
                "share.empty.detail",
                "Generate a link above to share this drive."
            )
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web query failure → `QueryError` with retry)

/// The links load-failure state with a retry affordance (web `QueryError` — a list failure rendered as
/// a panel with a retry, never a blank box).
struct ShareDriveLinksErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ShareDriveStrings.text("share.errors.load", "Couldn't load the share links.")
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
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            ShareDriveStrings.text("share.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(ShareDriveStrings.text("share.retry", "Retry"))
    }
}

// MARK: - Inline error (reload / revoke failure with rows on screen)

/// The inline error shown above the list when a refresh or a revoke failed but the cached rows remain
/// (web reload-failure / revoke-error toast, surfaced in place here).
struct ShareDriveInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: message).font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct ShareDriveFreshnessChip: View {
    let connection: ShareDriveConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            ShareDriveStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ShareDriveStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: ShareDriveConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "share.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "share.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "share.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the list when the bound source is not live, so the user knows the
/// listed links may be out of date and a revoke may not have synced yet (ADR-013).
struct ShareDriveConnectivityBanner: View {
    let connection: ShareDriveConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "share.offlineBanner" : "share.staleBanner"
        let fallback = offline
            ? "Offline — changes will sync when you reconnect"
            : "Reconnecting — the links shown may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            ShareDriveStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Localization Text helper

extension ShareDriveStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so resolved values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
