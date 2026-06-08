//
//  AiUsageCard.Chrome.swift
//  TeslaSync — P4 feature view · 0237 · AiUsageCard (Apple)
//
//  The P4 leaf chrome composed by `AiUsageCard`: the freshness chip, the header refresh button,
//  the stale/offline connectivity banner, the loading skeleton, and the retryable error view. All
//  consume the P1/S10 facade + the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct AiUsageFreshnessChip: View {
    let connection: AiUsageConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: AiUsageStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: AiUsageStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: AiUsageConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "aiUsage.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "aiUsage.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "aiUsage.offline", fallback: "Offline")
        }
    }
}

// MARK: - Refresh button (header)

/// The header refresh affordance — re-requests the usage snapshots (web `refetch()` peer).
struct AiUsageRefreshButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: AiUsageStrings.string("aiUsage.refresh", "Refresh")))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so cached
/// numbers are clearly labeled while reconnecting / offline.
struct AiUsageConnectivityBanner: View {
    let connection: AiUsageConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "aiUsage.offlineBanner" : "aiUsage.staleBanner"
        let fallback = offline
            ? "Offline — showing last known usage"
            : "Reconnecting — usage may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: AiUsageStrings.string(key, fallback))
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

// MARK: - Loading chrome (P4 leaf state)

/// The initial-fetch chrome: skeleton band tiles + a detail row that keeps the card shape while
/// the usage queries resolve (web `isLoading && !today`).
struct AiUsageLoadingView: View {
    private let bandColumns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]
    private let detailColumns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            LazyVGrid(columns: bandColumns, alignment: .leading, spacing: TSSpacing.md) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 64, height: 9)
                        TSSkeleton(width: 84, height: 16)
                        TSSkeleton(width: 100, height: 9)
                    }
                    .padding(TSSpacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        Color.TS.surfaceGlass,
                        in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    )
                }
            }
            LazyVGrid(columns: detailColumns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 56, height: 9)
                        TSSkeleton(width: 72, height: 12)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AiUsageStrings.string("aiUsage.loadingA11y", "Loading Helix usage")))
    }
}

// MARK: - Error chrome (web `QueryError` peer)

/// The fetch-failure state (P4 leaf addition over the web, which falls through to empty) with a
/// retry affordance. Surfaces the failure message under the title when present.
struct AiUsageErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: AiUsageStrings.string("aiUsage.errorTitle", "Couldn't load AI usage"))
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
                Text(verbatim: AiUsageStrings.string("aiUsage.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: AiUsageStrings.string("aiUsage.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
