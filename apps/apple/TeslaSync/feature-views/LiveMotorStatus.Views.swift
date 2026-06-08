//
//  LiveMotorStatus.Views.swift
//  TeslaSync — P4 feature view · 0170 · LiveMotorStatus (Apple)
//
//  The presentational chrome composed by `LiveMotorStatus`: the responsive gauge row, the single
//  radial gauge (web `RadialGauge`), the shift-state badge (web `Badge` + Cog glyph), the
//  freshness chip, and the loading skeleton row. All consume pre-localized strings from the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Accent → token mapping (web RadialGauge hex colours)

extension MotorAccent {
    /// Maps the web `RadialGauge` colour to its design token. Each token's sRGB is an exact match
    /// for the web hex, so the arc keeps the source's palette across light, dark, and
    /// high-contrast: torque blue `#3b82f6`, RPM purple `#a855f7`, temperature amber `#f59e0b`.
    var color: Color {
        switch self {
        case .torqueBlue: Color.TS.chartSeriesSpeed
        case .rpmPurple: Color.TS.chartSeriesPower
        case .tempAmber: Color.TS.statusWarning
        }
    }
}

// MARK: - Responsive gauge row (web `grid-cols-2 md:grid-cols-4`)

/// The three gauges plus the shift-state badge in a responsive grid — two-up on compact widths,
/// flowing to four-up on wider iPad / Mac windows, mirroring the web `cols={{ default: 2, md: 4
/// }}` breakpoints via an adaptive column track.
struct LiveMotorGrid: View {
    let projection: LiveMotorProjection

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.lg) {
            ForEach(projection.gauges) { gauge in
                MotorRadialGaugeView(tile: gauge)
            }
            MotorShiftBadgeTile(shift: projection.shift)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: LiveMotorAccessibility.summary(for: projection)))
    }
}

// MARK: - Radial gauge (web `RadialGauge` + caption span)

/// One radial gauge: a neutral track ring, an accent-coloured progress arc filling `value / max`,
/// a centre value + optional unit suffix, the gauge label, and the caption span beneath — the
/// native parity of the web `RadialGauge` plus its sibling `<span>`. The arc fills in on appear
/// and honours Reduce Motion.
struct MotorRadialGaugeView: View {
    let tile: MotorGaugeTile

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var fill: Double = 0

    private let diameter: CGFloat = 112
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

// MARK: - Shift-state badge tile (web `Badge` with the Cog glyph)

/// The shift-state badge over its "Shift State" caption — the native parity of the web
/// `<Badge variant={shift === 'D' ? 'success' : 'neutral'}><Cog/> {shift ?? 'Unknown'}</Badge>`.
/// Sized to the gauge height so it sits flush in the responsive row.
struct MotorShiftBadgeTile: View {
    let shift: MotorShiftBadge

    private let gaugeHeight: CGFloat = 112

    private var tone: TSTone {
        shift.isDrive ? .success : .neutral
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ZStack {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "gearshape.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .accessibilityHidden(true)
                    Text(verbatim: shift.displayText)
                        .font(Font.TS.panel)
                        .fontWeight(.semibold)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .foregroundStyle(tone.color)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.sm)
                .background(tone.color.opacity(0.15), in: Capsule())
                .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            }
            .frame(height: gaugeHeight)
            Text(verbatim: shift.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(shift.label) \(shift.displayText)"))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline / Updating)

/// The header freshness chip reflecting the bound source's live-state (ADR-013): a tinted dot, a
/// localized label, and an optional relative "updated" stamp.
struct LiveMotorFreshnessChip: View {
    let connection: LiveMotorConnection
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
            return LiveMotorStatusStrings.string("dynamics.motor.updating", "Updating")
        }
        switch connection {
        case .live: return LiveMotorStatusStrings.string("dynamics.motor.live", "Live")
        case .stale: return LiveMotorStatusStrings.string("dynamics.motor.stale", "Stale")
        case .offline: return LiveMotorStatusStrings.string("dynamics.motor.offline", "Offline")
        }
    }
}

// MARK: - Loading skeleton row (gauge-shaped skeletons)

/// The initial-fetch skeleton chrome: four gauge-shaped skeletons in the same responsive grid,
/// respecting Reduce Motion via the shared `TSSkeleton`.
struct LiveMotorLoadingGrid: View {
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.lg) {
            ForEach(0 ..< 4, id: \.self) { _ in
                MotorGaugeSkeletonTile()
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: LiveMotorStatusStrings.string(
            "dynamics.motor.loading",
            "Loading live motor data"
        )))
    }
}

/// One skeleton gauge tile: a ring-shaped outline over short label + caption bars.
private struct MotorGaugeSkeletonTile: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Circle()
                .stroke(Color.TS.textMuted.opacity(0.22), lineWidth: 8)
                .frame(width: 112, height: 112)
            TSSkeleton(width: 56, height: 12)
            TSSkeleton(width: 72, height: 10)
        }
        .padding(.vertical, TSSpacing.xs)
    }
}
