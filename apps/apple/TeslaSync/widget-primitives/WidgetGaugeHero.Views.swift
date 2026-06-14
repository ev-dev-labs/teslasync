//
//  WidgetGaugeHero.Views.swift
//  TeslaSync — P4 widget primitive · 0007 · WidgetGaugeHero (Apple)
//
//  The presentational pieces of the gauge hero — the native peers of the web elements: the radial ring (the
//  native peer of `<RadialGauge>` — a track ring under a rounded progress arc that starts at the top and
//  sweeps clockwise to `value / max`, the formatted reading + unit at its center, and the caption below),
//  the wrapping supporting-stats row (the native peer of the web `flex flex-wrap justify-center` row), and
//  each stat cell (the native peer of the web centered label + value + unit). All chrome is token-driven
//  (P1/S9); no raw hex, no Tailwind ports. The ring folds into one VoiceOver element reading its caption +
//  value with a spoken percent; each stat folds into one element; the arc animation honors Reduce Motion.
//

import SwiftUI

// MARK: - GaugeTint → design token

extension GaugeTint {
    /// The arc color — the theme-aware projection of the web `gauge.color` string. Reads from the design
    /// system so the gauge recolors across light / dark / high-contrast.
    var color: Color {
        switch self {
        case .accent: Color.TS.accent
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .info: Color.TS.statusInfo
        case .battery: Color.TS.chartSeriesBattery
        case .energy: Color.TS.chartSeriesEnergy
        case .speed: Color.TS.chartSeriesSpeed
        case .regen: Color.TS.chartSeriesRegen
        case .temperature: Color.TS.chartSeriesTemperature
        case .power: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - GaugeRingView (web `<RadialGauge>`)

/// The radial hero gauge — the native peer of the web `<RadialGauge>`. A muted track ring under a rounded
/// progress arc (the tinted `value / max` fill, starting at 12 o'clock and sweeping clockwise), with the
/// formatted reading + optional unit centered inside and the caption below. The arc animates to its fill
/// with the design system's slow motion, honoring Reduce Motion. The whole control is one VoiceOver
/// element reading "{label}, {value}{unit}" with the spoken percent as its accessibility value.
struct GaugeRingView: View {
    let ring: GaugeRingModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The track ring tint — the theme-aware peer of the web `text-gray-200 dark:text-gray-700`, derived
    /// from a token (no raw hex) so it recolors with the theme.
    private var trackColor: Color {
        Color.TS.textMuted.opacity(0.2)
    }

    private var diameter: CGFloat {
        CGFloat(ring.diameter)
    }

    private var stroke: CGFloat {
        CGFloat(ring.strokeWidth)
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            dial
            Text(verbatim: ring.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityValue(Text(verbatim: WidgetGaugeHeroStrings.gaugeAccessibilityValue(percent: ring.percentFilled)))
    }

    /// The track + progress arc with the centered reading — the web `<svg>` over the absolutely-centered
    /// value. Sized to the ring diameter so the host lays it out as one block.
    private var dial: some View {
        ZStack {
            Circle()
                .strokeBorder(trackColor, lineWidth: stroke)

            Circle()
                .inset(by: stroke / 2)
                .trim(from: 0, to: ring.fraction)
                .stroke(ring.tint.color, style: StrokeStyle(lineWidth: stroke, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(TSAnimation.slow(reduceMotion: reduceMotion), value: ring.fraction)

            centerReading
                .padding(stroke)
        }
        .frame(width: diameter, height: diameter)
    }

    /// The centered value with its optional unit affix — the web `text-lg font-bold` value + the `text-xs
    /// font-normal` muted unit span. Scales down rather than clipping inside the condensed ring.
    private var centerReading: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(verbatim: ring.displayValue)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
            if !ring.unit.isEmpty {
                Text(verbatim: ring.unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.5)
    }

    private var accessibilityLabel: String {
        WidgetGaugeHeroStrings.gaugeAccessibilityLabel(
            label: ring.label,
            value: ring.displayValue,
            unit: ring.unit
        )
    }
}

// MARK: - GaugeStatsRow (web `flex flex-wrap items-center justify-center`)

/// The supporting-stats row — the native peer of the web `<div className="flex flex-wrap items-center
/// justify-center gap-x-4 gap-y-1">`. Lays the stat cells left-to-right, wrapping onto centered rows on a
/// narrow host (the native analogue of `flex-wrap` + `justify-center`), with the web's `gap-x-4` (16) /
/// `gap-y-1` (4) spacing.
struct GaugeStatsRow: View {
    let stats: [GaugeStatModel]

    var body: some View {
        GaugeStatsFlowLayout(horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.xs) {
            ForEach(stats) { model in
                GaugeStatCell(stat: model.stat)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - GaugeStatCell (web centered label + value + unit)

/// One supporting stat — the native peer of the web `<div className="flex min-w-0 flex-col items-center
/// text-center">`: the muted, truncated label over the semibold value with its optional muted unit affix.
/// The whole cell is one VoiceOver element reading "{label}, {value}{unit}".
struct GaugeStatCell: View {
    let stat: GaugeHeroStat

    var body: some View {
        VStack(spacing: 2) {
            Text(verbatim: stat.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
            valueLine
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var valueLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(verbatim: stat.value)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            if let unit = stat.unit, !unit.isEmpty {
                Text(verbatim: unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .lineLimit(1)
        .truncationMode(.tail)
    }

    private var accessibilityLabel: String {
        WidgetGaugeHeroStrings.statAccessibilityLabel(label: stat.label, value: stat.value, unit: stat.unit)
    }
}

// MARK: - GaugeStatsFlowLayout (web `flex-wrap` + `justify-center`)

/// A centered wrapping flow — the native peer of the web `flex flex-wrap justify-center`. Lays subviews
/// left-to-right, wrapping to a new row when the next subview would exceed the proposed width, and centers
/// each row horizontally. The inter-item / inter-row spacing are the web `gap-x` / `gap-y`.
struct GaugeStatsFlowLayout: Layout {
    var horizontalSpacing: CGFloat
    var verticalSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        let rows = computeRows(maxWidth: maxWidth, subviews: subviews)
        let widest = rows.map(\.width).max() ?? 0
        let totalHeight = rows.reduce(0) { $0 + $1.height }
            + verticalSpacing * CGFloat(Swift.max(0, rows.count - 1))
        let resolvedWidth = proposal.width.map { Swift.min(widest, $0) } ?? widest
        return CGSize(width: resolvedWidth, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let rows = computeRows(maxWidth: bounds.width, subviews: subviews)
        var originY = bounds.minY
        for row in rows {
            var originX = bounds.minX + (bounds.width - row.width) / 2
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: originX, y: originY),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(size)
                )
                originX += size.width + horizontalSpacing
            }
            originY += row.height + verticalSpacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func computeRows(maxWidth: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if current.indices.isEmpty {
                current = Row(indices: [index], width: size.width, height: size.height)
                continue
            }
            let projected = current.width + horizontalSpacing + size.width
            if projected > maxWidth {
                rows.append(current)
                current = Row(indices: [index], width: size.width, height: size.height)
            } else {
                current.indices.append(index)
                current.width = projected
                current.height = Swift.max(current.height, size.height)
            }
        }
        if !current.indices.isEmpty {
            rows.append(current)
        }
        return rows
    }
}
