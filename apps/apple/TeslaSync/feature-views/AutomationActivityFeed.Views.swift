//
//  AutomationActivityFeed.Views.swift
//  TeslaSync — P4 feature view · 0081 · AutomationActivityFeed (Apple)
//
//  The presentational subviews composed by `AutomationActivityFeed`: the connection chip
//  (web "Live" / "Reconnecting" + the native "Stale" / "Offline"), the stats summary, the
//  live-event row (web `LiveEventRow`), the history row (web `HistoryRow`), the cached-data
//  banner, and the loading / empty / error states. All consume pre-localized strings from
//  the P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports. The
//  web tailwind colors (green/amber/red/cyan/blue/purple/muted) map to the design tokens.
//

import SwiftUI

// MARK: - Status → SF Symbol + tint (web `statusConfig`)

extension AutomationRunStatus {
    /// The SF Symbol mirroring the web lucide icon for each status.
    var symbolName: String {
        switch self {
        case .success: "checkmark.circle.fill" // web CheckCircle
        case .partial: "checkmark.circle.fill" // web CheckCircle
        case .failed: "xmark.circle.fill" // web XCircle
        case .skipped: "forward.end.fill" // web SkipForward
        case .test: "bolt.fill" // web Zap
        case .undo: "clock.fill" // web Clock
        case .running: "waveform.path.ecg" // web Activity
        case .cancelled: "xmark.circle.fill" // web XCircle
        }
    }

    /// The tint mirroring the web tailwind color for each status.
    var tint: Color {
        switch self {
        case .success: Color.TS.statusSuccess // web green-400
        case .partial: Color.TS.statusWarning // web amber-400
        case .failed: Color.TS.statusDanger // web red-400
        case .skipped: Color.TS.textMuted // web text-muted
        case .test: Color.TS.accent // web neon-cyan
        case .undo: Color.TS.chartSeriesPower // web purple-400
        case .running: Color.TS.chartSeriesSpeed // web blue-400
        case .cancelled: Color.TS.textMuted // web text-muted
        }
    }
}

// MARK: - Event kind → SF Symbol + tint (web `typeMap`)

extension AutomationEventKind {
    /// The SF Symbol mirroring the web lucide icon for each live-event kind.
    var symbolName: String {
        switch self {
        case .triggered: "bolt.fill" // web Zap
        case .succeeded: "checkmark.circle.fill" // web CheckCircle
        case .failed: "xmark.circle.fill" // web XCircle
        case .skipped: "forward.end.fill" // web SkipForward
        case .stateChanged: "waveform.path.ecg" // web Activity
        }
    }

    /// The tint mirroring the web tailwind color for each live-event kind.
    var tint: Color {
        switch self {
        case .triggered: Color.TS.accent // web neon-cyan
        case .succeeded: Color.TS.statusSuccess // web green-400
        case .failed: Color.TS.statusDanger // web red-400
        case .skipped: Color.TS.textMuted // web text-muted
        case .stateChanged: Color.TS.chartSeriesPower // web purple-400
        }
    }
}

// MARK: - Pulse (web `animate-pulse`)

/// A gentle opacity pulse mirroring the web `animate-pulse`, disabled under Reduce Motion.
private struct AutomationPulse: ViewModifier {
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    func body(content: Content) -> some View {
        content
            .opacity(active && pulsing && !reduceMotion ? 0.5 : 1)
            .onAppear { animate() }
            .onChange(of: active) { _, _ in animate() }
    }

    private func animate() {
        pulsing = false
        guard active, !reduceMotion else { return }
        withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
            pulsing = true
        }
    }
}

extension View {
    func automationPulse(_ active: Bool) -> some View {
        modifier(AutomationPulse(active: active))
    }
}

// MARK: - Connection chip (web "Live" / "Reconnecting" + native "Stale" / "Offline")

/// The header connection chip reflecting the bound source's live-state — the web
/// connected/reconnecting indicator extended with the native stale/offline P4 states.
struct AutomationConnectionChip: View {
    let connection: AutomationFeedConnection

    private struct Descriptor {
        let symbol: String
        let tone: Color
        let key: String
        let fallback: String
        let pulses: Bool
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        let label = AutomationFeedStrings.string(descriptor.key, descriptor.fallback)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: descriptor.symbol)
                .font(.system(size: 11, weight: .semibold))
                .automationPulse(descriptor.pulses)
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(descriptor.tone)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private static func descriptor(for connection: AutomationFeedConnection) -> Descriptor {
        switch connection {
        case .connected:
            Descriptor(
                symbol: "wifi", tone: Color.TS.statusSuccess,
                key: "automations.live", fallback: "Live", pulses: false
            )
        case .reconnecting:
            Descriptor(
                symbol: "wifi.slash", tone: Color.TS.statusWarning,
                key: "automations.reconnecting", fallback: "Reconnecting", pulses: true
            )
        case .stale:
            Descriptor(
                symbol: "clock.arrow.circlepath", tone: Color.TS.statusWarning,
                key: "automations.stale", fallback: "Stale", pulses: false
            )
        case .offline:
            Descriptor(
                symbol: "wifi.slash", tone: Color.TS.textMuted,
                key: "automations.offline", fallback: "Offline", pulses: false
            )
        }
    }
}

// MARK: - Stats summary (web header: total · success · avg)

/// The header stats summary (web `{total} total · {rate} success · {avg} avg`), shown only
/// when there is at least one execution.
struct AutomationStatsRow: View {
    let stats: AutomationFeedStats

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            metric(
                value: "\(stats.totalExecutions)",
                key: "automations.totalRuns", fallback: "total",
                tone: Color.TS.textSecondary
            )
            metric(
                value: stats.successRateText,
                key: "automations.successRate", fallback: "success",
                tone: Color.TS.statusSuccess
            )
            metric(
                value: stats.avgDurationText,
                key: "automations.avgDuration", fallback: "avg",
                tone: Color.TS.textSecondary
            )
        }
        .accessibilityElement(children: .combine)
    }

    private func metric(value: String, key: String, fallback: String, tone: Color) -> some View {
        let label = AutomationFeedStrings.string(key, fallback)
        return Text(verbatim: "\(value) \(label)")
            .font(Font.TS.caption)
            .foregroundStyle(tone)
            .lineLimit(1)
    }
}

// MARK: - Neutral badge (web `Badge variant="neutral"`, runtime text)

/// A neutral tinted capsule taking a runtime string the `LocalizedStringKey`-only `TSBadge`
/// cannot express — the web live-event kind badge.
struct AutomationNeutralBadge: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.textMuted.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.textMuted.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}
