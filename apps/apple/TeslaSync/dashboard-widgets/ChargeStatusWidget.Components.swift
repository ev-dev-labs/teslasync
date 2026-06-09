//
//  ChargeStatusWidget.Components.swift
//  TeslaSync — P4 dashboard widget · 0021 · ChargeStatusWidget (Apple)
//
//  The leaf SwiftUI subviews the Charge Status surface composes: the pulsing charging
//  glyph and the metric label/value blocks (plain + glass-tiled). They hold no surface
//  state, so they live beside the main view to keep `ChargeStatusWidget.swift` focused on
//  the state machine + layout.
//

import SwiftUI

// MARK: - Charging pulse icon (web `BatteryCharging … animate-pulse`)

/// The charging glyph with a gentle opacity pulse, the native parity of the web
/// `animate-pulse`. The animation is suppressed under Reduce Motion.
struct ChargingPulseIcon: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        Image(systemName: "battery.100.bolt")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Color.TS.statusSuccess)
            .opacity(pulsing ? 0.45 : 1)
            .animation(
                reduceMotion ? nil : .easeInOut(duration: 0.9).repeatForever(autoreverses: true),
                value: pulsing
            )
            .onAppear { if !reduceMotion { pulsing = true } }
            .accessibilityHidden(true)
    }
}

// MARK: - Charge metric (web grid `<div>` block)

/// One charging metric: an uppercase muted label over a value with an optional unit suffix.
/// `.positive`-tone values (charger power) use the success color, the native parity of the
/// web `text-emerald-300` vs `text-[var(--text-primary)]` treatment.
struct ChargeMetricView: View {
    let metric: ChargeMetric

    private var valueColor: Color {
        switch metric.tone {
        case .positive: Color.TS.statusSuccess
        case .primary: Color.TS.textPrimary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: metric.label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(verbatim: metric.value)
                    .font(Font.TS.panel)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(valueColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if !metric.unit.isEmpty {
                    Text(verbatim: metric.unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(metric.label) \(metric.spokenValue)"))
    }
}

/// `ChargeMetricView` wrapped in a glass tile, used for the standard (2×2+) layout so each
/// metric reads as its own card. Reuses `ChargeMetricView` to keep the rendering DRY.
struct ChargeMetricTile: View {
    let metric: ChargeMetric

    var body: some View {
        ChargeMetricView(metric: metric)
            .padding(TSSpacing.sm)
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
