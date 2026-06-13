import SwiftUI

// Presentational subviews for `AutomationActivityFeedPage`: the connection chip (web
// "Live" / "Reconnecting"), the header stats summary, the live SSE row (web `LiveEventRow`),
// and the history row (web `HistoryRow`). The web Tailwind palette (green/amber/red/cyan/
// blue/purple/muted) maps to the P2 design tokens. Every visible string resolves from
// `Localizable.xcstrings`; no networking, no hand-rolled glass.

// MARK: - Status → SF Symbol + tint (web `statusConfig`)

extension AutomationActivityRunStatus {
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

    /// The tint mirroring the web Tailwind color for each status.
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

extension AutomationActivityEventKind {
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

    /// The tint mirroring the web Tailwind color for each live-event kind.
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

// MARK: - Connection chip (web "Live" / "Reconnecting")

/// The header connection chip reflecting the bound `connectionState`.
struct AutomationActivityConnectionChip: View {
    let connection: AutomationActivityConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: connection == .connected ? "wifi" : "wifi.slash")
                .font(.system(size: 11, weight: .semibold))
            Text(labelKey)
                .font(Font.TS.caption)
        }
        .foregroundStyle(connection == .connected ? Color.TS.statusSuccess : Color.TS.statusWarning)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(labelKey))
    }

    private var labelKey: LocalizedStringKey {
        connection == .connected ? "automations.live" : "automations.reconnecting"
    }
}

// MARK: - Stats summary (web header: total · success · avg)

/// The header stats summary (web `{total} total · {rate} success · {avg} avg`), shown only
/// when there is at least one execution.
struct AutomationActivityStatsRow: View {
    let stats: AutomationActivityStats

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            metric(value: "\(stats.totalRuns)", labelKey: "automations.totalRuns", tone: Color.TS.textSecondary)
            metric(value: stats.successRateText(), labelKey: "automations.successRate", tone: Color.TS.statusSuccess)
            metric(value: stats.avgDurationText, labelKey: "automations.avgDuration", tone: Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func metric(value: String, labelKey: LocalizedStringKey, tone: Color) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: value)
            Text(labelKey)
        }
        .font(Font.TS.caption)
        .foregroundStyle(tone)
        .lineLimit(1)
    }
}

// MARK: - Live-event row (web `LiveEventRow`)

/// One live SSE row (web `LiveEventRow`): a kind icon, the automation name, an optional
/// error / reason line, and the neutral kind badge, on a faint accent background.
struct AutomationActivityLiveRow: View {
    let event: AutomationActivityLiveEvent

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: event.kind.symbolName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(event.kind.tint)
                .accessibilityHidden(true)
            textColumn
            Spacer(minLength: TSSpacing.sm)
            badge
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.accent.opacity(0.05),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilityValue))
    }

    private var textColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: event.name)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            if let error = event.error {
                detail(error, tone: Color.TS.statusDanger)
            } else if let reason = event.reason {
                detail(reason, tone: Color.TS.textMuted)
            }
        }
    }

    private func detail(_ text: String, tone: Color) -> some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(tone)
            .lineLimit(1)
    }

    private var badge: some View {
        Text(verbatim: event.kind.badgeSuffix)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.textMuted.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.textMuted.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }

    private var accessibilityValue: String {
        var parts = [event.name, event.kind.badgeSuffix]
        if let error = event.error { parts.append(error) }
        if let reason = event.reason { parts.append(reason) }
        return parts.joined(separator: ", ")
    }
}

// MARK: - History row (web `HistoryRow`)

/// One execution-history row (web `HistoryRow`): a status icon, the automation name, an
/// optional error, and the trailing time-ago / duration / actions metadata.
struct AutomationActivityRunRow: View {
    let run: AutomationActivityRun

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: run.status.symbolName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(run.status.tint)
                .accessibilityHidden(true)
            nameColumn
            Spacer(minLength: TSSpacing.sm)
            meta(timeText)
            meta(run.durationText)
            if let actions = run.actionsText {
                meta(actions)
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilityValue))
    }

    private var nameColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: run.name)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            if let error = run.error {
                Text(verbatim: error)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .lineLimit(1)
            }
        }
    }

    private func meta(_ value: String) -> some View {
        Text(verbatim: value)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
    }

    private var timeText: String {
        guard let date = run.triggeredAt else { return AutomationActivityFormat.dash }
        return AutomationActivityFormat.relative(for: date)
    }

    private var accessibilityValue: String {
        var parts = [run.name, String(localized: String.LocalizationValue(run.status.labelKey))]
        parts.append(timeText)
        parts.append(run.durationText)
        if let actions = run.actionsText { parts.append(actions) }
        if let error = run.error { parts.append(error) }
        return parts.joined(separator: ", ")
    }
}
