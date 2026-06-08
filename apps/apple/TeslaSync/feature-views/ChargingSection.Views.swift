//
//  ChargingSection.Views.swift
//  TeslaSync — P4 feature view · 0074 · ChargingSection (Apple)
//
//  Presentational chrome composed by `ChargingSection`: the panel header + freshness
//  chip, the stale/offline connectivity banner, the four-tile stat grid (web
//  `MiniStat` row), the "Energy vs. Last Week" badge row, and the loading / empty /
//  error states. All copy resolves through the P1/S10 facade; all chrome is token-
//  driven (P1/S9). No networking and no Tailwind ports live here. The Swift Charts
//  bar chart lives in `ChargingSection.Chart.swift`.
//

import SwiftUI

// MARK: - Stat icon mapping (web lucide `Zap` / `Activity` / `Fuel`)

extension ChargingStatKind {
    /// The SF Symbol for the tile, mirroring the web lucide glyphs (Sessions +
    /// Total Energy use `Zap`, Avg Charge Rate uses `Activity`, Total Cost `Fuel`).
    var systemImage: String {
        switch self {
        case .sessions: "bolt.fill"
        case .totalEnergy: "bolt.fill"
        case .avgRate: "waveform.path.ecg"
        case .totalCost: "fuelpump.fill"
        }
    }
}

// MARK: - Badge palette (web `success` / `warning` variants)

/// Maps the trend tone to an adaptive semantic token so light / dark / high-contrast
/// all resolve correctly (web static green / yellow badge backgrounds).
enum ChargingBadgePalette {
    static func tint(_ tone: ChargingTrendTone) -> Color {
        switch tone {
        case .positive: Color.TS.statusSuccess
        case .negative: Color.TS.statusWarning
        }
    }
}

// MARK: - Header (title + freshness chip)

/// The section header: the web `<Zap class="text-neon-green"/> Charging` heading
/// plus the live-state freshness chip.
struct ChargingHeader: View {
    let connection: ChargingConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            ChargingStrings.text("analytics.weeklyDigest.chargingSection", "Charging")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            ChargingFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct ChargingFreshnessChip: View {
    let connection: ChargingConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            ChargingStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ChargingStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: ChargingConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "analytics.weeklyDigest.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "analytics.weeklyDigest.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "analytics.weeklyDigest.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not
/// live, so cached tiles are clearly labeled (web `DataFreshness` intent).
struct ChargingConnectivityBanner: View {
    let connection: ChargingConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline
            ? "analytics.weeklyDigest.charging.offlineBanner"
            : "analytics.weeklyDigest.charging.staleBanner"
        let fallback = offline
            ? "Offline — showing last known charging summary"
            : "Reconnecting — charging summary may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            ChargingStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Stat grid (web `MiniStat` row)

/// The responsive four-tile stat grid — the parity of the web
/// `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` `MiniStat` row. Tiles reflow from one
/// column to four as width allows.
struct ChargingStatsGrid: View {
    let stats: [ChargingStat]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(stats) { stat in
                ChargingStatTile(stat: stat)
            }
        }
    }
}

/// One stat tile (web `MiniStat`): a muted glyph, a caption label, and the bold
/// value.
struct ChargingStatTile: View {
    let stat: ChargingStat

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: stat.kind.systemImage)
                .font(.system(size: 14))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                ChargingStrings.text(stat.kind.localizationKey, stat.kind.fallback)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Text(verbatim: stat.value)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ChargingStrings.text(stat.kind.localizationKey, stat.kind.fallback))
        .accessibilityValue(Text(verbatim: stat.value))
    }
}

// MARK: - Week-over-week row (web badge panel)

/// The "Energy vs. Last Week" row: the caption + the success/warning trend badge.
struct ChargingWeekOverWeekRow: View {
    let trend: ChargingTrend

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ChargingStrings.text("analytics.weeklyDigest.energyVsLastWeek", "Energy vs. Last Week")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            ChargingTrendBadge(trend: trend)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ChargingStrings.text("analytics.weeklyDigest.energyVsLastWeek", "Energy vs. Last Week"))
        .accessibilityValue(Text(verbatim: trend.value))
    }
}

/// The trend badge (web `<Badge variant size="sm">`): a tinted capsule of the
/// percentage delta (or em-dash sentinel).
struct ChargingTrendBadge: View {
    let trend: ChargingTrend

    var body: some View {
        let tint = ChargingBadgePalette.tint(trend.tone)
        return Text(verbatim: trend.value)
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .monospacedDigit()
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tint.opacity(0.16), in: Capsule())
            .foregroundStyle(tint)
            .accessibilityHidden(true)
    }
}

// MARK: - Loading state (web `Skeleton` chrome)

/// The initial-fetch skeleton: a chart block, a four-tile grid, and the badge row,
/// respecting Reduce Motion (via `TSSkeleton`).
struct ChargingLoading: View {
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSSkeleton(height: 200, cornerRadius: TSRadius.md)
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 52, cornerRadius: TSRadius.sm)
                }
            }
            TSSkeleton(height: 40, cornerRadius: TSRadius.md)
        }
        .accessibilityElement()
        .accessibilityLabel(ChargingStrings.text("analytics.weeklyDigest.charging.loading", "Loading charging summary"))
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The resolved-but-empty state: a native `ContentUnavailableView` with the bolt
/// glyph. Never a blank box.
struct ChargingEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                ChargingStrings.text("analytics.weeklyDigest.charging.empty", "No charging this week")
            } icon: {
                Image(systemName: "bolt.slash")
            }
        } description: {
            ChargingStrings.text(
                "analytics.weeklyDigest.charging.emptyHint",
                "Charging sessions will appear here once your vehicle charges this week."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct ChargingError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ChargingStrings.text("analytics.weeklyDigest.charging.errorTitle", "Couldn't load charging summary")
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
                ChargingStrings.text("analytics.weeklyDigest.charging.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChargingStrings.text("analytics.weeklyDigest.charging.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
