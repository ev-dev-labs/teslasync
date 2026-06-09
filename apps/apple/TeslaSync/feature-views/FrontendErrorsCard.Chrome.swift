//
//  FrontendErrorsCard.Chrome.swift
//  TeslaSync — P4 feature view · 0243 · FrontendErrorsCard (Apple)
//
//  The P4 leaf chrome composed by `FrontendErrorsCard`: the freshness chip, the header refresh
//  button, the stale/offline connectivity banner, the loading skeleton (the two-bar web skeleton),
//  and the retryable error view (the web `!data` "unable to load" branch upgraded with a retry).
//  All consume the P1/S10 facade + the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct FrontendErrorsFreshnessChip: View {
    let connection: FrontendErrorsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: FrontendErrorsStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: FrontendErrorsStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: FrontendErrorsConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "frontendErrors.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "frontendErrors.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "frontendErrors.offline", fallback: "Offline")
        }
    }
}

// MARK: - Refresh button (header)

/// The header refresh affordance — re-requests the summary snapshot (web `refetch()` peer).
struct FrontendErrorsRefreshButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: FrontendErrorsStrings.string("frontendErrors.refresh", "Refresh")))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so cached
/// numbers are clearly labeled while reconnecting / offline.
struct FrontendErrorsConnectivityBanner: View {
    let connection: FrontendErrorsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "frontendErrors.offlineBanner" : "frontendErrors.staleBanner"
        let fallback = offline
            ? "Offline — showing last known errors"
            : "Reconnecting — errors may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: FrontendErrorsStrings.string(key, fallback))
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

// MARK: - Loading chrome (web two-bar skeleton)

/// The initial-fetch chrome: the header over two skeleton bars, keeping the card shape while the
/// summary query resolves (web `isLoading` → two `Skeleton h-6` bars).
struct FrontendErrorsLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(height: 24)
            TSSkeleton(height: 24)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: FrontendErrorsStrings.string(
            "frontendErrors.loadingA11y",
            "Loading frontend error summary"
        )))
    }
}

// MARK: - Error chrome (web `!data` "unable to load" + retry)

/// The no-data / fetch-failure state — the web `!data` "Unable to load frontend error summary."
/// message upgraded with a retry affordance (P4 leaf contract).
struct FrontendErrorsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: FrontendErrorsStrings.string("frontendErrors.errorTitle", "Couldn't load frontend errors"))
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
                Text(verbatim: FrontendErrorsStrings.string("frontendErrors.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: FrontendErrorsStrings.string("frontendErrors.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
