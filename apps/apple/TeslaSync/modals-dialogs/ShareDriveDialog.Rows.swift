//
//  ShareDriveDialog.Rows.swift
//  TeslaSync — P4 modal / dialog · 0028 · ShareDriveDialog (Apple)
//
//  The "Active Share Links" section and its leaf row (split from the chrome for the lint file-length
//  budget): the section title (web `h3 "Active Share Links"`), the phase switch (loading / empty /
//  error+retry / the rows) with the inline reload / revoke error above it, and one share-link row (web
//  `GlassPanel`): the title (or "Untitled share"), the view tally + expiry status, and the trailing
//  copy + revoke actions. Binds through `ShareDriveModel` (P1/S8); all copy resolves through P1/S10.
//

import SwiftUI

// MARK: - Section (web existing-shares block)

/// The "Active Share Links" section: the title, any inline reload / revoke error, and the resolved
/// links phase (web `sharesLoading` spinner / the `shares.map` rows, widened with empty + error).
struct ShareDriveLinksSection: View {
    @Bindable var model: ShareDriveModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: model.localize("share.existing", "Active Share Links"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let inline = model.inlineLoadError {
                ShareDriveInlineError(message: inline)
            }
            if let action = model.actionError {
                ShareDriveInlineError(message: action)
            }
            phaseBody
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var phaseBody: some View {
        switch model.linksPhase {
        case .loading:
            ShareDriveLinksLoadingState()
        case .empty:
            ShareDriveLinksEmptyState()
        case let .error(message):
            ShareDriveLinksErrorState(message: message) { model.refresh() }
        case .content:
            VStack(spacing: TSSpacing.sm) {
                ForEach(model.rows) { row in
                    ShareDriveLinkRow(model: model, row: row)
                }
            }
        }
    }
}

// MARK: - Row (web `GlassPanel` per share)

/// One existing share-link row (web `GlassPanel`): the title / "Untitled share", the view tally +
/// expiry status, and the trailing copy + revoke actions.
struct ShareDriveLinkRow: View {
    @Bindable var model: ShareDriveModel
    let row: ShareLinkRow

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            summary
            Spacer(minLength: TSSpacing.sm)
            actions
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.surfaceGlass.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: model.rowTitle(row))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            HStack(spacing: TSSpacing.md) {
                HStack(spacing: 4) {
                    Image(systemName: "eye")
                        .font(.system(size: 11, weight: .semibold))
                        .accessibilityHidden(true)
                    Text(verbatim: model.viewsText(row.views))
                }
                Text(verbatim: model.expiryText(row.expiry))
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: model.rowAccessibilityLabel(row)))
    }

    private var actions: some View {
        HStack(spacing: TSSpacing.xs) {
            ShareDriveRowCopyButton(
                label: model.localize("share.copyLink", "Copy link"),
                onCopy: { model.copyRowURL(row.token) }
            )
            ShareDriveRowRevokeButton(
                label: model.localize("share.revoke", "Revoke"),
                isRevoking: model.isRevoking(row.token),
                onRevoke: { model.revoke(row.token) }
            )
        }
    }
}

// MARK: - Row copy (web row `CopyButton` iconOnly)

/// The row's icon-only copy button with a transient confirmation (web `CopyButton variant="ghost"
/// size="sm" iconOnly`). The copy runs through the injected model command (clipboard seam).
struct ShareDriveRowCopyButton: View {
    let label: String
    let onCopy: () -> Void
    @State private var didCopy = false

    var body: some View {
        Button(action: copy) {
            Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(didCopy ? Color.TS.statusSuccess : Color.TS.textMuted)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }

    private func copy() {
        onCopy()
        didCopy = true
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            didCopy = false
        }
    }
}

// MARK: - Row revoke (web row revoke `Button` with `Trash2`)

/// The row's icon-only revoke button (web `Button variant="ghost" size="sm"` with the red `Trash2`),
/// showing a spinner while the revoke is in flight.
struct ShareDriveRowRevokeButton: View {
    let label: String
    let isRevoking: Bool
    let onRevoke: () -> Void

    var body: some View {
        Button(action: onRevoke) {
            ZStack {
                if isRevoking {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: "trash")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.TS.statusDanger)
                }
            }
            .frame(width: 30, height: 30)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isRevoking)
        .accessibilityLabel(Text(verbatim: label))
    }
}
