//
//  DetailedStatistics.Views.swift
//  TeslaSync — P4 feature view · 0101 · DetailedStatistics (Apple)
//
//  The presentational chrome composed by `DetailedStatistics`: the stale/offline connectivity
//  banner, the responsive statistic-tile grid (web `grid-cols-2 sm:grid-cols-3 md:grid-cols-6`),
//  the per-tile value/label cell (the bold value over a label, web `text-center`), the animated
//  count value (web `<AnimatedNumber>`), and the loading / empty / error states. All copy resolves
//  through the P1/S10 facade and all chrome is token-driven (P1/S9). No networking and no Tailwind
//  ports live here.
//

import SwiftUI

// MARK: - Tone palette (web value text color → design token)

/// Maps a tile's `DetailedStatisticTone` to a design-token color. The web uses Tailwind value
/// colors (`purple-300` / `amber-300` / `emerald-300` / `--text-primary`); native uses the semantic
/// tokens so light / dark / high-contrast all resolve correctly. Avg Power maps to the
/// `chartSeriesPower` token — the same violet the charting layer uses for power series.
enum DetailedStatisticsPalette {
    static func valueColor(for tone: DetailedStatisticTone) -> Color {
        switch tone {
        case .primary: Color.TS.textPrimary
        case .power: Color.TS.chartSeriesPower
        case .warning: Color.TS.statusWarning
        case .success: Color.TS.statusSuccess
        }
    }
}

// MARK: - Animated value (web `<AnimatedNumber>`)

/// The tile value, animating digit changes for the Total Sessions count (web `<AnimatedNumber>`)
/// via the shared native idiom `.contentTransition(.numericText())`, and rendering verbatim for the
/// other tiles. Honors Reduce Motion (no animation when reduced).
struct DetailedStatisticValueText: View {
    let metric: DetailedStatistic
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(verbatim: metric.value)
            .font(Font.TS.section)
            .fontWeight(.bold)
            .monospacedDigit()
            .foregroundStyle(DetailedStatisticsPalette.valueColor(for: metric.tone))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .contentTransition(.numericText())
            .animation(
                metric.animatesValue && !reduceMotion ? .easeOut(duration: TSMotion.normalDuration) : nil,
                value: metric.value
            )
    }
}

// MARK: - Statistic tile (web tile)

/// One centered statistic cell: the bold, tone-colored value over the muted label (web
/// `<div><p class="text-lg font-bold …">value</p><p class="text-[10px] …">label</p></div>`). The
/// Top Charger tile appends a "(N×)" occurrence count to its label. The whole tile is a single
/// VoiceOver element reading "{label}: {value}".
struct DetailedStatisticTile: View {
    let metric: DetailedStatistic

    private var label: String {
        DetailedStatisticsAccessibility.composedLabel(metric, localize: DetailedStatisticsStrings.string)
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            DetailedStatisticValueText(metric: metric)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: DetailedStatisticsAccessibility.tileLabel(
                metric,
                localize: DetailedStatisticsStrings.string
            ))
        )
    }
}

// MARK: - Responsive grid (web `grid-cols-2 sm:grid-cols-3 md:grid-cols-6`)

/// The responsive tile grid. `.adaptive` columns reproduce the web breakpoints — two tiles on a
/// compact width, growing toward the full six on a regular / large width.
struct DetailedStatisticsGrid: View {
    let metrics: [DetailedStatistic]

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            ForEach(metrics) { metric in
                DetailedStatisticTile(metric: metric)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// A compact freshness chip reflecting the bound source's live-state (ADR-013). Shown in the header
/// only when the panel is not live, so the healthy state stays as visually clean as the web source.
struct DetailedStatisticsFreshnessChip: View {
    let connection: DetailedStatisticsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            DetailedStatisticsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(DetailedStatisticsStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: DetailedStatisticsConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "charging.stats.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "charging.stats.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "charging.stats.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not live, so cached
/// statistics are clearly labeled while reconnecting / offline.
struct DetailedStatisticsConnectivityBanner: View {
    let connection: DetailedStatisticsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "charging.stats.offlineBanner" : "charging.stats.staleBanner"
        let fallback = offline
            ? "Offline — showing last known statistics"
            : "Reconnecting — statistics may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            DetailedStatisticsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// One redacted skeleton tile mirroring the centered value + label cell.
struct DetailedStatisticsSkeletonTile: View {
    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            TSSkeleton(width: 56, height: 18, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 64, height: 9, cornerRadius: TSRadius.sm)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xs)
    }
}

/// The initial-fetch skeleton grid: six redacted tiles in the same responsive grid as content.
struct DetailedStatisticsLoading: View {
    private let columns = [GridItem(.adaptive(minimum: 104), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            ForEach(0 ..< 6, id: \.self) { _ in
                DetailedStatisticsSkeletonTile()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(DetailedStatisticsStrings.text("charging.stats.loading", "Loading detailed statistics"))
    }
}

// MARK: - Empty state (resolved, no sessions)

/// The resolved-but-empty state: the web parent renders nothing when there were no sessions; native
/// shows a friendly `ContentUnavailableView` with a chart glyph so the panel is never a blank box.
struct DetailedStatisticsEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                DetailedStatisticsStrings.text("charging.stats.noData", "No charging statistics available yet")
            } icon: {
                Image(systemName: "chart.bar.xaxis")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance. Mirrors the inline error treatment used across
/// the feature-view surfaces.
struct DetailedStatisticsError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            DetailedStatisticsStrings.text("charging.stats.errorTitle", "Couldn't load detailed statistics")
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
                DetailedStatisticsStrings.text("charging.stats.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(DetailedStatisticsStrings.text("charging.stats.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
