//
//  VehicleHero.GaugeViews.swift
//  TeslaSync — P4 feature view · 0133 · VehicleHero (Apple)
//
//  The value-plus-unit radial gauge, the wrapping gauge row, and the charging-detail
//  card. The gauge is the SwiftUI parity of the web `RadialGauge` (the shared
//  `TSRadialGauge` only renders a percent, so the hero needs a gauge that shows the
//  measured value + its unit in the centre). All tokens come from P1/S9; no hex.
//

import SwiftUI

// MARK: - Radial gauge (web `RadialGauge`, value + unit centre)

/// A single value-plus-unit radial gauge — the SwiftUI parity of the web `RadialGauge`
/// (ring filled to `fraction`, the measured value + unit in the centre, the label
/// beneath). Honours Reduce Motion on the fill animation.
struct VehicleHeroPanelGaugeView: View {
    let gauge: VehicleHeroPanelGauge
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let diameter: CGFloat = 78
    private let lineWidth: CGFloat = 8

    var body: some View {
        let label = VehicleHeroPanelStrings.string(gauge.labelKey, gauge.labelFallback)
        return VStack(spacing: TSSpacing.xs) {
            ZStack {
                Circle()
                    .stroke(Color.TS.border.opacity(0.3), lineWidth: lineWidth)
                Circle()
                    .trim(from: 0, to: gauge.fraction)
                    .stroke(
                        VehicleHeroPanelPalette.color(gauge.accent),
                        style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                    .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.slowDuration), value: gauge.fraction)
                centre
            }
            .frame(width: diameter, height: diameter)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(width: diameter + TSSpacing.sm)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: VehicleHeroPanelAccessibility.gaugeLabel(
            label: label, value: gauge.valueText, unit: gauge.unit
        )))
    }

    private var centre: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(verbatim: gauge.valueText)
                .font(.system(size: 17, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            if !gauge.unit.isEmpty {
                Text(verbatim: gauge.unit)
                    .font(.system(size: 10, weight: .regular))
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .padding(.horizontal, 4)
    }
}

/// The context-aware gauge row — a centred, wrapping grid of gauges (web flex-wrap).
struct VehicleHeroPanelGaugeRow: View {
    let gauges: [VehicleHeroPanelGauge]

    private let columns = [GridItem(.adaptive(minimum: 86), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(gauges) { gauge in
                VehicleHeroPanelGaugeView(gauge: gauge)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Charging detail (web `is_charging` block)

/// The charging-detail card — the pulsing bolt header plus the power / rate /
/// time-to-full summary, shown only while charging.
struct VehicleHeroPanelChargingView: View {
    let detail: VehicleHeroPanelChargingDetail
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    private let columns = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            heading
            LazyVGrid(columns: columns, spacing: TSSpacing.sm) {
                stat(labelKey: "hero.chargePower", fallback: "Power", value: detail.powerText, accent: .chargePower)
                stat(labelKey: "hero.chargeRate", fallback: "Rate", value: detail.rateText, accent: .powerIdle)
                timeToFull
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusSuccess.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusSuccess.opacity(0.2), lineWidth: 1)
        )
        .onAppear { pulse = true }
    }

    private var heading: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: VehicleHeroPanelIcon.batteryCharging)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .opacity(pulse && !reduceMotion ? 0.4 : 1)
                .animation(
                    reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true),
                    value: pulse
                )
                .accessibilityHidden(true)
            Text(verbatim: VehicleHeroPanelStrings.string("hero.charging", "Charging"))
                .font(Font.TS.bodySm.weight(.medium))
                .foregroundStyle(Color.TS.statusSuccess)
        }
    }

    private func stat(labelKey: String, fallback: String, value: String, accent: VehicleHeroPanelAccent) -> some View {
        VStack(spacing: 2) {
            Text(verbatim: VehicleHeroPanelStrings.string(labelKey, fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: value)
                .font(Font.TS.bodySm.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(VehicleHeroPanelPalette.color(accent))
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var timeToFull: some View {
        VStack(spacing: 2) {
            Text(verbatim: VehicleHeroPanelStrings.string("hero.timeToFull", "Time to Full"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: detail.timeToFullText)
                .font(Font.TS.bodySm.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            if let doneAt = detail.doneAt {
                Text(verbatim: VehicleHeroPanelStrings.string("hero.doneAt", "Done")
                    + " ~" + doneAt.formatted(date: .omitted, time: .shortened))
                    .font(.system(size: 10))
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
