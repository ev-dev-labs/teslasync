//
//  PedalUsage.Views.swift
//  TeslaSync — P4 feature view · 0173 · PedalUsage (Apple)
//
//  The presentational chrome composed by `PedalUsage`: the responsive pedal row, the single radial
//  gauge (web `RadialGauge`), the brake-active status badge (web `Badge` + Footprints glyph), the
//  freshness chip, and the loading skeleton row. All consume pre-localized strings from the P1/S10
//  facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Accent → token mapping (web RadialGauge hex colours)

extension PedalAccent {
    /// Maps the web `RadialGauge` colour to its design token. Each token's sRGB is an exact match for
    /// the web hex, so the arc keeps the source's palette across light, dark, and high-contrast:
    /// throttle cyan `#06b6d4` and brake red `#ef4444`.
    var color: Color {
        switch self {
        case .throttleCyan: Color.TS.chartSeriesRegen
        case .brakeRed: Color.TS.chartSeriesTemperature
        }
    }
}

// MARK: - Responsive pedal row (web `Grid cols={{ default: 1, sm: 3 }}`)

/// The two gauges plus the brake-active badge in a responsive grid — one-up on compact widths,
/// flowing to three-up on wider iPad / Mac windows, mirroring the web `cols={{ default: 1, sm: 3 }}`
/// breakpoints via an adaptive column track.
struct PedalGrid: View {
    let projection: PedalProjection

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.lg) {
            ForEach(projection.gauges) { gauge in
                PedalRadialGaugeView(tile: gauge)
            }
            PedalBrakeStatusTile(brake: projection.brake)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: PedalAccessibility.summary(for: projection)))
    }
}

// MARK: - Radial gauge (web `RadialGauge` + caption span)

/// One radial gauge: a neutral track ring, an accent-coloured progress arc filling `value / max`, a
/// centre value + its unit suffix, the gauge label, and the descriptive caption span beneath — the
/// native parity of the web `RadialGauge` plus its sibling `<span>`. The arc fills in on appear and
/// honours Reduce Motion.
struct PedalRadialGaugeView: View {
    let tile: PedalGaugeTile

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var fill: Double = 0

    private let diameter: CGFloat = 132
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
            Text(verbatim: tile.caption)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.vertical, TSSpacing.xs)
        .onAppear { animate(to: tile.fraction) }
        .onChange(of: tile.fraction) { _, newValue in animate(to: newValue) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(tile.label) \(tile.spokenValue)"))
    }

    private var centreReadout: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(verbatim: tile.centerValue)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: tile.unit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
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

// MARK: - Brake-active status badge (web `Badge` with the Footprints glyph)

/// The brake-active badge over its "Brake Pedal Status" caption, with the Footprints glyph above —
/// the native parity of the web `<Footprints/>` + `<Badge variant={brakeActive ? 'danger' :
/// 'success'}>…</Badge>`. Sized to the gauge height so it sits flush in the responsive row.
struct PedalBrakeStatusTile: View {
    let brake: PedalBrakeStatus

    private let gaugeHeight: CGFloat = 132

    private var tone: TSTone {
        brake.isDanger ? .danger : .success
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            VStack(spacing: TSSpacing.md) {
                Image(systemName: "shoeprints.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                badge
            }
            .frame(height: gaugeHeight)
            Text(verbatim: brake.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(brake.label) \(brake.displayText)"))
    }

    private var badge: some View {
        Text(verbatim: brake.displayText)
            .font(Font.TS.panel)
            .fontWeight(.semibold)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline / Updating)

/// The header freshness chip reflecting the bound source's live-state (ADR-013): a tinted dot, a
/// localized label, and an optional relative "updated" stamp.
struct PedalFreshnessChip: View {
    let connection: PedalConnection
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
            return PedalUsageStrings.string("dynamics.pedal.updating", "Updating")
        }
        switch connection {
        case .live: return PedalUsageStrings.string("dynamics.pedal.live", "Live")
        case .stale: return PedalUsageStrings.string("dynamics.pedal.stale", "Stale")
        case .offline: return PedalUsageStrings.string("dynamics.pedal.offline", "Offline")
        }
    }
}

// MARK: - Loading skeleton row (gauge-shaped skeletons)

/// The initial-fetch skeleton chrome: three gauge-shaped skeletons in the same responsive grid,
/// respecting Reduce Motion via the shared `TSSkeleton`.
struct PedalLoadingGrid: View {
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.lg) {
            ForEach(0 ..< 3, id: \.self) { _ in
                PedalGaugeSkeletonTile()
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: PedalUsageStrings.string(
            "dynamics.pedal.loading",
            "Loading pedal telemetry"
        )))
    }
}

/// One skeleton gauge tile: a ring-shaped outline over short label + caption bars.
private struct PedalGaugeSkeletonTile: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Circle()
                .stroke(Color.TS.textMuted.opacity(0.22), lineWidth: 8)
                .frame(width: 132, height: 132)
            TSSkeleton(width: 56, height: 12)
            TSSkeleton(width: 80, height: 10)
        }
        .padding(.vertical, TSSpacing.xs)
    }
}
