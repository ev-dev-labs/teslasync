//
//  InsightsEngine.Chrome.swift
//  TeslaSync — P4 shared surface · 0092 · InsightsEngine (Apple)
//
//  The P4 leaf chrome composed by `InsightsEngine`: the header freshness chip, the refresh button,
//  the stale/offline connectivity banner, the loading skeleton grid, the retryable error view, and
//  the friendly empty state (web `null` → "never a blank box"). All consume the P1/S10 facade + the
//  shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct InsightsEngineFreshnessChip: View {
    let connection: InsightsEngineConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: InsightsEngineStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: InsightsEngineStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: InsightsEngineConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "insights.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "insights.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "insights.offline", fallback: "Offline")
        }
    }
}

// MARK: - Refresh button (header)

/// The header refresh affordance — re-requests the upstream snapshot.
struct InsightsEngineRefreshButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: InsightsEngineStrings.string("insights.refresh", "Refresh")))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live.
struct InsightsEngineConnectivityBanner: View {
    let connection: InsightsEngineConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "insights.offlineBanner" : "insights.staleBanner"
        let fallback = offline
            ? "Offline — showing the last cached insights"
            : "Reconnecting — insights may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: InsightsEngineStrings.string(key, fallback))
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

// MARK: - Loading chrome (skeleton grid)

/// The loading state: a skeleton card grid matching the ready layout while the upstream queries
/// resolve.
struct InsightsEngineLoadingView: View {
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var compact: Bool {
            horizontalSizeClass == .compact
        }
    #else
        private var compact: Bool {
            false
        }
    #endif

    var body: some View {
        LazyVGrid(columns: InsightsEngineLayout.columns(compact: compact), alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< 4, id: \.self) { _ in
                InsightsEngineSkeletonCard()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: InsightsEngineStrings.string(
            "insights.loadingA11y",
            "Loading smart insights"
        )))
    }
}

/// One skeleton card mirroring the insight card layout (icon chip + two text lines).
struct InsightsEngineSkeletonCard: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 120, height: 12)
                TSSkeleton(height: 12)
                TSSkeleton(height: 12).padding(.trailing, TSSpacing.x4xl)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
    }
}

// MARK: - Error chrome (web `QueryError` peer)

/// The error state with a retry affordance; surfaces the failure message under the title.
struct InsightsEngineErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: InsightsEngineStrings.string("insights.errorTitle", "Couldn't load insights"))
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
            TSButton(variant: .secondary, size: .small) {
                onRetry()
            } label: {
                Text(verbatim: InsightsEngineStrings.string("insights.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: InsightsEngineStrings.string("insights.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty chrome (web `null` → friendly empty state)

/// The empty state — the P4 leaf "never a blank box" replacement for the web `null` return when no
/// insight applies.
struct InsightsEngineEmptyView: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "lightbulb")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: InsightsEngineStrings.string(
                "insights.empty",
                "No insights yet — drive and charge to unlock smart insights."
            ))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
