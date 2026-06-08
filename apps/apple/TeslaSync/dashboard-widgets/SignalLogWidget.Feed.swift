//
//  SignalLogWidget.Feed.swift
//  TeslaSync — P4 dashboard widget · 0089 · SignalLogWidget (Apple)
//
//  The feed-row presentation (source chip + signal name/value + relative time),
//  the compact signals/sec big number, and the tappable freshness chip — the
//  SwiftUI ports of the web `WidgetEventFeed` row, `WidgetBigNumber`, and the
//  `DataFreshness` control. Tokens only; no hex literals leak from the projection.
//

import SwiftUI

// MARK: - Tone → token mapping

extension SignalLogTone {
    /// The `Color.TS` token for this semantic tone (token parity for the web
    /// `SOURCE_COLORS` hexes).
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .accent: Color.TS.accent
        case .warning: Color.TS.statusWarning
        case .muted: Color.TS.textMuted
        }
    }
}

// MARK: - SignalLogRow (port of the web `WidgetEventFeed` row)

/// One observation's row: the source chip, the spaced signal name + formatted
/// value, and a relative timestamp. The row is a single VoiceOver element speaking
/// name + value + source + time.
struct SignalLogRow: View {
    let row: SignalLogRowProjection
    var showsDivider = true

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            SignalSourceBadge(label: row.sourceLabel, tone: row.tone)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: row.title)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: row.value)
                    .font(Font.TS.bodySm)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: SignalLogBuilder.feedRelativeTime(since: row.timestamp))
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
        }
        .padding(.vertical, TSSpacing.xs)
        .overlay(alignment: .bottom) {
            if showsDivider {
                Rectangle().fill(Color.TS.border.opacity(0.4)).frame(height: 1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SignalLogAccessibility.rowLabel(for: row)))
    }
}

// MARK: - SignalSourceBadge (port of the web source `Badge`)

/// A small tone-tinted chip carrying the observation's provenance label (MQTT /
/// API / Manual / Cache). Decorative for VoiceOver — the row label already speaks
/// the source.
struct SignalSourceBadge: View {
    let label: String
    let tone: SignalLogTone

    var body: some View {
        Text(verbatim: label)
            .font(.system(size: 9, weight: .bold))
            .textCase(.uppercase)
            .tracking(0.4)
            .foregroundStyle(tone.color)
            .lineLimit(1)
            .frame(minWidth: 40)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 3)
            .background(tone.color.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.25), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - SignalLogBigNumber (port of the web `WidgetBigNumber`)

/// The compact (1-column) layout: the aggregate MQTT signals/sec as a large
/// number over its unit label. Speaks a combined value for VoiceOver.
struct SignalLogBigNumber: View {
    let rate: Int

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: String(rate))
                .font(Font.TS.display)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            SignalLogStrings.text("widget.signalLog.signalsPerSec", "signals/sec")
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SignalLogAccessibility.rateLabel(rate)))
    }
}

// MARK: - SignalLogFreshnessChip (port of the web `DataFreshness` chip)

/// A tappable freshness chip: a status dot + connectivity glyph + relative-time /
/// status label. Tapping refreshes (the web chip is the refresh control). The
/// fetching glyph spins unless Reduce Motion is on.
struct SignalLogFreshnessChip: View {
    let freshness: SignalLogFreshness
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
        .accessibilityLabel(SignalLogStrings.text("widget.signalLog.freshness.refresh", "Refresh"))
        .accessibilityValue(Text(verbatim: SignalLogAccessibility.freshnessLabel(freshness)))
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
            return SignalLogStrings.string("widget.signalLog.freshness.updating", "Updating…")
        case .error:
            return SignalLogStrings.string("widget.signalLog.freshness.errorShort", "error")
        case .offline:
            return SignalLogStrings.string("widget.signalLog.freshness.offline", "Offline")
        case .fresh, .stale:
            if let updatedAt {
                return SignalLogBuilder.feedRelativeTime(since: updatedAt)
            }
            return SignalLogAccessibility.freshnessLabel(freshness)
        }
    }
}
