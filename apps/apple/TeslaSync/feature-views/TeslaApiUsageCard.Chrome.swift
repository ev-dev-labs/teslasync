//
//  TeslaApiUsageCard.Chrome.swift
//  TeslaSync — P4 feature view · 0257 · TeslaApiUsageCard (Apple)
//
//  The P4 leaf chrome composed by `TeslaApiUsageCard`: the freshness chip, the header refresh
//  button, the stale/offline connectivity banner, the loading skeleton, and the retryable error
//  view. All consume the P1/S10 facade + the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct TeslaApiUsageFreshnessChip: View {
    let connection: TeslaApiUsageConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: TeslaApiUsageStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: TeslaApiUsageStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: TeslaApiUsageConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "teslaApiUsage.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "teslaApiUsage.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "teslaApiUsage.offline", fallback: "Offline")
        }
    }
}

// MARK: - Refresh button (header)

/// The header refresh affordance — re-requests the usage snapshots (web `refetch()` peer).
struct TeslaApiUsageRefreshButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: TeslaApiUsageStrings.string("teslaApiUsage.refresh", "Refresh")))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so cached
/// numbers are clearly labeled while reconnecting / offline.
struct TeslaApiUsageConnectivityBanner: View {
    let connection: TeslaApiUsageConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "teslaApiUsage.offlineBanner" : "teslaApiUsage.staleBanner"
        let fallback = offline
            ? "Offline — showing last known usage"
            : "Reconnecting — usage may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: TeslaApiUsageStrings.string(key, fallback))
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

/// The initial-fetch chrome: a skeleton budget bar, three skeleton band tiles, and a skeleton detail
/// row that keeps the card shape while the usage queries resolve.
struct TeslaApiUsageLoadingView: View {
    private let bandColumns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]
    private let detailColumns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 180, height: 12)
                TSSkeleton(height: 8)
                TSSkeleton(width: 140, height: 9)
            }
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
        .accessibilityLabel(Text(verbatim: TeslaApiUsageStrings.string(
            "teslaApiUsage.loadingA11y",
            "Loading Tesla API usage"
        )))
    }
}

// MARK: - Error chrome (web `QueryError` peer)

/// The fetch-failure state (P4 leaf addition over the web, which falls through to empty) with a
/// retry affordance. Surfaces the failure message under the title when present.
struct TeslaApiUsageErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: TeslaApiUsageStrings.string("teslaApiUsage.errorTitle", "Couldn't load Tesla API usage"))
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
                Text(verbatim: TeslaApiUsageStrings.string("teslaApiUsage.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: TeslaApiUsageStrings.string("teslaApiUsage.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty chrome (web `UsageCard` emptyMessage)

/// The resolved-but-empty state (web `!apiUsage` → `UsageCard emptyMessage`). A friendly icon + the
/// localized message — never a blank panel.
struct TeslaApiUsageEmptyView: View {
    let message: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.bar.doc.horizontal")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
