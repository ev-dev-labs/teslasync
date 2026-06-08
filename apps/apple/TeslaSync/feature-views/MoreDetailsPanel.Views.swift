//
//  MoreDetailsPanel.Views.swift
//  TeslaSync — P4 feature view · 0145 · MoreDetailsPanel (Apple)
//
//  The presentational chrome composed by `MoreDetailsPanel`: the freshness chip, the
//  stale/offline connectivity banner, the responsive stat-tile grids (the web first + second
//  grids), the per-tile cell (centered label + value, with the three web value treatments —
//  muted-unit, fully-colored, and the green/red elevation block), the group divider, the
//  initial-fetch skeleton, the retryable error state, and the empty hint. All consume
//  pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no networking, no
//  Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct MoreDetailsFreshnessChip: View {
    let connection: MoreDetailsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            MoreDetailsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(MoreDetailsStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: MoreDetailsConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "driveDetail.moreDetails.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "driveDetail.moreDetails.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "driveDetail.moreDetails.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grids when the bound source is not live, so cached
/// values are clearly labeled (web `DataFreshness` indicator intent).
struct MoreDetailsConnectivityBanner: View {
    let connection: MoreDetailsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "driveDetail.moreDetails.offlineBanner" : "driveDetail.moreDetails.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded drive details"
            : "Reconnecting — drive details may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            MoreDetailsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Tile cell (web centered stat cell)

/// One stat cell (web `<div className="text-center">`): the muted label above the value, with the
/// value rendered per its shape. The whole cell is a single VoiceOver element reading
/// "{label}, {value}".
struct MoreDetailsTileView: View {
    let tile: MoreDetailsTile

    private var label: String {
        MoreDetailsStrings.string(tile.labelKey, tile.labelFallback)
    }

    var body: some View {
        VStack(alignment: .center, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
            valueView
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: MoreDetailsAccessibility.tileSummary(tile, localize: MoreDetailsStrings.string))
        )
    }

    @ViewBuilder
    private var valueView: some View {
        switch tile.value {
        case let .mutedUnit(value, unit):
            mutedUnitText(value: value, unit: unit)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.6)
        case let .plain(text):
            Text(verbatim: text)
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(tile.accent.color)
                .multilineTextAlignment(.center)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        case let .elevation(gain, loss):
            elevationView(gain: gain, loss: loss)
        }
    }

    /// Web colored value + a smaller, muted unit span (`<p>{value} <span muted>{unit}</span></p>`).
    private func mutedUnitText(value: String, unit: String) -> Text {
        Text(verbatim: value)
            .font(Font.TS.section)
            .fontWeight(.semibold)
            .monospacedDigit()
            .foregroundColor(tile.accent.color)
            + Text(verbatim: " \(unit)")
            .font(Font.TS.caption)
            .foregroundColor(Color.TS.textMuted)
    }

    /// Web two-line elevation block: gain (green, ↑) over loss (red, ↓), each suffixed `m`.
    private func elevationView(gain: String, loss: String) -> some View {
        VStack(alignment: .center, spacing: 2) {
            Label {
                Text(verbatim: gain).monospacedDigit()
            } icon: {
                Image(systemName: "arrow.up.right")
            }
            .font(Font.TS.body)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.statusSuccess)
            Label {
                Text(verbatim: loss).monospacedDigit()
            } icon: {
                Image(systemName: "arrow.down.right")
            }
            .font(Font.TS.body)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.statusDanger)
        }
        .labelStyle(.titleAndIcon)
    }
}

// MARK: - Responsive tile grid (web `grid-cols-2 … lg:grid-cols-{7,4}`)

/// The responsive stat grid. `.adaptive` columns reproduce the web breakpoints — two tiles on a
/// compact width, growing across iPad / Mac.
struct MoreDetailsGrid: View {
    let tiles: [MoreDetailsTile]

    private let columns = [GridItem(.adaptive(minimum: 124), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.md) {
            ForEach(tiles) { tile in
                MoreDetailsTileView(tile: tile)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// The hairline divider between the two web grids (`border-t border-[var(--border-subtle)]`).
struct MoreDetailsDivider: View {
    var body: some View {
        Rectangle()
            .fill(Color.TS.border)
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}

/// The two stacked grids separated by the divider — the resolved + empty content body.
struct MoreDetailsBody: View {
    let tiles: MoreDetailsTiles

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            MoreDetailsGrid(tiles: tiles.primary)
            MoreDetailsDivider()
            MoreDetailsGrid(tiles: tiles.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Skeleton (initial fetch)

/// One redacted skeleton cell. Static bars (no shimmer) so it is reduce-motion-safe by
/// construction.
struct MoreDetailsSkeletonTile: View {
    private var bar: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.border.opacity(0.3))
    }

    var body: some View {
        VStack(alignment: .center, spacing: TSSpacing.xs) {
            bar.frame(width: 64, height: 9)
            bar.frame(width: 80, height: 18)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xs)
    }
}

/// The initial-fetch skeleton (web `<DriveDetailSkeleton>` shell): redacted cells in the same
/// responsive grid as the content.
struct MoreDetailsSkeleton: View {
    private let columns = [GridItem(.adaptive(minimum: 124), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.md) {
            ForEach(0 ..< 6, id: \.self) { _ in
                MoreDetailsSkeletonTile()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(MoreDetailsStrings.text("driveDetail.moreDetails.loading", "Loading drive details"))
    }
}

// MARK: - Error state (web `QueryError`)

/// The fetch-failure state with a retry affordance (web `QueryError`). Surfaces the failure
/// message under the title when present.
struct MoreDetailsErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            MoreDetailsStrings.text("driveDetail.moreDetails.errorTitle", "Couldn't load drive details")
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
                MoreDetailsStrings.text("driveDetail.moreDetails.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(MoreDetailsStrings.text("driveDetail.moreDetails.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty hint

/// The "no additional detail" caption shown under the fallback tiles in the empty state, so the
/// resolved-but-empty surface reads as intentional rather than blank.
struct MoreDetailsEmptyHint: View {
    var body: some View {
        MoreDetailsStrings.text("driveDetail.moreDetails.empty", "No additional detail for this drive yet")
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, alignment: .center)
            .accessibilityLabel(
                MoreDetailsStrings.text("driveDetail.moreDetails.empty", "No additional detail for this drive yet")
            )
    }
}
