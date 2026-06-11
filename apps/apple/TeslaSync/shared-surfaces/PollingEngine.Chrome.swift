//
//  PollingEngine.Chrome.swift
//  TeslaSync — P4 shared surface · 0098 · PollingEngine (Apple)
//
//  The P4 leaf chrome composed by `PollingEngine`: the `PollingTone` → P1/S9 token mapping, the
//  header freshness chip, the refresh button, the stale/offline connectivity banner, the status-read
//  loading skeleton, and the retryable error view. All consume the P1/S10 facade + the shared P1/S9
//  tokens and the shared `TSSkeleton` / `TSButton` primitives — no networking, no Tailwind ports, no
//  raw hex.
//

import SwiftUI

// MARK: - Tone → token mapping (web hex → P1/S9 semantic colour)

extension PollingTone {
    /// The P1/S9 design token for this semantic role, so light / dark / high-contrast all keep
    /// working (the web source's raw hexes never cross into the native layer).
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .info: Color.TS.statusInfo
        case .warning: Color.TS.statusWarning
        case .muted: Color.TS.textMuted
        case .primary: Color.TS.textPrimary
        case .prediction: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct PollingFreshnessChip: View {
    let connection: PollingConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        let label = PollingEngineStrings.string(descriptor.key, descriptor.fallback)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: PollingEngineAccessibility.freshnessLabel(label)))
    }

    private static func descriptor(for connection: PollingConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "polling.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "polling.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "polling.offline", fallback: "Offline")
        }
    }
}

// MARK: - Refresh button (header)

/// The header refresh affordance — re-requests the status + savings snapshots (web `refetch()` peer).
struct PollingRefreshButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: PollingEngineStrings.string("polling.refresh", "Refresh")))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the body when the bound source is not live, so the panel is
/// clearly labeled while reconnecting / offline.
struct PollingConnectivityBanner: View {
    let connection: PollingConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "polling.offlineBanner" : "polling.staleBanner"
        let fallback = offline
            ? "Offline — showing the last known polling state"
            : "Reconnecting — polling data may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: PollingEngineStrings.string(key, fallback))
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

// MARK: - Loading chrome (status read resolving)

/// The status-read skeleton — a header bar, a four-tile metric grid, a stacked-bar block, and two
/// vehicle rows, so the panel keeps its shape while `getPollingStatus` resolves.
struct PollingLoadingView: View {
    private let columns = [
        GridItem(.flexible(), spacing: TSSpacing.md),
        GridItem(.flexible(), spacing: TSSpacing.md)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    VStack(spacing: TSSpacing.xs) {
                        TSSkeleton(width: 64, height: 22)
                        TSSkeleton(width: 48, height: 10)
                    }
                }
            }
            TSSkeleton(height: 8, cornerRadius: TSRadius.pill)
            ForEach(0 ..< 2, id: \.self) { _ in
                TSSkeleton(height: 44, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(
            Text(verbatim: PollingEngineStrings.string("polling.loadingA11y", "Loading polling engine"))
        )
    }
}

// MARK: - Error chrome (web `QueryError` peer)

/// The status-read failure state with a retry affordance (web `QueryError` peer). Surfaces the
/// failure message under the title when present.
struct PollingErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: PollingEngineStrings.string("polling.errorTitle", "Couldn't load polling status"))
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
                Text(verbatim: PollingEngineStrings.string("polling.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: PollingEngineStrings.string("polling.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
