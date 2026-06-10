//
//  AILogTraceSummarization.Chrome.swift
//  TeslaSync — P4 shared surface · 0026 · AILogTraceSummarization (Apple)
//
//  The P4 leaf chrome composed by `AILogTraceSummarization`: the header freshness chip, the refresh
//  button, the stale/offline connectivity banner, the availability loading skeleton, and the
//  retryable gate-error view. All consume the P1/S10 facade + the shared P1/S9 tokens — no
//  networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct LogTraceSummaryFreshnessChip: View {
    let connection: LogTraceSummaryConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: LogTraceSummaryStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: LogTraceSummaryStrings.string(descriptor.key, descriptor.fallback))
        )
    }

    private static func descriptor(for connection: LogTraceSummaryConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "liveLogs.aiSummary.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "liveLogs.aiSummary.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "liveLogs.aiSummary.offline", fallback: "Offline")
        }
    }
}

// MARK: - Refresh button (header)

/// The header refresh affordance — re-requests the availability snapshot (web `refetch()` peer).
struct LogTraceSummaryRefreshButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            Text(verbatim: LogTraceSummaryStrings.string("liveLogs.aiSummary.refresh", "Refresh"))
        )
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so the card is
/// clearly labeled while reconnecting / offline.
struct LogTraceSummaryConnectivityBanner: View {
    let connection: LogTraceSummaryConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "liveLogs.aiSummary.offlineBanner" : "liveLogs.aiSummary.staleBanner"
        let fallback = offline
            ? "Offline — showing the last known summary"
            : "Reconnecting — Helix may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: LogTraceSummaryStrings.string(key, fallback))
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

// MARK: - Loading chrome (availability resolving)

/// The initial-availability chrome: a skeleton header + description + button + output that keeps the
/// card shape while the `useAiEnabled` settings query resolves.
struct LogTraceSummaryLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 220, height: 12)
            TSSkeleton(height: 12).frame(maxWidth: .infinity).padding(.trailing, TSSpacing.x4xl)
            HStack {
                Spacer(minLength: 0)
                TSSkeleton(width: 120, height: 28)
            }
            TSSkeleton(height: 64)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(
            Text(verbatim: LogTraceSummaryStrings.string(
                "liveLogs.aiSummary.loadingA11y",
                "Loading log and trace summary"
            ))
        )
    }
}

// MARK: - Gate-error chrome (web `QueryError` peer)

/// The availability-failure state (the `useAiEnabled` settings query failing) with a retry
/// affordance. Surfaces the failure message under the title when present.
struct LogTraceSummaryGateErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: LogTraceSummaryStrings.string("liveLogs.aiSummary.errorTitle", "Couldn't load Helix"))
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
                Text(verbatim: LogTraceSummaryStrings.string("liveLogs.aiSummary.retry", "Retry"))
            }
            .accessibilityLabel(
                Text(verbatim: LogTraceSummaryStrings.string("liveLogs.aiSummary.retry", "Retry"))
            )
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
