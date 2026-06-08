//
//  LiveSignalSparklinesWidget.Row.swift
//  TeslaSync — P4 dashboard widget · 0057 · LiveSignalSparklinesWidget (Apple)
//
//  SignalSparklineRow (color bar + label/value + shared TSSparkline + trend glyph,
//  a port of the web row) and SignalFreshnessChip (the tappable freshness control,
//  a port of the web DataFreshness chip).
//

import SwiftUI

// MARK: - SignalSparklineRow (port of the web `SignalSparklineRow`)

/// One signal's row: a colored rail, the spaced name + current value, the shared
/// `TSSparkline` (or a "no data" fallback label), and a trend glyph. The row is
/// a single VoiceOver element speaking name + value + trend.
struct SignalSparklineRow: View {
    let row: SignalRowProjection
    var isWide = false
    var showsDivider = true

    private var sparklineWidth: CGFloat {
        isWide ? 80 : 56
    }

    private var color: Color {
        TSChartPalette.color(at: row.colorIndex)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            RoundedRectangle(cornerRadius: TSRadius.pill, style: .continuous)
                .fill(color)
                .frame(width: 3, height: 24)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: row.displayName)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: LiveSignalSparklinesBuilder.formatValue(row.currentValue))
                    .font(Font.TS.bodySm)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            sparkline
            trendIcon
        }
        .padding(.vertical, TSSpacing.xs)
        .overlay(alignment: .bottom) {
            if showsDivider {
                Rectangle().fill(Color.TS.border.opacity(0.4)).frame(height: 1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: LiveSignalSparklinesAccessibility.rowLabel(for: row)))
    }

    @ViewBuilder
    private var sparkline: some View {
        if row.hasSparkline {
            TSSparkline(values: row.points, colorIndex: row.colorIndex)
                .frame(width: sparklineWidth)
                .accessibilityHidden(true)
        } else {
            Text(verbatim: LiveSignalSparklinesStrings.string("widget.noHistory", "no data"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: sparklineWidth)
                .multilineTextAlignment(.center)
        }
    }

    private var trendIcon: some View {
        Image(systemName: trendSymbol)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(trendColor)
            .accessibilityHidden(true)
    }

    private var trendSymbol: String {
        switch row.trend {
        case .up: "arrow.up.right"
        case .down: "arrow.down.right"
        case .flat: "minus"
        }
    }

    private var trendColor: Color {
        switch row.trend {
        case .up: Color.TS.statusSuccess
        case .down: Color.TS.statusDanger
        case .flat: Color.TS.textMuted
        }
    }
}

// MARK: - SignalFreshnessChip (port of the web `DataFreshness` chip)

/// A tappable freshness chip: a status dot + connectivity glyph + relative-time /
/// status label. Tapping refreshes (the web chip is the refresh control). The
/// fetching glyph spins unless Reduce Motion is on.
struct SignalFreshnessChip: View {
    let freshness: SignalFreshness
    var updatedAt: Date?
    let onRefresh: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spin = false

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle()
                    .fill(tone)
                    .frame(width: 6, height: 6)
                Image(systemName: symbol)
                    .font(.system(size: 9, weight: .semibold))
                    .rotationEffect(.degrees(isSpinning ? 360 : 0))
                    .animation(spinAnimation, value: spin)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .monospacedDigit()
            }
            .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .onAppear { spin = freshness == .fetching }
        .onChange(of: freshness) { _, newValue in spin = newValue == .fetching }
        .accessibilityLabel(LiveSignalSparklinesStrings.text("widget.freshness.refresh", "Refresh"))
        .accessibilityValue(Text(verbatim: LiveSignalSparklinesAccessibility.freshnessLabel(freshness)))
    }

    private var isSpinning: Bool {
        freshness == .fetching && !reduceMotion && spin
    }

    private var spinAnimation: Animation? {
        reduceMotion ? nil : .linear(duration: 1).repeatForever(autoreverses: false)
    }

    private var tone: Color {
        switch freshness {
        case .fresh: Color.TS.statusSuccess
        case .fetching: Color.TS.statusInfo
        case .stale: Color.TS.statusWarning
        case .error: Color.TS.statusDanger
        case .offline: Color.TS.textMuted
        }
    }

    private var symbol: String {
        switch freshness {
        case .fresh, .stale: "wifi"
        case .fetching: "arrow.triangle.2.circlepath"
        case .error, .offline: "wifi.slash"
        }
    }

    private var label: String {
        switch freshness {
        case .fetching:
            return LiveSignalSparklinesStrings.string("widget.freshness.updating", "updating…")
        case .error:
            return LiveSignalSparklinesStrings.string("widget.freshness.errorShort", "error")
        case .offline:
            return LiveSignalSparklinesStrings.string("widget.freshness.offline", "Offline")
        case .fresh, .stale:
            if let updatedAt {
                return LiveSignalSparklinesBuilder.relativeTime(since: updatedAt)
            }
            return LiveSignalSparklinesAccessibility.freshnessLabel(freshness)
        }
    }
}
