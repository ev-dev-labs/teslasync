//
//  RegenEfficiencyWidget.Components.swift
//  TeslaSync — P4 dashboard widget · 0081 · RegenEfficiencyWidget (Apple)
//
//  The native subviews that map the web shared components onto Apple-idiomatic primitives:
//    • `RegenGaugeRing`     ← web `WidgetGaugeHero` → `RadialGauge` (@/components/charts)
//    • `RegenStatTile`      ← web `WidgetGaugeHero` stat (label over value)
//    • `RegenFreshnessChip` / `RegenRefreshButton` ← web `WidgetShell` freshness + refresh affordances
//  All tokens come from the SI design system (P1/S9); no web Tailwind is ported.
//

import SwiftUI

// MARK: - Recovery gauge (web `RadialGauge`)

/// A radial recovery gauge — the Apple-idiomatic counterpart of the web `RadialGauge` SVG ring used by
/// `WidgetGaugeHero`. Draws a track + a value arc starting at 12 o'clock, the centered `nn%` readout (web
/// `label`), and the "recovery" caption below (web `unit`). The arc animates on change unless Reduce Motion
/// is on.
struct RegenGaugeRing: View {
    let fraction: Double
    let percentText: String
    let captionText: String
    let tint: Color
    var diameter: CGFloat = 104

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var lineWidth: CGFloat {
        max(6, diameter * 0.08)
    }

    private var clampedFraction: Double {
        min(max(fraction, 0), 1)
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ZStack {
                Circle()
                    .stroke(Color.TS.border.opacity(0.6), style: StrokeStyle(lineWidth: lineWidth))
                Circle()
                    .trim(from: 0, to: clampedFraction)
                    .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration),
                        value: clampedFraction
                    )
                Text(verbatim: percentText)
                    .font(Font.TS.section)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .padding(.horizontal, lineWidth)
            }
            .frame(width: diameter, height: diameter)

            Text(verbatim: captionText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: captionText))
        .accessibilityValue(Text(verbatim: percentText))
    }
}

// MARK: - Stat (web `WidgetGaugeHero` stat)

/// A centered label-over-value stat — the native counterpart of one `WidgetGaugeHero` stat. The value string
/// already carries its unit (web `formatEnergy`/`formatPower`/`fmtInt` output); falls back to an em dash via
/// the projection.
struct RegenStatTile: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .multilineTextAlignment(.center)
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label) \(value)"))
    }
}

// MARK: - Freshness chip (web `WidgetShell` → `DataFreshness`)

/// The live/stale/offline freshness indicator shown in the widget header — the native counterpart of the web
/// `DataFreshness` chip. Shows a tinted dot, a status label, and an optional relative-time caption, and swaps
/// the dot for a spinner while a background refresh is in flight.
struct RegenFreshnessChip: View {
    let connection: RegenEfficiencyWidgetConnection
    let isFetching: Bool
    let updatedAt: Date?
    var showsLabel = true

    var body: some View {
        HStack(spacing: 4) {
            if isFetching {
                ProgressView()
                    .controlSize(.mini)
            } else {
                Circle()
                    .fill(tone)
                    .frame(width: 6, height: 6)
            }
            if showsLabel {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                if let relative = relativeText {
                    Text(verbatim: "· \(relative)")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityValue))
    }

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: RegenEfficiencyStrings.string("widget.regenEfficiency.live", "Live")
        case .stale: RegenEfficiencyStrings.string("widget.regenEfficiency.stale", "Stale")
        case .offline: RegenEfficiencyStrings.string("widget.regenEfficiency.offline", "Offline")
        }
    }

    private var relativeText: String? {
        guard let updatedAt, updatedAt.timeIntervalSince1970 > 0 else { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: updatedAt, relativeTo: Date())
    }

    private var accessibilityValue: String {
        if isFetching {
            return RegenEfficiencyStrings.string("widget.regenEfficiency.updating", "Updating")
        }
        if let relative = relativeText {
            return "\(label), \(relative)"
        }
        return label
    }
}

/// The header refresh control (web `WidgetShell` refresh affordance). Disabled while a refresh is running.
struct RegenRefreshButton: View {
    let isFetching: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .disabled(isFetching)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(RegenEfficiencyStrings.text("widget.regenEfficiency.refresh", "Refresh"))
    }
}
