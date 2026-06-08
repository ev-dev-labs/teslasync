//
//  InboxBody.Toolbar.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  The bulk-actions toolbar (web `BulkActionsToolbar`): the selected-count label
//  with the pluralized noun (web `itemNoun`), a clear-selection control, and one
//  button per bulk action (mark read / archive / restore / delete). The
//  destructive delete routes through a confirmation dialog mirroring the web
//  `confirm: { title, description, confirmLabel }`. Shown only when the selection
//  is non-empty. Strings come from the P1/S10 facade.
//

import SwiftUI

struct InboxBulkActionsToolbar: View {
    @Bindable var model: InboxBodyModel
    @State private var pendingConfirm: InboxBulkAction?

    private var count: Int {
        model.selection.count
    }

    private var noun: String {
        count == 1
            ? model.localize("bulk.noun.notification_one", "notification")
            : model.localize("bulk.noun.notification_other", "notifications")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: "\(count) \(noun)")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            clearButton
            Spacer(minLength: TSSpacing.sm)
            ForEach(model.bulkActions) { action in
                actionButton(action)
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.accent.opacity(0.2), lineWidth: 1)
        )
        .confirmationDialog(
            Text(verbatim: confirmTitle),
            isPresented: confirmBinding,
            titleVisibility: .visible,
            presenting: pendingConfirm
        ) { action in
            confirmActions(for: action)
        } message: { action in
            if let confirm = action.confirm {
                Text(verbatim: model.localize(confirm.bodyKey, confirm.bodyFallback))
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var clearButton: some View {
        Button {
            model.clearSelection()
        } label: {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 14))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.localize("bulk.clearSelection", "Clear selection")))
    }

    private func actionButton(_ action: InboxBulkAction) -> some View {
        Button {
            if action.confirm != nil {
                pendingConfirm = action
            } else {
                Task { await model.performBulk(action) }
            }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: action.systemImage)
                    .font(.system(size: 12, weight: .semibold))
                Text(verbatim: model.localize(action.labelKey, action.labelFallback))
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
            }
            .foregroundStyle(action.destructive ? Color.TS.statusDanger : Color.TS.textSecondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.localize(action.labelKey, action.labelFallback)))
    }

    @ViewBuilder
    private func confirmActions(for action: InboxBulkAction) -> some View {
        if let confirm = action.confirm {
            Button(role: .destructive) {
                Task { await model.performBulk(action) }
            } label: {
                Text(verbatim: model.localize(confirm.confirmKey, confirm.confirmFallback))
            }
        }
        Button(role: .cancel) {
            pendingConfirm = nil
        } label: {
            Text(verbatim: model.localize("common.cancel", "Cancel"))
        }
    }

    private var confirmBinding: Binding<Bool> {
        Binding(get: { pendingConfirm != nil }, set: { if !$0 { pendingConfirm = nil } })
    }

    private var confirmTitle: String {
        guard let confirm = pendingConfirm?.confirm else { return "" }
        return model.localize(confirm.titleKey, confirm.titleFallback)
    }
}
