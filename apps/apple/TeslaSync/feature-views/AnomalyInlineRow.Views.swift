//
//  AnomalyInlineRow.Views.swift
//  TeslaSync — P4 feature view · 0238 · AnomalyInlineRow (Apple)
//
//  The native `HealthRow` parity: the shared row shell (status dot · activity glyph ·
//  label · right-aligned summary · trailing chip / chevron) and the populated content
//  row composed by `AnomalyInlineRow`. All copy resolves through the P1/S10 facade; all
//  chrome is token-driven (P1/S9). No networking and no web Tailwind ports live here.
//

import SwiftUI

// MARK: - Surface chrome constants

/// SF Symbol parity for the web Lucide `Activity` glyph (the ECG zig-zag).
enum AnomalyInlineRowIcon {
    static let activity = "waveform.path.ecg"
}

// MARK: - Status → tint (web `DOT_FOR_STATUS` / `TEXT_FOR_STATUS`)

extension AnomalyHealthStatus {
    /// The status accent, mapping the web `bg-*`/`text-*` status colors onto the
    /// generated P1/S9 tokens so the dot + summary tint adapt across light / dark /
    /// increased-contrast appearances.
    var tint: Color {
        switch self {
        case .healthy: Color.TS.statusSuccess
        case .degraded: Color.TS.statusWarning
        case .unhealthy: Color.TS.statusDanger
        case .unknown: Color.TS.textMuted
        case .maintenance: Color.TS.statusInfo
        }
    }
}

// MARK: - Row shell (web `HealthRow` layout)

/// The shared one-line health-row layout — the native parity of the web `HealthRow`
/// inner composition: a status dot, the activity glyph, a truncating label that flexes
/// to fill, and a trailing slot (summary + chip + chevron, or a retry / loading chrome).
/// Min height 44pt mirrors the web `min-h-[44px]` touch target.
struct AnomalyRowShell<Trailing: View>: View {
    let dotColor: Color
    let label: String
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Circle()
                .fill(dotColor)
                .frame(width: 10, height: 10)
                .accessibilityHidden(true)
            Image(systemName: AnomalyInlineRowIcon.activity)
                .font(.system(size: 16, weight: .regular))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            trailing()
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.md)
        .frame(minHeight: 44)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass.opacity(0.0001),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }
}

// MARK: - Content row (web `<HealthRow status icon label summary to>`)

/// The populated row shown for `.content`: the status dot + activity glyph + label, the
/// status-tinted summary (with the freshness chip when the bound source is not live),
/// and the trailing chevron. The whole row is the click-through to the anomaly-detection
/// page (web `<HealthRow to="/anomaly-detection">`), driven through the model's
/// activation seam.
struct AnomalyInlineRowContentRow: View {
    let content: AnomalyInlineRowContent
    let connection: AnomalyInlineRowConnection
    let activate: () -> Void

    var body: some View {
        Button(action: activate) {
            AnomalyRowShell(dotColor: content.status.tint, label: rowLabel) {
                HStack(spacing: TSSpacing.sm) {
                    if connection != .live {
                        AnomalyInlineRowFreshnessChip(connection: connection)
                    }
                    Text(verbatim: content.summary)
                        .font(Font.TS.caption)
                        .foregroundStyle(content.status.tint)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityValue(Text(verbatim: statusWord))
        .accessibilityHint(AnomalyInlineRowStrings.text("anomaly.row.hint", "Opens anomaly detection"))
        .accessibilityAddTraits(.isButton)
    }

    private var rowLabel: String {
        AnomalyInlineRowStrings.string("anomaly.row.label", "Anomalies")
    }

    private var accessibilityLabel: String {
        AnomalyInlineRowAccessibility.rowLabel(summary: content.summary, localize: AnomalyInlineRowStrings.string)
    }

    private var statusWord: String {
        AnomalyInlineRowStrings.string(
            content.status.accessibilityStatusKey,
            content.status.accessibilityStatusFallback
        )
    }
}

// MARK: - Localization Text helper

extension AnomalyInlineRowStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values
    /// are never re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
