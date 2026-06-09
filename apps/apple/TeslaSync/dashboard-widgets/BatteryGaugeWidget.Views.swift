//
//  BatteryGaugeWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0013 · BatteryGaugeWidget (Apple)
//
//  The presentational subviews composed by `BatteryGaugeWidget`, each mapping a web shared
//  component onto an Apple-idiomatic primitive:
//    • `BatteryGaugeWidgetRadialGauge`         ← web `RadialGauge` (@/components/charts) in `WidgetGaugeHero`
//    • `BatteryGaugeWidgetChargingChip`        ← web charging child (`⚡ Charging`)
//    • `BatteryGaugeWidgetLoadingView`         ← web `WidgetShell` `loading` skeleton
//    • `BatteryGaugeWidgetConnectivityBanner`  ← web `WidgetShell` freshness (stale / offline)
//  All consume the pre-projected values + pre-localized strings (P1/S10) and the shared P1/S9 tokens
//  — no networking, no Tailwind.
//

import SwiftUI

// MARK: - Battery band → colour (web `batteryColor`)

extension BatteryGaugeWidgetBand {
    /// The exact web `batteryColor()` hex value for the band, expressed in sRGB so the native gauge
    /// tints identically to the web widget (`#10b981` / `#f59e0b` / `#ef4444` / `#374151`).
    var color: Color {
        switch self {
        case .high: Color(.sRGB, red: 16 / 255, green: 185 / 255, blue: 129 / 255, opacity: 1)
        case .medium: Color(.sRGB, red: 245 / 255, green: 158 / 255, blue: 11 / 255, opacity: 1)
        case .low: Color(.sRGB, red: 239 / 255, green: 68 / 255, blue: 68 / 255, opacity: 1)
        case .unknown: Color(.sRGB, red: 55 / 255, green: 65 / 255, blue: 81 / 255, opacity: 1)
        }
    }
}

// MARK: - Radial gauge (web `RadialGauge`)

/// The Apple-idiomatic counterpart of the web `RadialGauge` SVG ring: a track + a banded value arc
/// starting at 12 o'clock, a centred percentage readout with the "%" unit, and the "Battery" caption
/// below the ring. The arc fill animates on change unless Reduce Motion is on.
struct BatteryGaugeWidgetRadialGauge: View {
    let gauge: BatteryGaugeWidgetGauge
    var diameter: CGFloat = 100

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var lineWidth: CGFloat {
        max(6, diameter * 0.08)
    }

    private var clampedFraction: Double {
        min(max(gauge.fraction, 0), 1)
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ZStack {
                Circle()
                    .stroke(Color.TS.border.opacity(0.6), style: StrokeStyle(lineWidth: lineWidth))
                Circle()
                    .trim(from: 0, to: clampedFraction)
                    .stroke(gauge.band.color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration),
                        value: clampedFraction
                    )
                centerReadout
            }
            .frame(width: diameter, height: diameter)

            Text(verbatim: gauge.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: gauge.accessibilityLabel))
    }

    /// Web centre span: `{fmtNumber(clamped, d)}{unit}` — the big percentage with the small "%" unit
    /// inline, rendered via `Text` concatenation so they share one baseline like the web `<span>`.
    private var centerReadout: some View {
        (
            Text(verbatim: gauge.valueText)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                + Text(verbatim: gauge.unit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        )
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .padding(.horizontal, lineWidth)
    }
}

// MARK: - Charging chip (web `⚡ Charging`)

/// The charging caption shown beneath the gauge when the vehicle is charging — the native counterpart
/// of the web `⚡ {t('widget.charging')}` line (emerald, gently pulsing). Honors Reduce Motion.
struct BatteryGaugeWidgetChargingChip: View {
    let text: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    private var emerald: Color {
        Color(.sRGB, red: 110 / 255, green: 231 / 255, blue: 183 / 255, opacity: 1)
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 9, weight: .bold))
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(emerald)
        .opacity(reduceMotion ? 1 : (pulse ? 0.55 : 1))
        .animation(
            reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true),
            value: pulse
        )
        .onAppear { pulse = true }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Loading skeleton (web `WidgetShell` `loading`)

/// The initial-fetch skeleton: a circular gauge shape over a short caption shape, matching the loaded
/// hero's rhythm. Honors Reduce Motion via `TSSkeleton`.
struct BatteryGaugeWidgetLoadingView: View {
    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 100, height: 100, cornerRadius: 50)
            TSSkeleton(width: 56, height: 12, cornerRadius: TSRadius.sm)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: BatteryGaugeWidgetStrings.string(
            "widget.battery.loading",
            "Loading battery level"
        )))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the gauge when the bound source is not live, so the cached
/// battery level is clearly labeled (web freshness-indicator intent).
struct BatteryGaugeWidgetConnectivityBanner: View {
    let connection: BatteryGaugeWidgetConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.battery.offlineBanner" : "widget.battery.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known level"
            : "Reconnecting — level may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: BatteryGaugeWidgetStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
