//
//  FlagEditDrawer.States.swift
//  TeslaSync — P4 modal / dialog · 0019 · FlagEditDrawer (Apple)
//
//  The non-content states `FlagEditDrawer` switches over — loading (the request is still being
//  resolved), empty (resolved with no flag to edit, e.g. an intentionally-presented drawer), error
//  (delivery failed → `QueryError` with retry), the inline reload error, and the live-state
//  freshness chip + cached-data banner. Every state renders real chrome — never a blank box. Copy
//  via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (request still resolving)

/// The first-paint loading state rendered under the header, so the layout doesn't reflow when the
/// editor request resolves.
struct FlagEditDrawerLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            FlagEditDrawerStrings.text("flagEdit.loading", "Loading flag…")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (resolved with no flag to edit)

/// The resolved-but-no-request state over a native `ContentUnavailableView` (never a blank box). The
/// web drawer simply wouldn't open here; an intentionally-presented drawer shows this friendly state
/// instead of vanishing (engineering guideline #6).
struct FlagEditDrawerEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                FlagEditDrawerStrings.text("flagEdit.empty", "No flag selected")
            } icon: {
                Image(systemName: "flag.slash")
            }
        } description: {
            FlagEditDrawerStrings.text(
                "flagEdit.emptyMessage", "Pick a flag to edit, or start a new one from the registry."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The delivery-failure state with a retry affordance (web `QueryError` — a first-load failure
/// rendered as a panel with a retry, never a blank box).
struct FlagEditDrawerErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            FlagEditDrawerStrings.text("flagEdit.errorTitle", "Couldn't load this flag")
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
            FlagEditDrawerStrings.text("flagEdit.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(FlagEditDrawerStrings.text("flagEdit.retry", "Retry"))
    }
}

// MARK: - Inline reload error (web cached-request-with-failure)

/// The inline reload error shown above the form when a refresh failed but a cached request remains,
/// so the editor stays usable while the failure is surfaced.
struct FlagEditDrawerInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            FlagEditDrawerStrings.text("flagEdit.errorTitle", "Couldn't load this flag")
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
struct FlagEditDrawerFreshnessChip: View {
    let connection: FlagEditConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            FlagEditDrawerStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(FlagEditDrawerStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: FlagEditConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "flagEdit.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "flagEdit.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "flagEdit.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the body when the bound source is not live, so an editor
/// assembled from a cached flag is clearly labeled (ADR-013).
struct FlagEditDrawerConnectivityBanner: View {
    let connection: FlagEditConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "flagEdit.offlineBanner" : "flagEdit.staleBanner"
        let fallback = offline
            ? "Offline — showing the flag from your last sync"
            : "Reconnecting — this flag may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            FlagEditDrawerStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
