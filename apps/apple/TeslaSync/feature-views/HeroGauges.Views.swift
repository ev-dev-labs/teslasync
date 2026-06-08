//
//  HeroGauges.Views.swift
//  TeslaSync — P4 feature view · 0103 · HeroGauges (Apple)
//
//  The presentational chrome composed by `HeroGauges`: the responsive gauge row, the single radial
//  gauge (web `RadialGauge`), the Avg $/kWh readout (web `AnimatedNumber`), the freshness chip, and
//  the loading skeleton row. All consume pre-localized strings from the P1/S10 facade and the
//  shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Accent → token mapping (web RadialGauge hex colours)

extension HeroAccent {
    /// Maps the web `RadialGauge` colour to its adaptive design token. Each token's RGB is an exact
    /// match for the web hex, so the arc keeps the source's palette across light, dark, and
    /// high-contrast: cyan `#00f0ff`, green `#10b981`, amber `#f59e0b`, purple `#a855f7`.
    var color: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .green: Color.TS.statusSuccess
        case .amber: Color.TS.statusWarning
        case .purple: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Responsive gauge row (web `grid-cols-2 sm:grid-cols-3 md:grid-cols-5`)

/// The four gauges plus the Avg $/kWh readout in a responsive grid — two-up on compact widths,
/// flowing to three/five-up on wider iPad / Mac windows, mirroring the web breakpoints via an
/// adaptive column track.
struct HeroGaugesGrid: View {
    let projection: HeroGaugesProjection

    private let columns = [GridItem(.adaptive(minimum: 116), spacing: TSSpacing.lg, alignment: .center)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.lg) {
            ForEach(projection.gauges) { gauge in
                HeroRadialGaugeView(tile: gauge)
            }
            HeroCostMetricTile(metric: projection.cost)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: HeroGaugesAccessibility.summary(for: projection)))
    }
}

// MARK: - Radial gauge (web `RadialGauge`)

/// One radial gauge: a neutral track ring, an accent-coloured progress arc filling `value / max`, a
/// centre value + optional unit suffix, and a label below — the native parity of the web
/// `RadialGauge`. The arc fills in on appear and honours Reduce Motion.
struct HeroRadialGaugeView: View {
    let tile: HeroGaugeTileModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var fill: Double = 0

    private let diameter: CGFloat = 104
    private let lineWidth: CGFloat = 8

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ZStack {
                Circle()
                    .stroke(Color.TS.textMuted.opacity(0.22), lineWidth: lineWidth)
                Circle()
                    .trim(from: 0, to: fill)
                    .stroke(
                        tile.accent.color,
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                centreReadout
            }
            .frame(width: diameter, height: diameter)
            Text(verbatim: tile.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.vertical, TSSpacing.xs)
        .onAppear { animate(to: tile.fraction) }
        .onChange(of: tile.fraction) { _, newValue in animate(to: newValue) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(tile.label) \(tile.spokenValue)"))
    }

    private var centreReadout: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(verbatim: tile.value)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            if let unit = tile.unit, !unit.isEmpty {
                Text(verbatim: unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .padding(.horizontal, lineWidth)
    }

    private func animate(to fraction: Double) {
        let target = min(max(fraction, 0), 1)
        withAnimation(reduceMotion ? nil : .easeOut(duration: TSMotion.slowDuration)) {
            fill = target
        }
    }
}

// MARK: - Avg $/kWh readout (web `$<AnimatedNumber decimals={3}>`)

/// The closing Avg $/kWh metric: an emerald-tinted animated currency value over an uppercase label,
/// the parity of the web `<p class="text-2xl font-bold text-emerald-300">$<AnimatedNumber/></p>`.
struct HeroCostMetricTile: View {
    let metric: HeroCostMetric

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            TSAnimatedNumber(formatted: metric.value)
                .foregroundStyle(Color.TS.statusSuccess)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(verbatim: metric.label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(metric.label) \(metric.value)"))
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
            return HeroGaugesStrings.string("charging.gauges.updating", "Updating")
        }
        switch connection {
        case .live: return HeroGaugesStrings.string("charging.gauges.live", "Live")
        case .stale: return HeroGaugesStrings.string("charging.gauges.stale", "Stale")
        case .offline: return HeroGaugesStrings.string("charging.gauges.offline", "Offline")
        }
    }
}

// MARK: - Loading skeleton row (gauge-shaped skeletons)

/// The initial-fetch skeleton chrome: five gauge-shaped skeletons in the same responsive grid,
/// respecting Reduce Motion via the shared `TSSkeleton`.
struct HeroGaugesLoadingGrid: View {
    private let columns = [GridItem(.adaptive(minimum: 116), spacing: TSSpacing.lg, alignment: .center)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.lg) {
            ForEach(0 ..< 5, id: \.self) { _ in
                HeroGaugeSkeletonTile()
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: HeroGaugesStrings.string(
            "charging.gauges.loading",
            "Loading charging stats"
        )))
    }
}

/// One skeleton gauge tile: a ring-shaped outline over a short label bar.
private struct HeroGaugeSkeletonTile: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Circle()
                .stroke(Color.TS.textMuted.opacity(0.22), lineWidth: 8)
                .frame(width: 104, height: 104)
            TSSkeleton(width: 56, height: 12)
        }
        .padding(.vertical, TSSpacing.xs)
    }
}
