//
//  SleepEfficiencyWidget.Components.swift
//  TeslaSync — P4 dashboard widget · 0090 · SleepEfficiencyWidget (Apple)
//
//  The native subviews that map the web shared components onto Apple-idiomatic primitives:
//    • `SleepGaugeRing`     ← web `WidgetGaugeHero` → `RadialGauge` (@/components/charts)
//    • `SleepStatTile`      ← web `WidgetGaugeHero` stat (label over value + unit span)
//    • `SleepFreshnessChip` / `SleepRefreshButton` ← web `WidgetShell` freshness + refresh affordances
//  All tokens come from the SI design system (P1/S9); no web Tailwind is ported.
//

import SwiftUI

// MARK: - Efficiency gauge (web `RadialGauge`)

/// A radial sleep-efficiency gauge — the Apple-idiomatic counterpart of the web `RadialGauge` SVG ring used
/// by `WidgetGaugeHero`. Draws a track + a value arc starting at 12 o'clock, the centered `nn%` readout (web
/// value + unit span), and the optional "Efficiency" caption below (web `label`, hidden when compact). The
/// arc animates on change unless Reduce Motion is on.
struct SleepGaugeRing: View {
    let fraction: Double
    let valueText: String
    let unitText: String
    /// The gauge label below the ring (web `label`); `nil` in the compact branch (web `label: ''`).
    var captionText: String?
    let tint: Color
    var diameter: CGFloat = 104

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var lineWidth: CGFloat {
        max(6, diameter * 0.08)
    }

    private var clampedFraction: Double {
        min(max(fraction, 0), 1)
    }

    private var readout: Text {
        Text(verbatim: valueText)
            .font(Font.TS.section)
            .fontWeight(.bold)
            .foregroundStyle(Color.TS.textPrimary)
            + Text(verbatim: unitText)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
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
                readout
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .padding(.horizontal, lineWidth)
            }
            .frame(width: diameter, height: diameter)

            if let captionText, !captionText.isEmpty {
                Text(verbatim: captionText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: captionText ?? ""))
        .accessibilityValue(Text(verbatim: "\(valueText)\(unitText)"))
    }
}

// MARK: - Stat (web `WidgetGaugeHero` stat)

/// A centered label-over-value stat — the native counterpart of one `WidgetGaugeHero` stat. The value is
/// shown prominently with the optional unit in a smaller, secondary span (web renders `{value}` then a
/// `text-xs` unit span with a small left margin).
struct SleepStatTile: View {
    let label: String
    let value: String
    var unit: String?

    private var valueText: Text {
        let base = Text(verbatim: value)
            .font(Font.TS.panel)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textPrimary)
        guard let unit, !unit.isEmpty else { return base }
        return base
            + Text(verbatim: "\u{2009}\(unit)")
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
    }

    private var accessibilityText: String {
        guard let unit, !unit.isEmpty else { return "\(label) \(value)" }
        return "\(label) \(value) \(unit)"
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .multilineTextAlignment(.center)
            valueText
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Freshness chip (web `WidgetShell` → `DataFreshness`)

/// The live/stale/offline freshness indicator shown in the widget header — the native counterpart of the web
/// `DataFreshness` chip. Shows a tinted dot, a status label, and an optional relative-time caption, and swaps
/// the dot for a spinner while a background refresh is in flight.
struct SleepFreshnessChip: View {
    let connection: SleepEfficiencyWidgetConnection
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
        case .live: SleepEfficiencyStrings.string("widget.sleepEfficiency.live", "Live")
        case .stale: SleepEfficiencyStrings.string("widget.sleepEfficiency.stale", "Stale")
        case .offline: SleepEfficiencyStrings.string("widget.sleepEfficiency.offline", "Offline")
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
            return SleepEfficiencyStrings.string("widget.sleepEfficiency.updating", "Updating")
        }
        if let relative = relativeText {
            return "\(label), \(relative)"
        }
        return label
    }
}

/// The header refresh control (web `WidgetShell` refresh affordance). Disabled while a refresh is running.
struct SleepRefreshButton: View {
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
        .accessibilityLabel(SleepEfficiencyStrings.text("widget.sleepEfficiency.refresh", "Refresh"))
    }
}
