//
//  CostSummaryCards.Views.swift
//  TeslaSync — P4 feature view · 0111 · CostSummaryCards (Apple)
//
//  The presentational chrome composed by `CostSummaryCards`: the freshness chip, the
//  stale/offline connectivity banner, the responsive cost-tile grid (the web `StatBox`
//  grid wrapped in `StaggerContainer`/`StaggerItem`), the per-tile card (accent icon box /
//  label / value / subtitle), the initial-fetch skeleton, the retryable error state, and the
//  empty hint. All consume pre-localized strings from the P1/S10 facade and the shared P1/S9
//  tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct CostFreshnessChip: View {
    let connection: CostSummaryConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            CostSummaryStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(CostSummaryStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: CostSummaryConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "costAnalysis.stats.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "costAnalysis.stats.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "costAnalysis.stats.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not live, so cached
/// tiles are clearly labeled (web `DataFreshness` indicator intent).
struct CostConnectivityBanner: View {
    let connection: CostSummaryConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "costAnalysis.stats.offlineBanner" : "costAnalysis.stats.staleBanner"
        let fallback = offline
            ? "Offline — showing last known cost summary"
            : "Reconnecting — cost summary may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            CostSummaryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Accent icon box (web `StatBox` icon slot)

/// The rounded, tinted SF-Symbol box on the leading edge of a tile (web
/// `<div class="rounded-lg bg-[var(--surface-2)] p-2">{icon}</div>` with the lucide glyph
/// tinted `text-{color}-400`). The box uses the accent tint at low opacity so the tile reads
/// as an Apple-idiomatic tinted icon chip while keeping the web glyph color.
struct CostMetricIconBox: View {
    let systemImage: String
    let accent: CostAccent

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(accent.color)
            .frame(width: 34, height: 34)
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

// MARK: - Cost tile (web `StatBox`)

/// One cost tile: the accent icon box, the truncating label, the prominent value, and the
/// subtitle (web `<StatBox icon label value sub glow />`). The value + subtitle render
/// verbatim (already-localized, already-formatted strings). The whole tile is a single
/// VoiceOver element reading "{label}, {value} {subtitle}". `glow` adds a persistent tinted
/// border + soft shadow for the emphasized tiles (the web hover glow, made always-on for
/// touch platforms).
struct CostStatTile: View {
    let card: CostSummaryCardModel

    private var borderColor: Color {
        card.glow.color?.opacity(0.35) ?? Color.TS.border
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            CostMetricIconBox(systemImage: card.systemImage, accent: card.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: card.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: card.value)
                    .font(Font.TS.section)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(verbatim: card.subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(borderColor, lineWidth: 1)
        )
        .shadow(color: card.glow.color?.opacity(0.18) ?? .clear, radius: 8, y: 0)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: CostSummaryAccessibility.cardSummary(card)))
    }
}

// MARK: - Responsive grid (web `grid-cols-2 lg:grid-cols-3 xl:grid-cols-6`)

/// The responsive tile grid. `.adaptive` columns reproduce the web breakpoints — two tiles on
/// a compact width, growing to the full six on a regular/large width. Each tile is wrapped in
/// a `TSStaggerItem` so the grid cascades in like the web `StaggerItem` children.
struct CostCardsGrid: View {
    let cards: [CostSummaryCardModel]

    private let columns = [GridItem(.adaptive(minimum: 158), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                TSStaggerItem(index: index) {
                    CostStatTile(card: card)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Skeleton (initial fetch)

/// One redacted skeleton tile. Static bars (no shimmer) so it is reduce-motion-safe by
/// construction.
struct CostSkeletonTile: View {
    private var bar: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.border.opacity(0.3))
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            bar.frame(width: 34, height: 34)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                bar.frame(width: 60, height: 9)
                bar.frame(width: 92, height: 18)
                bar.frame(width: 48, height: 9)
            }
            Spacer(minLength: 0)
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

/// The initial-fetch skeleton grid (web `<Skeleton>` shell): six redacted tiles in the same
/// responsive grid as the content.
struct CostCardsSkeleton: View {
    private let columns = [GridItem(.adaptive(minimum: 158), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 6, id: \.self) { _ in
                CostSkeletonTile()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(CostSummaryStrings.text("costAnalysis.stats.loading", "Loading cost summary"))
    }
}

// MARK: - Error state (web `QueryError`)

/// The fetch-failure state with a retry affordance (web `QueryError`). Surfaces the failure
/// message under the title when present.
struct CostErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            CostSummaryStrings.text("costAnalysis.stats.errorTitle", "Couldn't load cost summary")
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
                CostSummaryStrings.text("costAnalysis.stats.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CostSummaryStrings.text("costAnalysis.stats.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty hint

/// The "no sessions" caption shown under the zeroed tiles in the empty state, so the
/// resolved-but-empty surface reads as intentional rather than blank.
struct CostEmptyHint: View {
    var body: some View {
        CostSummaryStrings.text("costAnalysis.stats.empty", "No charging sessions for this period yet")
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, alignment: .center)
            .accessibilityLabel(
                CostSummaryStrings.text("costAnalysis.stats.empty", "No charging sessions for this period yet")
            )
    }
}
