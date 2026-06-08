//
//  QuickMetrics.Views.swift
//  TeslaSync — P4 feature view · 0105 · QuickMetrics (Apple)
//
//  The presentational chrome composed by `QuickMetrics`: the freshness chip, the stale/offline
//  connectivity banner, the responsive metric-tile grid (web `grid-cols-2 sm:grid-cols-3
//  md:grid-cols-6`), the per-tile value/label cell (the bold value over an icon + label, web
//  `text-center`), the animated count value (web `<AnimatedNumber>`), and the loading / empty /
//  error states. All copy resolves through the P1/S10 facade and all chrome is token-driven
//  (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Tone palette (web value text color → adaptive token)

/// Maps a tile's `QuickMetricTone` to a design-token color. The web uses Tailwind value colors
/// (`emerald-300` / `rose-300` / `amber-300` / `--text-primary`); native uses the theme-adaptive
/// semantic tokens so light / dark / high-contrast all resolve correctly.
enum QuickMetricsPalette {
    static func valueColor(for tone: QuickMetricTone) -> Color {
        switch tone {
        case .success: Color.TS.statusSuccess
        case .danger: Color.TS.statusDanger
        case .warning: Color.TS.statusWarning
        case .primary: Color.TS.textPrimary
        }
    }
}

// MARK: - Animated value (web `<AnimatedNumber>`)

/// The tile value, animating digit changes for the three count tiles (web `<AnimatedNumber>`)
/// via the shared native idiom `.contentTransition(.numericText())`, and rendering verbatim for
/// the derived tiles. Honors Reduce Motion (no animation when reduced).
struct QuickMetricValueText: View {
    let metric: QuickMetric
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(verbatim: metric.value)
            .font(Font.TS.section)
            .fontWeight(.bold)
            .monospacedDigit()
            .foregroundStyle(QuickMetricsPalette.valueColor(for: metric.tone))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .contentTransition(.numericText())
            .animation(
                metric.animatesValue && !reduceMotion ? .easeOut(duration: TSMotion.normalDuration) : nil,
                value: metric.value
            )
    }
}

// MARK: - Metric tile (web tile)

/// One centered metric cell: the bold, tone-colored value over an optional glyph + the muted
/// label (web `<div><p class="text-lg font-bold …">value</p><p class="text-[10px] …">icon
/// label</p></div>`). The whole tile is a single VoiceOver element reading "{label}: {value}".
struct QuickMetricTile: View {
    let metric: QuickMetric

    private var label: String {
        QuickMetricsStrings.string(metric.labelKey, metric.labelFallback)
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            QuickMetricValueText(metric: metric)
            HStack(spacing: 4) {
                if let systemImage = metric.systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: QuickMetricsAccessibility.tileLabel(metric, localize: QuickMetricsStrings.string))
        )
    }
}

// MARK: - Responsive grid (web `grid-cols-2 sm:grid-cols-3 md:grid-cols-6`)

/// The responsive tile grid. `.adaptive` columns reproduce the web breakpoints — two tiles on a
/// compact width, growing toward the full six on a regular / large width.
struct QuickMetricsGrid: View {
    let metrics: [QuickMetric]

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            ForEach(metrics) { metric in
                QuickMetricTile(metric: metric)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// A compact freshness chip reflecting the bound source's live-state (ADR-013). Shown only when
/// the strip is not live, so the healthy state stays as visually clean as the web source.
struct QuickMetricsFreshnessChip: View {
    let connection: QuickMetricsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            QuickMetricsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(QuickMetricsStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: QuickMetricsConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "charging.metrics.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "charging.metrics.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "charging.metrics.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not live, so cached
/// metrics are clearly labeled while reconnecting / offline.
struct QuickMetricsConnectivityBanner: View {
    let connection: QuickMetricsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "charging.metrics.offlineBanner" : "charging.metrics.staleBanner"
        let fallback = offline
            ? "Offline — showing last known metrics"
            : "Reconnecting — metrics may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            QuickMetricsStrings.text(key, fallback).font(Font.TS.caption)
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
struct QuickMetricsSkeletonTile: View {
    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            TSSkeleton(width: 48, height: 18, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 64, height: 9, cornerRadius: TSRadius.sm)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xs)
    }
}

/// The initial-fetch skeleton grid: six redacted tiles in the same responsive grid as content.
struct QuickMetricsLoading: View {
    private let columns = [GridItem(.adaptive(minimum: 104), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            ForEach(0 ..< 6, id: \.self) { _ in
                QuickMetricsSkeletonTile()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(QuickMetricsStrings.text("charging.metrics.loading", "Loading charging metrics"))
    }
}

// MARK: - Empty state (web `EmptyState` — "No charging metrics available yet")

/// The resolved-but-empty state: the web `<EmptyState message={t('charging.noMetrics')} />` over
/// a native `ContentUnavailableView` with a metrics glyph. Never a blank box.
struct QuickMetricsEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                QuickMetricsStrings.text("charging.noMetrics", "No charging metrics available yet")
            } icon: {
                Image(systemName: "chart.bar.xaxis")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance. Mirrors the inline error treatment used
/// across the feature-view surfaces.
struct QuickMetricsError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            QuickMetricsStrings.text("charging.metrics.errorTitle", "Couldn't load charging metrics")
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
                QuickMetricsStrings.text("charging.metrics.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(QuickMetricsStrings.text("charging.metrics.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
