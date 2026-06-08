//
//  TemperatureMetricCards.Views.swift
//  TeslaSync — P4 feature view · 0161 · TemperatureMetricCards (Apple)
//
//  The presentational chrome composed by `TemperatureMetricCards`: the freshness chip, the
//  stale/offline connectivity banner, the responsive metric-card grid (the web `MetricCard`
//  grid), the per-card tile (label / value / "percent of max" or "No data" subtitle / accent
//  icon box), the initial-fetch skeleton, the retryable error state, and the empty hint. All
//  consume pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Localization facade (SwiftUI text helper)

extension TemperatureMetricsStrings {
    /// SwiftUI `Text` for a key + web fallback. Kept in the view file so the model/adapter stay
    /// Foundation-only.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accent → design token

extension TemperatureCardAccent {
    /// The design-token color for the accent (web `MetricCard` `c.text`). `green`/`amber`/`red`
    /// map to the theme-adaptive semantic tokens; `purple` maps to the brand chart-series
    /// purple — the canonical equivalent of the web `neon-purple` (`rgb(168, 85, 247)`), which
    /// has no theme-adaptive token.
    var color: Color {
        switch self {
        case .green: Color.TS.statusSuccess
        case .amber: Color.TS.statusWarning
        case .red: Color.TS.statusDanger
        case .purple: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct TemperatureFreshnessChip: View {
    let connection: TemperatureMetricsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            TemperatureMetricsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TemperatureMetricsStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: TemperatureMetricsConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "drivetrain.temp.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "drivetrain.temp.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "drivetrain.temp.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not live, so cached
/// cards are clearly labeled while reconnecting / offline.
struct TemperatureConnectivityBanner: View {
    let connection: TemperatureMetricsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "drivetrain.temp.offlineBanner" : "drivetrain.temp.staleBanner"
        let fallback = offline
            ? "Offline — showing last known drivetrain temperatures"
            : "Reconnecting — drivetrain temperatures may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            TemperatureMetricsStrings.text(key, fallback).font(Font.TS.caption)
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

/// The rounded, tinted SF-Symbol box on the trailing edge of a card (web `c.bg / c.ring /
/// c.text`). Takes the resolved accent color directly so the brand purple (which has no
/// semantic token) renders correctly alongside the green / amber / red cards.
struct TemperatureMetricIconBox: View {
    let systemImage: String
    let accent: TemperatureCardAccent

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

// MARK: - Metric card (web `MetricCard`)

/// One metric card: the label, the prominent value, the optional subtitle ("percent of max" or
/// "No data" for sensors; absent for Health Score / Peak Power), and the accent icon box. The
/// whole card is a single VoiceOver element reading "{label}, {value}[, {subtitle}]".
struct TemperatureMetricCardTile: View {
    let card: TemperatureMetricCardModel

    private var label: String {
        TemperatureMetricsStrings.string(card.labelKey, card.labelFallback)
    }

    /// Resolves the subtitle enum into its localized line (web `${pct}% of max` / `No data`).
    private var subtitleText: String? {
        switch card.subtitle {
        case .none:
            nil
        case let .percentOfMax(percent):
            "\(percent)% \(TemperatureMetricsStrings.string("drivetrain.ofMax", "of max"))"
        case .noData:
            TemperatureMetricsStrings.string("drivetrain.noData", "No data")
        }
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
                if let subtitleText {
                    Text(verbatim: subtitleText)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: TSSpacing.xs)
            TemperatureMetricIconBox(systemImage: card.systemImage, accent: card.accent)
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
            Text(verbatim: TemperatureMetricsAccessibility.cardSummary(
                card,
                localize: TemperatureMetricsStrings.string
            ))
        )
    }
}

// MARK: - Responsive grid (web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`)

/// The responsive card grid. `.adaptive` columns reproduce the web breakpoints — two cards on a
/// compact width, growing to the full six on a regular/large width.
struct TemperatureCardsGrid: View {
    let cards: [TemperatureMetricCardModel]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(cards) { card in
                TemperatureMetricCardTile(card: card)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Skeleton (initial fetch)

/// One redacted skeleton card. Static bars (no shimmer) so it is reduce-motion-safe by
/// construction.
struct TemperatureSkeletonTile: View {
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

/// The initial-fetch skeleton grid (web `loading` shell): six redacted cards in the same
/// responsive grid as the content.
struct TemperatureCardsSkeleton: View {
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 6, id: \.self) { _ in
                TemperatureSkeletonTile()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            TemperatureMetricsStrings.text("drivetrain.temp.loading", "Loading drivetrain temperatures")
        )
    }
}

// MARK: - Error state (web `QueryError`)

/// The fetch-failure state with a retry affordance (web `QueryError`). Surfaces the failure
/// message under the title when present.
struct TemperatureErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TemperatureMetricsStrings.text("drivetrain.temp.errorTitle", "Couldn't load drivetrain temperatures")
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
                TemperatureMetricsStrings.text("drivetrain.temp.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TemperatureMetricsStrings.text("drivetrain.temp.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty hint

/// The "no data" caption shown under the em-dash cards in the empty state, so the
/// resolved-but-empty surface reads as intentional rather than blank.
struct TemperatureEmptyHint: View {
    var body: some View {
        TemperatureMetricsStrings.text("drivetrain.temp.empty", "No drivetrain temperature data yet")
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, alignment: .center)
            .accessibilityLabel(
                TemperatureMetricsStrings.text("drivetrain.temp.empty", "No drivetrain temperature data yet")
            )
    }
}
