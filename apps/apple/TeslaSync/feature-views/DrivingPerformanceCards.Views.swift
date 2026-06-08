//
//  DrivingPerformanceCards.Views.swift
//  TeslaSync — P4 feature view · 0055 · DrivingPerformanceCards (Apple)
//
//  The presentational chrome composed by `DrivingPerformanceCards`: the freshness chip,
//  the stale/offline connectivity banner, the responsive metric-tile grid (the web
//  `MetricCard` grid), the per-tile card (label / value / unit subtitle / accent icon
//  box), the initial-fetch skeleton, the retryable error state, and the empty hint. All
//  consume pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct DrivingFreshnessChip: View {
    let connection: DrivingPerformanceConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            DrivingPerformanceStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(DrivingPerformanceStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: DrivingPerformanceConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "analytics.driving.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "analytics.driving.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "analytics.driving.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not live, so
/// cached tiles are clearly labeled (web `DataFreshness` indicator intent).
struct DrivingConnectivityBanner: View {
    let connection: DrivingPerformanceConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "analytics.driving.offlineBanner" : "analytics.driving.staleBanner"
        let fallback = offline
            ? "Offline — showing last known driving metrics"
            : "Reconnecting — driving metrics may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            DrivingPerformanceStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Accent icon box (web `MetricCard` icon slot)

/// The rounded, tinted SF-Symbol box on the trailing edge of a tile (web `c.bg / c.ring /
/// c.text`). Takes the resolved accent color directly so the brand purple (which has no
/// semantic `TSTone`) renders correctly alongside the cyan / amber / green tiles.
struct DrivingMetricIconBox: View {
    let systemImage: String
    let accent: DrivingAccent

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(accent.color)
            .frame(width: 32, height: 32)
            .background(
                accent.color.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(accent.color.opacity(0.2), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Metric tile (web `MetricCard`)

/// One metric tile: the label, the prominent value, the unit subtitle, and the accent icon
/// box (web `<MetricCard label value subtitle icon color />`). The value + subtitle render
/// verbatim (a localized number / em-dash, and a unit symbol). The whole tile is a single
/// VoiceOver element reading "{label}, {value} {unit}".
struct DrivingMetricTile: View {
    let card: DrivingMetricCardModel

    private var label: String {
        DrivingPerformanceStrings.string(card.labelKey, card.labelFallback)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: label)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Text(verbatim: card.value)
                    .font(Font.TS.title)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(verbatim: card.subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.xs)
            DrivingMetricIconBox(systemImage: card.systemImage, accent: card.accent)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: DrivingPerformanceAccessibility.cardSummary(
                card,
                localize: DrivingPerformanceStrings.string
            ))
        )
    }
}

// MARK: - Responsive grid (web `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`)

/// The responsive tile grid. `.adaptive` columns reproduce the web breakpoints — two tiles
/// on a compact width, growing to the full six on a regular/large width.
struct DrivingCardsGrid: View {
    let cards: [DrivingMetricCardModel]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(cards) { card in
                DrivingMetricTile(card: card)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Skeleton (initial fetch)

/// One redacted skeleton tile. Static bars (no shimmer) so it is reduce-motion-safe by
/// construction.
struct DrivingSkeletonTile: View {
    private var bar: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.border.opacity(0.3))
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                bar.frame(width: 56, height: 9)
                bar.frame(width: 84, height: 18)
                bar.frame(width: 40, height: 9)
            }
            Spacer(minLength: TSSpacing.xs)
            bar.frame(width: 32, height: 32)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// The initial-fetch skeleton grid (web `<Skeleton>` shell): six redacted tiles in the
/// same responsive grid as the content.
struct DrivingCardsSkeleton: View {
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 6, id: \.self) { _ in
                DrivingSkeletonTile()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(DrivingPerformanceStrings.text("analytics.driving.loading", "Loading driving performance"))
    }
}

// MARK: - Error state (web `QueryError`)

/// The fetch-failure state with a retry affordance (web `QueryError`). Surfaces the failure
/// message under the title when present.
struct DrivingErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            DrivingPerformanceStrings.text("analytics.driving.errorTitle", "Couldn't load driving performance")
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
            Button(action: onRetry) {
                DrivingPerformanceStrings.text("analytics.driving.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(DrivingPerformanceStrings.text("analytics.driving.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty hint

/// The "no drive data" caption shown under the em-dash tiles in the empty state, so the
/// resolved-but-empty surface reads as intentional rather than blank.
struct DrivingEmptyHint: View {
    var body: some View {
        DrivingPerformanceStrings.text("analytics.driving.empty", "No drive data for this period yet")
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, alignment: .center)
            .accessibilityLabel(
                DrivingPerformanceStrings.text("analytics.driving.empty", "No drive data for this period yet")
            )
    }
}
