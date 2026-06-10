//
//  FleetSummary.Views.swift
//  TeslaSync — P4 feature view · 0276 · FleetSummary (Apple)
//
//  The presentational chrome composed by `FleetSummary`: the four glass stat tiles
//  (Vehicles / Avg Battery / Total Range / Charging-Online), the adaptive tile grid, the
//  live-state freshness chip (stale / offline / updating), and the loading skeleton. All
//  consume pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Icon tone mapping (catalog enum → P1/S9 tokens)

extension FleetMetric.IconTone {
    /// The decorative icon tint (web `text-cyan-400` / `text-green-500` /
    /// `text-purple-400` / `text-amber-400`). `range` maps to the brand purple series
    /// color so it stays distinct from the cyan accent, matching the web.
    var color: Color {
        switch self {
        case .vehicles: Color.TS.accent
        case .battery: Color.TS.statusSuccess
        case .range: Color.TS.chartSeriesPower
        case .charging: Color.TS.statusWarning
        }
    }
}

// MARK: - Metric tile (web GlassPanel stat)

/// One fleet stat tile: a centered icon + animated value (+ optional `/ N` clause for
/// the charging tile) + an uppercase label (web `GlassPanel` with `AnimatedNumber`). The
/// whole tile is one VoiceOver element exposing the label + spoken value.
struct FleetMetricTile: View {
    let metric: FleetMetric

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: metric.systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(metric.iconTone.color)
                    .accessibilityHidden(true)
                valueRow
                Text(verbatim: metric.localizedLabel)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: metric.localizedLabel))
        .accessibilityValue(Text(verbatim: metric.accessibilityValue))
    }

    /// The big animated value, plus the muted `/ onlineCount` clause on the charging
    /// tile. The value tints success-green when highlighted (web `text-green-500`).
    private var valueRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            TSAnimatedNumber(formatted: metric.value)
                .foregroundStyle(metric.valueHighlighted ? Color.TS.statusSuccess : Color.TS.textPrimary)
            if let secondary = metric.secondary {
                Text(verbatim: secondary)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .monospacedDigit()
            }
        }
    }
}

// MARK: - Tile grid (web `grid-cols-2 sm:grid-cols-4`)

/// The responsive stat grid: two columns on compact widths, flowing to four on wider
/// layouts (web `grid-cols-2 sm:grid-cols-4 gap-4`).
struct FleetSummaryGrid: View {
    let metrics: [FleetMetric]

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            ForEach(metrics) { metric in
                FleetMetricTile(metric: metric)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Freshness chip (ADR-013 live-state)

/// The live-state freshness chip: a tinted dot, a localized status word, and the
/// relative age. Shown only when stale / offline / fetching so the live tile row stays
/// chrome-free like the web.
struct FleetSummaryFreshnessChip: View {
    let connection: FleetSummaryConnection
    let isFetching: Bool
    let ageLabel: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(FleetSummaryStrings.text("fleet.summary.freshness.label", "Data freshness"))
        .accessibilityValue(Text(verbatim: label))
    }

    private var tone: Color {
        if isFetching { return Color.TS.accent }
        switch connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.statusDanger
        }
    }

    private var label: String {
        if isFetching {
            return FleetSummaryStrings.string("fleet.summary.freshness.updating", "Updating")
        }
        let word: String = switch connection {
        case .live:
            FleetSummaryStrings.string("fleet.summary.freshness.live", "Live")
        case .stale:
            FleetSummaryStrings.string("fleet.summary.freshness.stale", "Stale")
        case .offline:
            FleetSummaryStrings.string("fleet.summary.freshness.offline", "Offline")
        }
        return "\(word) · \(ageLabel)"
    }
}

// MARK: - Loading skeleton (web initial-fetch chrome)

/// The initial-fetch skeleton: four tile-shaped skeletons in the same adaptive grid,
/// respecting Reduce Motion via the shared `TSSkeleton`.
struct FleetSummaryLoadingChrome: View {
    private let columns = [GridItem(.adaptive(minimum: 140), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            ForEach(0 ..< 4, id: \.self) { _ in
                TSSkeleton(height: 104, cornerRadius: TSRadius.lg)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(FleetSummaryStrings.text("fleet.summary.loading", "Loading fleet summary"))
    }
}
