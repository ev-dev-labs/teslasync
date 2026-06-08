//
//  ActiveSessionsSection.Row.swift
//  TeslaSync — P4 feature view · 0197 · ActiveSessionsSection (Apple)
//
//  One device row — the native parity of a web `DataTable` row over an `ActiveSession`
//  (the Device cell with its "This device" badge, the IP / Signed in / Last seen
//  cells, and the per-row "Sign out" action). Rendered as a card so the columns reflow
//  on compact widths instead of truncating. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Row (web table row)

/// A single signed-in device: the heuristic device label + a "This device" badge for
/// the current session, the IP / signed-in / last-seen metrics, and a destructive
/// "Sign out" button for every other device (web per-row `Button`, hidden for the
/// current row exactly like `row.current ? null : <Button>`).
struct ActiveSessionRow: View {
    @Bindable var model: ActiveSessionsModel
    let item: ActiveSessionItem

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            headerRow
            detailRows
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var headerRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "laptopcomputer")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            Text(verbatim: deviceLabel)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            if item.current {
                ActiveSessionsBadge(text: ActiveSessionsStrings.string("sessions.current", "This device"))
            }
            Spacer(minLength: TSSpacing.sm)
            if !item.current {
                signOutButton
            }
        }
    }

    private var detailRows: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ActiveSessionMetricLine(
                glyph: "network",
                label: ActiveSessionsStrings.string("sessions.columns.ip", "IP address"),
                value: item.ipDisplay
            )
            ActiveSessionMetricLine(
                glyph: "clock",
                label: ActiveSessionsStrings.string("sessions.columns.createdAt", "Signed in"),
                value: model.formatTimestamp(item.createdAt)
            )
            ActiveSessionMetricLine(
                glyph: "clock.arrow.circlepath",
                label: ActiveSessionsStrings.string("sessions.columns.lastSeenAt", "Last seen"),
                value: model.formatTimestamp(item.lastSeenAt)
            )
        }
        .accessibilityElement(children: .combine)
    }

    private var signOutButton: some View {
        Button { model.requestRevoke(item) } label: {
            HStack(spacing: TSSpacing.xs) {
                if model.isRevoking(item.id) {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                        .font(.system(size: 11, weight: .semibold))
                }
                ActiveSessionsStrings.text("sessions.row.revoke", "Sign out")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .foregroundStyle(Color.TS.statusDanger)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.statusDanger.opacity(0.10), in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(model.isRevoking(item.id))
        .accessibilityLabel(Text(verbatim: revokeAccessibilityLabel))
    }

    private var deviceLabel: String {
        item.deviceLabel(localize: model.localize)
    }

    private var revokeAccessibilityLabel: String {
        ActiveSessionsStrings.string("sessions.row.revokeAria", "Sign out {{device}}")
            .replacingOccurrences(of: "{{device}}", with: deviceLabel)
    }
}

// MARK: - "This device" badge (web `Badge variant="success"`)

/// The success-tinted pill marking the current session (web `<Badge variant="success">
/// This device</Badge>`).
struct ActiveSessionsBadge: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.statusSuccess)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.statusSuccess.opacity(0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.statusSuccess.opacity(0.25), lineWidth: 1))
    }
}

// MARK: - Metric line (web table cell: label + value)

/// One label/value metric line (a native reflow of a web `DataTable` cell): a muted
/// glyph + column label and the secondary-toned value.
struct ActiveSessionMetricLine: View {
    let glyph: String
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: glyph)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 14)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .monospacedDigit()
        }
    }
}
