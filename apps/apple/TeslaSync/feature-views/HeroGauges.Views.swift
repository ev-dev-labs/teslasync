//
//  HeroGauges.Views.swift
//  TeslaSync — P4 feature view · 0058 · HeroGauges (Apple)
//
//  The presentational chrome composed by `HeroGauges`: the six-gauge responsive grid, the single
//  gauge tile (web `MetricCard`), the tinted accent icon chip (web `MetricCard color`), the
//  freshness chip, and the loading skeleton grid. All consume pre-localized strings from the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Accent → token mapping (web `neonColorMap`)

extension HeroAccent {
    /// Maps the web `MetricCard` colour name to its adaptive design token, so the icon chip keeps
    /// the source's palette (cyan / purple / green / amber) across light, dark, and high-contrast.
    var color: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .purple: Color.TS.chartSeriesPower
        case .green: Color.TS.statusSuccess
        case .amber: Color.TS.statusWarning
        }
    }
}

// MARK: - Responsive gauge grid (web `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`)

/// The six gauges in a responsive grid — two-up on compact widths, flowing to three/six-up on
/// wider iPad / Mac windows, mirroring the web breakpoints via an adaptive column track.
struct HeroGaugesGrid: View {
    let projection: HeroGaugesProjection

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(projection.tiles) { tile in
                HeroGaugeTile(tile: tile)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: HeroGaugesAccessibility.summary(for: projection)))
    }
}

// MARK: - Gauge tile (web `MetricCard`)

/// One gauge: a small label + a large value + an optional unit subtitle, with a tinted accent icon
/// chip — the native parity of the web `MetricCard`.
struct HeroGaugeTile: View {
    let tile: HeroGaugeTileModel

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: tile.label)
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                TSMetricValue(tile.value)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let subtitle = tile.subtitle {
                    Text(verbatim: subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            HeroAccentIconBox(systemName: tile.systemImage, accent: tile.accent)
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
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        if let subtitle = tile.subtitle {
            return "\(tile.label) \(tile.value) \(subtitle)"
        }
        return "\(tile.label) \(tile.value)"
    }
}

// MARK: - Accent icon chip (web `MetricCard` tinted icon box)

/// A rounded, tinted container for the gauge's SF Symbol — the parity of the web `MetricCard`
/// icon box (`bg color/10`, `ring color/20`). Mirrors `TSIconBox` but accepts the full hero accent
/// palette (including purple) the shared `TSTone` does not carry.
struct HeroAccentIconBox: View {
    let systemName: String
    let accent: HeroAccent

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(accent.color)
            .frame(width: 34, height: 34)
            .background(
                accent.color.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(accent.color.opacity(0.22), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline / Updating)

/// The header freshness chip reflecting the bound source's live-state (ADR-013): a tinted dot, a
/// localized label, and an optional relative "updated" stamp.
struct HeroGaugesFreshnessChip: View {
    let connection: HeroConnection
    let isFetching: Bool
    let updatedAt: Date?

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if let updatedAt {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(updatedAt, style: .relative)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var tone: Color {
        if isFetching { return Color.TS.accent }
        switch connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.textMuted
        }
    }

    private var label: String {
        if isFetching {
            return HeroGaugesStrings.string("analytics.hero.updating", "Updating")
        }
        switch connection {
        case .live: return HeroGaugesStrings.string("analytics.hero.live", "Live")
        case .stale: return HeroGaugesStrings.string("analytics.hero.stale", "Stale")
        case .offline: return HeroGaugesStrings.string("analytics.hero.offline", "Offline")
        }
    }
}

// MARK: - Loading skeleton grid (web six `MetricSkeleton`s)

/// The initial-fetch skeleton chrome: six gauge-shaped skeletons in the same responsive grid (web
/// `Array.from({ length: 6 }).map(() => <MetricSkeleton />)`), respecting Reduce Motion via the
/// shared `TSSkeleton`.
struct HeroGaugesLoadingGrid: View {
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 6, id: \.self) { _ in
                HeroGaugeSkeletonTile()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(HeroGaugesStrings.text("analytics.hero.loading", "Loading fleet metrics"))
    }
}

/// One skeleton gauge tile (web `MetricSkeleton`: a 60%×12 label bar over a 40%×24 value bar).
private struct HeroGaugeSkeletonTile: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 64, height: 12)
            TSSkeleton(width: 44, height: 24)
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
    }
}
