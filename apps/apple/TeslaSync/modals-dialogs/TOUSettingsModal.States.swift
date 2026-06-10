//
//  TOUSettingsModal.States.swift
//  TeslaSync — P4 modal / dialog · 0021 · TOUSettingsModal (Apple)
//
//  The non-content states `TOUSettingsModal` switches over — loading (web initial fetch), empty (no
//  TOU-capable Powerwall site), error (web `QueryError` with retry), the inline reload error, and the
//  live-state freshness chip + cached-data banner. Every state renders real chrome — never a blank box.
//  Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web initial fetch)

/// The first-paint loading state rendered under the header, so the layout doesn't reflow when the
/// energy-site context resolves.
struct TOUSettingsLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            TOUSettingsStrings.text("tou.loading", "Loading rate plan settings…")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .padding(TSSpacing.xl)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (no TOU-capable site)

/// The resolved-but-no-TOU-site state over a native `ContentUnavailableView` (never a blank box). The
/// web is handed a `siteId`; this guards the no-Powerwall / not-TOU-capable edge so the surface always
/// renders something friendly.
struct TOUSettingsEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TOUSettingsStrings.text("tou.empty", "No Powerwall site to configure")
            } icon: {
                Image(systemName: "bolt.badge.xmark")
            }
        } description: {
            TOUSettingsStrings.text(
                "tou.empty.detail",
                "Connect a TOU-capable Powerwall energy site to set a rate plan."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The load-failure state with a retry affordance (web `QueryError` — a first-load failure rendered as a
/// panel with a retry, never a blank box).
struct TOUSettingsErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TOUSettingsStrings.text("tou.errors.load", "Couldn't load the rate plan settings.")
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
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .padding(TSSpacing.xl)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            TOUSettingsStrings.text("tou.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(TOUSettingsStrings.text("tou.retry", "Retry"))
    }
}

// MARK: - Inline reload error (web cached-context-with-failure)

/// The inline reload error shown above the form when a refresh failed but a cached context remains (web
/// reload-failure-with-cached-data).
struct TOUSettingsInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            TOUSettingsStrings.text("tou.errors.load", "Couldn't load the rate plan settings.")
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
struct TOUSettingsFreshnessChip: View {
    let connection: TOUSettingsConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            TOUSettingsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TOUSettingsStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: TOUSettingsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "tou.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "tou.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "tou.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the form when the bound source is not live, so the user knows the
/// shown tariff may be out of date and a save may not have synced yet (ADR-013).
struct TOUSettingsConnectivityBanner: View {
    let connection: TOUSettingsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "tou.offlineBanner" : "tou.staleBanner"
        let fallback = offline
            ? "Offline — changes will sync when you reconnect"
            : "Reconnecting — the rate plan shown may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            TOUSettingsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
