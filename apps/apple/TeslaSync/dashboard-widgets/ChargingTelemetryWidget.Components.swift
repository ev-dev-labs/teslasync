//
//  ChargingTelemetryWidget.Components.swift
//  TeslaSync — P4 dashboard widget · 0025 · ChargingTelemetryWidget (Apple)
//
//  The leaf views the ChargingTelemetryWidget surface composes: the per-metric
//  stat cell (web `StatCard` via `WidgetStatGrid`), the rolling-power sparkline
//  (web `Sparkline`, a Swift Charts line), the charger-type badge (web `Badge`),
//  the compact live indicator and the freshness banner. Kept in their own file so
//  the surface file stays within the house length limit.
//

import Charts
import SwiftUI

// MARK: - Stat cell (web `StatCard` inside `WidgetStatGrid`)

/// One metric cell: a muted label with a trailing icon above a semibold value
/// with an optional unit, mirroring the web `StatCard` (label row + value/unit
/// baseline row). `accent` highlights the power value in the charging color (web
/// `valueColor: 'text-emerald-300'`).
struct ChargingTelemetryStatCell: View {
    let kind: ChargingTelemetryStatKind
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer(minLength: 0)
                Image(systemName: symbol)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(verbatim: value)
                    .font(Font.TS.panel)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(accent ? Color.TS.statusSuccess : Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var label: String {
        ChargingTelemetryStrings.statLabel(kind)
    }

    private var unit: String? {
        ChargingTelemetryStrings.statUnit(kind)
    }

    /// The power metric is accented in the charging color (web `text-emerald-300`).
    private var accent: Bool {
        kind == .power
    }

    /// The SF Symbol mirroring each web Lucide icon (Zap / Gauge /
    /// BatteryCharging / Gauge).
    private var symbol: String {
        switch kind {
        case .voltage: "bolt.fill"
        case .current: "gauge.with.dots.needle.bottom.50percent"
        case .power: "bolt.batteryblock.fill"
        case .phases: "gauge.with.dots.needle.bottom.50percent"
        case .efficiency: "gauge.with.dots.needle.bottom.50percent"
        }
    }

    private var accessibilityLabel: String {
        if let unit {
            return "\(label) \(value) \(unit)"
        }
        return "\(label) \(value)"
    }
}

// MARK: - Power sparkline (web `Sparkline`)

/// The rolling charger-power trend, a compact Swift Charts line in the charging
/// color (web `<Sparkline color="#22c55e" />`). Axes and legend are hidden so it
/// reads as a sparkline; VoiceOver gets a labelled summary instead.
struct ChargingTelemetryPowerSparkline: View {
    let samples: [Double]

    var body: some View {
        Chart(Array(samples.enumerated()), id: \.offset) { index, value in
            LineMark(
                x: .value("sample", index),
                y: .value("power", value)
            )
            .foregroundStyle(Color.TS.statusSuccess)
            .interpolationMethod(.catmullRom)
            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartYScale(domain: yDomain)
        .chartLegend(.hidden)
        .frame(height: 28)
        .accessibilityElement()
        .accessibilityLabel(
            ChargingTelemetryStrings.text("widget.chargingTelemetry.powerTrend", "Charging power trend")
        )
    }

    /// A padded domain so a flat line is not clipped to the frame edges.
    private var yDomain: ClosedRange<Double> {
        let lower = samples.min() ?? 0
        let upper = samples.max() ?? 1
        if upper <= lower {
            return (lower - 1) ... (upper + 1)
        }
        let pad = (upper - lower) * 0.15
        return (lower - pad) ... (upper + pad)
    }
}

// MARK: - Charger-type badge (web `Badge`)

/// The AC/DC charger badge (web `<Badge variant={dc ? 'warning' : 'neutral'}>`).
/// DC carries the warning tone; AC stays neutral.
struct ChargingTelemetryChargerBadge: View {
    let type: ChargingTelemetryChargerType

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 3)
            .background(tone.opacity(0.16), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: label))
    }

    private var label: String {
        let name = ChargingTelemetryStrings.chargerTypeName(type)
        let charger = ChargingTelemetryStrings.string("widget.chargingTelemetry.charger", "Charger")
        return "\(name) \(charger)"
    }

    private var tone: Color {
        switch type {
        case .dc: Color.TS.statusWarning
        case .ac: Color.TS.textSecondary
        }
    }
}

// MARK: - Compact live indicator (web compact charging branch)

/// The compact 1-column charging readout: a pulsing bolt over the power value and
/// a voltage·current subline (web compact `BatteryCharging` + `{power} kW` +
/// `{voltage}V · {current}A`). The pulse honors Reduce Motion.
struct ChargingTelemetryCompactIndicator: View {
    let projection: ChargingTelemetryProjection
    let locale: Locale

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "bolt.batteryblock.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .opacity(reduceMotion ? 1 : (pulse ? 0.45 : 1))
                .accessibilityHidden(true)
            Text(verbatim: powerLabel)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.statusSuccess)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(verbatim: subline)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: ChargingTelemetryAccessibility.summary(for: projection, locale: locale)))
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) { pulse = true }
        }
    }

    private var powerLabel: String {
        let power = ChargingTelemetryFormat.number(projection.power, fractionDigits: 1, locale: locale)
        let unit = ChargingTelemetryStrings.string("widget.chargingTelemetry.unitKw", "kW")
        return "\(power) \(unit)"
    }

    private var subline: String {
        let voltage = ChargingTelemetryFormat.number(projection.voltage, fractionDigits: 0, locale: locale)
        let current = ChargingTelemetryFormat.number(projection.current, fractionDigits: 0, locale: locale)
        let volt = ChargingTelemetryStrings.string("widget.chargingTelemetry.unitVolt", "V")
        let amp = ChargingTelemetryStrings.string("widget.chargingTelemetry.unitAmp", "A")
        return "\(voltage)\(volt) · \(current)\(amp)"
    }
}

// MARK: - Freshness banner (stale / offline)

/// The reconnect/offline banner shown above charging content when the live feed
/// is not fresh, so cached values stay visible behind a clear flag (ADR-013).
struct ChargingTelemetryConnectivityBanner: View {
    let connection: ChargingTelemetryConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            ChargingTelemetryStrings.text(key, fallback)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var isOffline: Bool {
        connection == .offline
    }

    private var key: String {
        isOffline ? "widget.chargingTelemetry.offlineBanner" : "widget.chargingTelemetry.staleBanner"
    }

    private var fallback: String {
        isOffline ? "Offline — showing last known reading" : "Reconnecting — values may be stale"
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }
}
