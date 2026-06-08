//
//  SecurityStatistics.Views.swift
//  TeslaSync — P4 feature view · 0045 · SecurityStatistics (Apple)
//
//  The composed subviews for the SecurityStatistics surface: the header (title +
//  freshness chip), the metric grid + tile (web `MetricCard`), the loading skeleton
//  grid (web `Skeleton` ×7), the stale/offline banners (with a refresh affordance),
//  and the error view (web `QueryError` equivalent). Every user-facing string routes
//  through the P1/S10 facade or a shared component's localized key; every interactive
//  element carries a VoiceOver label.
//

import SwiftUI

// MARK: - Header (web `<h2>Security Statistics</h2>` + freshness chip)

struct SecurityStatisticsHeader: View {
    let connection: SecurityStatisticsConnection
    let showsFreshness: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: SecurityStatisticsStrings.string("admin.security.statsTitle", "Security Statistics"))
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if showsFreshness {
                SecurityStatisticsFreshnessChip(connection: connection)
            }
        }
    }
}

// MARK: - Freshness chip (live / stale / offline)

struct SecurityStatisticsFreshnessChip: View {
    let connection: SecurityStatisticsConnection

    var body: some View {
        let chip = SecurityStatisticsConnectionChip.project(connection)
        let label = SecurityStatisticsStrings.string(chip.labelKey, chip.labelFallback)
        return HStack(spacing: 4) {
            Circle()
                .fill(chip.tone.color)
                .frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Body (web `isLoading ? skeletons : securityStats ? grid : EmptyState`)

struct SecurityStatisticsBody: View {
    let phase: SecurityStatisticsPhase
    let tiles: [SecurityMetricTile]
    let connection: SecurityStatisticsConnection
    let onRetry: () -> Void
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            switch phase {
            case .loading:
                SecurityStatisticsSkeletonGrid()
            case .loaded:
                if connection != .live {
                    SecurityStatisticsBanner(connection: connection, onRefresh: onRefresh)
                }
                SecurityStatisticsMetricGrid(tiles: tiles)
            case .empty:
                emptyState
            case .failed:
                SecurityStatisticsErrorView(onRetry: onRetry)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web `<EmptyState icon={Activity} message={t('common.noData')} className="py-8"/>`.
    private var emptyState: some View {
        TSEmptyState(title: "common.noData", systemImage: "waveform.path.ecg")
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.x2xl)
    }
}

// MARK: - Metric grid (web responsive 2/3/4-col grid)

struct SecurityStatisticsMetricGrid: View {
    let tiles: [SecurityMetricTile]

    private let columns = [GridItem(.adaptive(minimum: 150, maximum: .infinity), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(tiles) { tile in
                SecurityMetricTileView(tile: tile)
            }
        }
    }
}

// MARK: - Metric tile (web `MetricCard`: label + value + tinted icon box)

struct SecurityMetricTileView: View {
    let tile: SecurityMetricTile

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: SecurityStatisticsStrings.string(tile.labelKey, tile.labelFallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Text(verbatim: tile.value)
                    .font(Font.TS.section)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
            SecurityMetricIcon(systemImage: tile.systemImage, color: tile.color.color)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: SecurityStatisticsAccessibility.tileLabel(tile, localize: SecurityStatisticsStrings.string))
        )
    }
}

// MARK: - Tinted icon box (web `<div className={c.bg c.ring}>{icon}</div>`)

struct SecurityMetricIcon: View {
    let systemImage: String
    let color: Color

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: 28, height: 28)
            .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(color.opacity(0.2), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Loading skeleton grid (web `Array.from({length:7}).map(Skeleton height 80)`)

struct SecurityStatisticsSkeletonGrid: View {
    private let columns = [GridItem(.adaptive(minimum: 150, maximum: .infinity), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 7, id: \.self) { _ in
                TSSkeleton(height: 80, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            Text(verbatim: SecurityStatisticsStrings.string("admin.security.stats.loading", "Loading statistics…"))
        )
    }
}

// MARK: - Inline banner (stale / offline) with a refresh affordance

struct SecurityStatisticsBanner: View {
    let connection: SecurityStatisticsConnection
    let onRefresh: () -> Void

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: descriptor.systemImage)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(descriptor.tone.color)
                .accessibilityHidden(true)
            Text(verbatim: SecurityStatisticsStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .small, action: onRefresh) {
                Text(verbatim: SecurityStatisticsStrings.string("admin.security.stats.refresh", "Refresh"))
            }
            .accessibilityLabel(
                Text(verbatim: SecurityStatisticsStrings.string("admin.security.stats.refresh", "Refresh"))
            )
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            descriptor.tone.color.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }

    private struct Descriptor {
        let tone: TSTone
        let key: String
        let fallback: String
        let systemImage: String
    }

    private static func descriptor(for connection: SecurityStatisticsConnection) -> Descriptor {
        switch connection {
        case .offline:
            Descriptor(
                tone: .neutral,
                key: "admin.security.stats.offlineBanner",
                fallback: "Offline — showing last statistics",
                systemImage: "wifi.slash"
            )
        case .stale:
            Descriptor(
                tone: .warning,
                key: "admin.security.stats.staleBanner",
                fallback: "Statistics may be out of date",
                systemImage: "clock.arrow.circlepath"
            )
        case .live:
            Descriptor(
                tone: .success,
                key: "admin.security.stats.live",
                fallback: "Live",
                systemImage: "checkmark.circle"
            )
        }
    }
}

// MARK: - Error view (web `QueryError` equivalent, with retry)

struct SecurityStatisticsErrorView: View {
    let onRetry: () -> Void

    var body: some View {
        TSQueryError(message: "admin.security.stats.errorMessage", onRetry: onRetry)
            .frame(maxWidth: .infinity)
    }
}
