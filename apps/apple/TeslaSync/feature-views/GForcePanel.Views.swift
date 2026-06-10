//
//  GForcePanel.Views.swift
//  TeslaSync — P4 feature view · 0169 · GForcePanel (Apple)
//
//  The presentational chrome composed by `GForcePanel`: the responsive 3-up stat row, the single
//  stat card (web `StatCard` — label + gauge glyph + value + `g` unit), the freshness chip, and the
//  loading skeleton row. All consume pre-localized strings from the P1/S10 facade and the shared
//  P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Responsive stat row (web `Grid cols={{ default: 1, sm: 3 }}`)

/// The three stat cards in a responsive grid — one-up on compact widths, flowing to three-up on
/// wider iPad / Mac windows, mirroring the web `cols={{ default: 1, sm: 3 }}` breakpoints via an
/// adaptive column track.
struct GForceStatGrid: View {
    let projection: GForceProjection

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(projection.tiles) { tile in
                GForceStatCardView(tile: tile)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: GForceAccessibility.summary(for: projection)))
    }
}

// MARK: - Stat card (web `StatCard`)

/// One stat card — the native parity of the web `<StatCard icon label value unit="g">`: a muted
/// label with a trailing gauge glyph, then the bold value with its `g` unit suffix on the baseline.
/// A missing reading renders the web `'—'` sentinel as the value while still showing the `g` unit.
struct GForceStatCardView: View {
    let tile: GForceStatTile

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                header
                valueRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(tile.label) \(tile.spokenValue)"))
    }

    /// Web top row: `<span class="text-sm font-medium text-muted">{label}</span>` with the trailing
    /// muted `<Gauge/>` glyph.
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: tile.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: TSSpacing.xs)
            Image(systemName: "gauge.with.dots.needle.bottom.50percent")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
    }

    /// Web baseline row: `<span class="text-2xl font-bold">{value}</span>` + the muted `g` unit.
    private var valueRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(verbatim: tile.value)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(verbatim: tile.unit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Freshness chip (Live / Stale / Offline / Updating)

/// The header freshness chip reflecting the bound source's live-state (ADR-013): a tinted dot, a
/// localized label, and an optional relative "updated" stamp.
struct GForceFreshnessChip: View {
    let connection: GForceConnection
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
            return GForcePanelStrings.string("dynamics.gForce.updating", "Updating")
        }
        switch connection {
        case .live: return GForcePanelStrings.string("dynamics.gForce.live", "Live")
        case .stale: return GForcePanelStrings.string("dynamics.gForce.stale", "Stale")
        case .offline: return GForcePanelStrings.string("dynamics.gForce.offline", "Offline")
        }
    }
}

// MARK: - Loading skeleton row (stat-card-shaped skeletons)

/// The initial-fetch skeleton chrome: three stat-card-shaped skeletons in the same responsive grid,
/// respecting Reduce Motion via the shared `TSSkeleton`.
struct GForceLoadingGrid: View {
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 3, id: \.self) { _ in
                GForceStatSkeletonTile()
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: GForcePanelStrings.string(
            "dynamics.gForce.loading",
            "Loading G-force telemetry"
        )))
    }
}

/// One skeleton stat tile: a short label bar with a trailing glyph dot over a wider value bar.
private struct GForceStatSkeletonTile: View {
    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack {
                    TSSkeleton(width: 64, height: 12)
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
                }
                TSSkeleton(width: 80, height: 24)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
