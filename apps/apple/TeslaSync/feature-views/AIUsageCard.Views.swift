//
//  AIUsageCard.Views.swift
//  TeslaSync — P4 feature view · 0203 · AIUsageCard (Apple)
//
//  The presentational subviews composed by `AIUsageCard`: the three-up usage grid (web
//  `grid-cols-3 gap-3`), one usage cell (muted label over a medium primary value — the native
//  `@/components/ui` `UsageCell` role), the footer caption (web `<Caption>`), the freshness
//  chip + stale/offline banner, and the loading / error chrome. All consume the P1/S10 facade
//  and the shared P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Usage grid (web `grid grid-cols-3 gap-3`)

/// The resolved card body — the title subhead, the three-up usage grid, and the footer caption,
/// wrapped in the shared fade-in. Shared by the `data` and `empty` phases (they differ only in
/// the caption the model resolves), exactly like the web component, which always renders the
/// grid and only swaps the caption on `call_count`.
struct AIUsageContent: View {
    let metrics: [AIUsageMetric]
    let caption: AIUsageCaption

    private let columns = [GridItem(.adaptive(minimum: 96), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(metrics) { metric in
                        AIUsageMetricCell(metric: metric)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                AIUsageCaptionView(caption: caption)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Usage cell (web `UsageCell`)

/// One usage cell — a muted label over a medium primary value (web `<UsageCell label value />`).
/// Combined into a single VoiceOver element so each metric reads as "{label}: {value}".
struct AIUsageMetricCell: View {
    let metric: AIUsageMetric

    private var label: String {
        AIUsageStrings.string(metric.labelKey, metric.labelFallback)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(verbatim: metric.value)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AIUsageAccessibility.cellLabel(label: label, value: metric.value)))
    }
}

// MARK: - Caption (web `<Caption>` footer)

/// The footer caption (web `<Caption>`): the live "{count} Helix calls today." line when calls
/// exist, otherwise the "usage populates as features run" hint copy. Mirrors the web
/// `@/components/ui` `Caption` role (muted caption type).
struct AIUsageCaptionView: View {
    let caption: AIUsageCaption

    private var text: String {
        switch caption {
        case let .live(callCount):
            AIUsageFormat.liveCaption(
                callCount: callCount,
                suffix: AIUsageStrings.string("ai.settings.usage.liveSuffix", "Helix calls today.")
            )
        case .hint:
            AIUsageStrings.string(
                "ai.settings.usage.placeholder", // parity:allow web settings i18n key from AIUsageCard.tsx
                "Usage populates as features run. Live numbers arrive in a follow-up update."
            )
        }
    }

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct AIUsageFreshnessChip: View {
    let connection: AIUsageConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: AIUsageStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: AIUsageStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: AIUsageConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "aiUsage.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "aiUsage.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "aiUsage.offline", fallback: "Offline")
        }
    }
}

// MARK: - Refresh button (header)

/// The header refresh affordance — re-requests the usage snapshot (web `refetch()` peer).
struct AIUsageRefreshButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: AIUsageStrings.string("aiUsage.refresh", "Refresh")))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not live, so cached
/// numbers are clearly labeled while reconnecting / offline.
struct AIUsageConnectivityBanner: View {
    let connection: AIUsageConnection

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
            Text(verbatim: AIUsageStrings.string(key, fallback))
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

/// The initial-fetch chrome: a skeleton three-up grid plus a caption bar that keeps the card
/// shape while the usage query resolves.
struct AIUsageLoadingView: View {
    private let columns = [GridItem(.adaptive(minimum: 96), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 56, height: 9)
                        TSSkeleton(width: 72, height: 13)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            TSSkeleton(width: 180, height: 9)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AIUsageStrings.string("aiUsage.loadingA11y", "Loading AI usage")))
    }
}

// MARK: - Error chrome (web `QueryError` peer)

/// The fetch-failure state (web `isError` upgraded to a retryable `QueryError` peer) with a
/// retry affordance. Surfaces the failure message under the title when present.
struct AIUsageErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: AIUsageStrings.string("aiUsage.errorTitle", "Couldn't load AI usage"))
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
                Text(verbatim: AIUsageStrings.string("aiUsage.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: AIUsageStrings.string("aiUsage.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
