//
//  DriveStatCards.Views.swift
//  TeslaSync — P4 feature view · 0139 · DriveStatCards (Apple)
//
//  The presentational chrome composed by `DriveStatCards`: the freshness chip, the
//  stale/offline connectivity banner, the responsive stat-tile grid (the web `IconStatCard`
//  grid), the per-tile card (centered accent icon / prominent value / muted label — the web
//  `IconStatCard` layout), the initial-fetch skeleton, the retryable error state, and the
//  empty hint. All consume pre-localized strings from the P1/S10 facade and the shared P1/S9
//  tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct DriveStatCardsFreshnessChip: View {
    let connection: DriveStatCardsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            DriveStatCardsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(DriveStatCardsStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: DriveStatCardsConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "driveDetail.stats.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "driveDetail.stats.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "driveDetail.stats.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not live, so cached
/// tiles are clearly labeled while reconnecting / offline.
struct DriveStatCardsConnectivityBanner: View {
    let connection: DriveStatCardsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "driveDetail.stats.offlineBanner" : "driveDetail.stats.staleBanner"
        let fallback = offline
            ? "Offline — showing last known drive stats"
            : "Reconnecting — drive stats may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            DriveStatCardsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Stat tile (web `IconStatCard`)

/// One stat tile: the centered accent icon, the prominent value, and the muted label — the
/// web `<GlassPanel p-4 text-center><Icon/><p value/><p label/></GlassPanel>`. The value
/// renders verbatim (it already carries its unit). The whole tile is a single VoiceOver
/// element reading "{label}, {value}".
struct DriveStatCardsTile: View {
    let item: DriveStatCardsItem

    private var label: String {
        DriveStatCardsStrings.label(item.labelKey, item.labelFallback, item.labelArgs)
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: item.systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(item.accent.color)
                .accessibilityHidden(true)
            Text(verbatim: item.value)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: DriveStatCardsAccessibility.cardSummary(item, localize: DriveStatCardsStrings.label))
        )
    }
}

// MARK: - Responsive grid (web `grid-cols-2 sm:grid-cols-4 lg:grid-cols-8`)

/// The responsive tile grid. `.adaptive` columns reproduce the web breakpoints — two tiles on
/// a compact width, growing toward the full eight on a regular/large width.
struct DriveStatCardsGrid: View {
    let cards: [DriveStatCardsItem]

    private let columns = [GridItem(.adaptive(minimum: 132), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(cards) { card in
                DriveStatCardsTile(item: card)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Skeleton (initial fetch)

/// One redacted skeleton tile. Static bars (no shimmer) so it is reduce-motion-safe by
/// construction.
struct DriveStatCardsSkeletonTile: View {
    private var bar: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.border.opacity(0.3))
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            bar.frame(width: 18, height: 18)
            bar.frame(width: 72, height: 18)
            bar.frame(width: 44, height: 9)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// The initial-fetch skeleton grid (web `DriveDetailSkeleton` shell): eight redacted tiles in
/// the same responsive grid as the content.
struct DriveStatCardsSkeleton: View {
    private let columns = [GridItem(.adaptive(minimum: 132), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 8, id: \.self) { _ in
                DriveStatCardsSkeletonTile()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(DriveStatCardsStrings.text("driveDetail.stats.loading", "Loading drive stats"))
    }
}

// MARK: - Error state (web `QueryError`)

/// The fetch-failure state with a retry affordance (web `QueryError`). Surfaces the failure
/// message under the title when present.
struct DriveStatCardsErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            DriveStatCardsStrings.text("driveDetail.stats.errorTitle", "Couldn't load drive stats")
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
                DriveStatCardsStrings.text("driveDetail.stats.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(DriveStatCardsStrings.text("driveDetail.stats.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty hint

/// The "no drive stats" caption shown under the em-dash tiles in the empty state, so the
/// resolved-but-empty surface reads as intentional rather than blank.
struct DriveStatCardsEmptyHint: View {
    var body: some View {
        DriveStatCardsStrings.text("driveDetail.stats.empty", "No stats for this drive yet")
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, alignment: .center)
            .accessibilityLabel(
                DriveStatCardsStrings.text("driveDetail.stats.empty", "No stats for this drive yet")
            )
    }
}
