//
//  MotorPerformanceWidget.Components.swift
//  TeslaSync — P4 dashboard widget · 0067 · MotorPerformanceWidget (Apple)
//
//  The native subviews that map the web shared components onto Apple-idiomatic primitives:
//    • `MotorTorqueGauge`  ← web `RadialGauge` (@/components/charts)
//    • `MotorStatTile`     ← web `StatCard`    (@/components/data-display)
//    • `MotorFreshnessChip` / `MotorRefreshButton` ← web `WidgetShell` freshness + refresh affordances
//  All tokens come from the SI design system (P1/S9); no web Tailwind is ported.
//

import SwiftUI

// MARK: - Torque gauge (web `RadialGauge`)

/// A radial progress gauge for torque — the Apple-idiomatic counterpart of the web `RadialGauge` SVG ring.
/// Draws a track + a value arc starting at 12 o'clock, with a centered magnitude readout and a caption
/// below. The arc fill animates on change unless Reduce Motion is on.
struct MotorTorqueGauge: View {
    let fraction: Double
    let valueText: String
    let unit: String
    let captionText: String
    let tint: Color
    var diameter: CGFloat = 100

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
                centerReadout
            }
            .frame(width: diameter, height: diameter)

            Text(verbatim: captionText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(captionText) \(unit)"))
    }

    private var centerReadout: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(verbatim: valueText)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: unit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .padding(.horizontal, lineWidth)
    }
}

// MARK: - Stat tile (web `StatCard`)

/// A compact metric tile — the native counterpart of the web `StatCard`. Renders a muted uppercase label
/// over a value with an optional unit suffix; the value falls back to an em dash when absent.
struct MotorStatTile: View {
    let label: String
    let value: String
    var unit: String?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.5)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(verbatim: value)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                if let unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label) \(value)\(unit.map { " \($0)" } ?? "")"))
    }
}

// MARK: - Freshness chip (web `WidgetShell` → `DataFreshness`)

/// The live/stale/offline freshness indicator shown in the widget header — the native counterpart of the
/// web `DataFreshness` chip. Shows a tinted dot, a status label, and an optional relative-time caption,
/// and swaps the dot for a spinner while a background refresh is in flight.
struct MotorFreshnessChip: View {
    let connection: MotorPerformanceWidgetConnection
    let isFetching: Bool
    let updatedAt: Date?
    var showsLabel: Bool = true

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
        case .live: MotorPerformanceStrings.string("widget.motorPerformance.live", "Live")
        case .stale: MotorPerformanceStrings.string("widget.motorPerformance.stale", "Stale")
        case .offline: MotorPerformanceStrings.string("widget.motorPerformance.offline", "Offline")
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
            return MotorPerformanceStrings.string("widget.motorPerformance.updating", "Updating")
        }
        if let relative = relativeText {
            return "\(label), \(relative)"
        }
        return label
    }
}

/// The header refresh control (web `WidgetShell` refresh affordance). Disabled while a refresh is running.
struct MotorRefreshButton: View {
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
        .accessibilityLabel(MotorPerformanceStrings.text("widget.motorPerformance.refresh", "Refresh"))
    }
}
