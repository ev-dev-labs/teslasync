//
//  OdometerCounterWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0070 · OdometerCounterWidget (Apple)
//
//  Small presentation primitives the surface composes: the animated odometer
//  readout (web `AnimatedNumber` with a unit suffix) and the breakdown tile (web
//  `MetricCard` with an icon + tone). Both render over the shared design tokens —
//  the shared `TSAnimatedNumber` / `TSMetricCard` can't express the per-size font
//  or the icon+tone combo this surface needs, so they extend the same tokens the
//  way `TwinBadge` extends `TSBadge`.
//

import SwiftUI

// MARK: - Animated odometer readout (web `AnimatedNumber`)

/// A monospaced, rolling-digit numeric readout that animates value changes via the
/// numeric content transition, honoring Reduce Motion — the native analogue of the
/// web `AnimatedNumber`. The caller passes the already-formatted string (the
/// projection owns formatting) plus the font/color for the current layout.
struct OdometerReadout: View {
    let text: String
    let font: Font
    var color: Color = .TS.accent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(verbatim: text)
            .font(font)
            .fontWeight(.bold)
            .monospacedDigit()
            .foregroundStyle(color)
            .contentTransition(.numericText())
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: text)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
    }
}

// MARK: - Breakdown tile (web `MetricCard`)

/// One labeled metric tile with a tinted leading icon — the native analogue of the
/// web `MetricCard` (`label` + `value` + `icon` + `color`). Tighter than the shared
/// `TSCard` so two tiles fit a small widget footprint.
struct OdometerMetricTile: View {
    let systemImage: String
    let label: String
    let value: String
    let tone: Color

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(tone)
                    .accessibilityHidden(true)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.5)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.08), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.2), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(value)"))
    }
}
