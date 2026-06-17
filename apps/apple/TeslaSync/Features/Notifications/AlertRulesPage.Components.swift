//
//  AlertRulesPage.Components.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/AlertRules (Apple) — Cell components
//
//  The leaf views the rules table composes: the severity chip (web `SeverityBadge`),
//  the enabled/disabled status badge (web `Badge variant="success|neutral"`), and the
//  edit-lease conflict banner (web `EditConflictBanner`). All chrome is built from the
//  P3 component library + design tokens (P2); every label resolves from the catalog.
//

import SwiftUI

// MARK: - Severity visual mapping (web `severityTokens` / `SeverityBadge`)

extension AlertRuleSeverity {
    /// Semantic tone the badge tints with (web `severityTokens[sev]` palette).
    var tone: TSTone {
        switch self {
        case .info: .info
        case .warn: .warning
        case .critical: .danger
        }
    }

    /// SF Symbol mirroring the web lucide icon (`Info` / `AlertTriangle` / `AlertOctagon`).
    var systemImage: String {
        switch self {
        case .info: "info.circle.fill"
        case .warn: "exclamationmark.triangle.fill"
        case .critical: "exclamationmark.octagon.fill"
        }
    }
}

// MARK: - Severity badge (web `SeverityBadge`)

/// Icon + canonical severity name in a tinted capsule (web `SeverityBadge` renders
/// `<Icon /> {sev}`). The label is the wire token (`info` / `warn` / `critical`),
/// shown verbatim like the web component's default child.
struct AlertRuleSeverityBadge: View {
    let severity: AlertRuleSeverity

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: severity.systemImage)
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: severity.rawValue)
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(severity.tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(severity.tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(severity.tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: severity.rawValue))
    }
}

// MARK: - Status badge (web `Badge variant="success|neutral"`)

/// Enabled / disabled pill (web `r.enabled ? <Badge success> : <Badge neutral>`).
struct AlertRuleStatusBadge: View {
    let enabled: Bool

    var body: some View {
        if enabled {
            TSBadge(ARStrings.key("common.enabled"), tone: .success)
        } else {
            TSBadge(ARStrings.key("common.disabled"), tone: .neutral)
        }
    }
}

// MARK: - Edit-conflict banner (web `EditConflictBanner`)

/// Warning banner shown when another session holds the `alert-rules/list` edit
/// lease (web `EditConflictBanner` with `resourceLabel`). The required parity
/// string `editConflict.resource.alertRules` is the resource label interpolated
/// into the body; "tab" is adapted to "session" for the native HIG context.
struct AlertRulesEditConflictBanner: View {
    private var resourceLabel: String {
        ARStrings.text("editConflict.resource.alertRules", "Your alert rules")
    }

    private var title: String {
        ARStrings.text("editConflict.banner.title", "Another session is editing this")
    }

    private var messageText: String {
        let template = ARStrings.text(
            "editConflict.banner.bodyWithLabel",
            "%1$@ is open in another session. Saving here will overwrite changes made there."
        )
        return String(format: template, resourceLabel)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: messageText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusWarning.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
