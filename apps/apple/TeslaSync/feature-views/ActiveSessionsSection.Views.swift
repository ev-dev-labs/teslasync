//
//  ActiveSessionsSection.Views.swift
//  TeslaSync — P4 feature view · 0197 · ActiveSessionsSection (Apple)
//
//  The populated content orchestrator + the section header (icon chip, title,
//  subtitle, freshness chip, and the "Sign out all other devices" action) composed by
//  `ActiveSessionsSection`. All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9). No networking and no web Tailwind ports live here.
//

import SwiftUI

// MARK: - Content (web forward-auth branch: header + inline error + table)

/// The populated body shown for `.content` / `.empty`: the section header, the inline
/// list-error (when a reload failed while rows remain), and the device rows — or the
/// empty state when no sessions exist (web `DataTable` `emptyMessage`).
struct ActiveSessionsContent: View {
    @Bindable var model: ActiveSessionsModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ActiveSessionsHeader(model: model)
            if let message = model.inlineErrorMessage {
                ActiveSessionsInlineError(message: message)
            }
            if model.items.isEmpty {
                ActiveSessionsEmptyState()
            } else {
                ActiveSessionsRows(model: model)
            }
        }
    }
}

// MARK: - Header (web IconBox + Heading + HelperText + revoke-all button)

/// The section header: the laptop glyph chip, the title + freshness chip, the
/// subtitle, and the trailing "Sign out all other devices" button (web header row).
struct ActiveSessionsHeader: View {
    @Bindable var model: ActiveSessionsModel

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            titleBlock
            Spacer(minLength: TSSpacing.sm)
            if model.hasOtherDevices {
                ActiveSessionsRevokeAllButton(model: model)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "laptopcomputer")
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 40, height: 40)
            .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                ActiveSessionsStrings.text("sessions.title", "Active sessions")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                ActiveSessionsFreshnessChip(connection: model.connection)
            }
            ActiveSessionsStrings.text("sessions.subtitle", Self.subtitleFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private static let subtitleFallback =
        "Devices currently signed in to TeslaSync. Revoking a session signs that browser out on its "
            + "next request — your upstream identity provider's session is unaffected."
}

// MARK: - Revoke-all button (web secondary "Sign out all other devices")

/// The trailing destructive-secondary button that opens the all-others confirm, busy
/// while the bulk mutation is in flight (web `revokeAllOthersMut.isPending`).
struct ActiveSessionsRevokeAllButton: View {
    @Bindable var model: ActiveSessionsModel

    var body: some View {
        Button { model.requestRevokeAllOthers() } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "exclamationmark.shield").font(.system(size: 12, weight: .semibold))
                Text(verbatim: label).font(Font.TS.caption).fontWeight(.semibold)
            }
            .foregroundStyle(Color.TS.statusDanger)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.statusDanger.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.statusDanger.opacity(0.25), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(model.isRevokingAllOthers)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var label: String {
        model.isRevokingAllOthers
            ? ActiveSessionsStrings.string("sessions.revokeAllOthersBusy", "Signing out…")
            : ActiveSessionsStrings.string("sessions.revokeAllOthers", "Sign out all other devices")
    }
}

// MARK: - Rows list (web `DataTable` body → StaggerContainer of device cards)

/// The staggered list of device rows (web `DataTable` rows over the sessions).
struct ActiveSessionsRows: View {
    @Bindable var model: ActiveSessionsModel

    var body: some View {
        TSStaggerContainer(spacing: TSSpacing.md) {
            ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                TSStaggerItem(index: index) {
                    ActiveSessionRow(model: model, item: item)
                }
            }
        }
    }
}

// MARK: - Localization Text helper

extension ActiveSessionsStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values
    /// are never re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
