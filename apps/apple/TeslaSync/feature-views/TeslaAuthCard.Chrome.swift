//
//  TeslaAuthCard.Chrome.swift
//  TeslaSync — P4 feature view · 0258 · TeslaAuthCard (Apple)
//
//  The P4 leaf chrome composed by `TeslaAuthCard`: the freshness chip, the header refresh button,
//  the stale/offline connectivity banner, the loading skeleton (the card silhouette while the auth
//  status resolves), and the retryable error view. All consume the P1/S10 facade + the shared
//  P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct TeslaAuthFreshnessChip: View {
    let connection: TeslaAuthConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: TeslaAuthStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: TeslaAuthStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: TeslaAuthConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "teslaAuth.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "teslaAuth.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "teslaAuth.offline", fallback: "Offline")
        }
    }
}

// MARK: - Refresh button (header)

/// The header refresh affordance — re-requests the auth-status snapshot (web page-tick peer).
struct TeslaAuthRefreshButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: TeslaAuthStrings.string("teslaAuth.refresh", "Refresh")))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so a cached
/// status is clearly labeled while reconnecting / offline.
struct TeslaAuthConnectivityBanner: View {
    let connection: TeslaAuthConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "teslaAuth.offlineBanner" : "teslaAuth.staleBanner"
        let fallback = offline
            ? "Offline — showing last known status"
            : "Reconnecting — status may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: TeslaAuthStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading chrome (card silhouette)

/// The initial-fetch chrome: the card silhouette (icon block + two text bars + CTA block) while the
/// auth status resolves, keeping the card shape rather than collapsing to nothing.
struct TeslaAuthLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 24, height: 24, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 160, height: 14)
                TSSkeleton(height: 12)
            }
            Spacer(minLength: TSSpacing.sm)
            TSSkeleton(width: 96, height: 28, cornerRadius: TSRadius.sm)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: TeslaAuthStrings.string(
            "teslaAuth.loadingA11y",
            "Loading Tesla account status"
        )))
    }
}

// MARK: - Error chrome (retryable)

/// The fetch-failure state — a retryable "couldn't load" surface (P4 leaf contract; the web card has
/// no error branch).
struct TeslaAuthErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: TeslaAuthStrings.string(
                "teslaAuth.errorTitle",
                "Couldn't load Tesla account status"
            ))
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
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: TeslaAuthStrings.string("teslaAuth.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: TeslaAuthStrings.string("teslaAuth.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
