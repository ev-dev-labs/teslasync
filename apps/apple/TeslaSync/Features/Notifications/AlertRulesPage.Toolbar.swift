//
//  AlertRulesPage.Toolbar.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/AlertRules (Apple) — Bulk toolbar
//
//  The bulk-action toolbar (web `BulkActionToolbar`): the pluralized selection
//  count, Enable / Disable / Delete actions, a destructive-delete confirmation, and
//  Clear. Shown only while a selection exists (web returns null at `count === 0`).
//  Built from the P3 `TSButton` + tokens; every label resolves from the catalog.
//

import SwiftUI

struct AlertRulesBulkToolbar: View {
    let model: AlertRulesPageModel

    @State private var confirmingDelete = false

    private var count: Int { model.selectedCount }

    /// Web count label `{{count}} {noun}` (e.g. "3 rules"); a bulk toolbar implies
    /// "selected", surfaced verbatim to VoiceOver below.
    private var summary: String {
        "\(count) \(ARStrings.noun(count))"
    }

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: summary)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityLabel(Text(verbatim: ARStrings.text(
                    "bulk.toolbarLabel", "Bulk actions for selected items"
                )))

            Spacer(minLength: TSSpacing.sm)

            enableButton
            disableButton
            deleteButton
            clearButton
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.accent.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .confirmationDialog(
            Text(verbatim: ARStrings.text("alertRules.bulk.deleteConfirm.title", "Delete alert rules?")),
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await model.bulkDelete() }
            } label: {
                Text(verbatim: ARStrings.text("common.delete", "Delete"))
            }
            Button(role: .cancel) {} label: {
                Text(verbatim: ARStrings.text("common.cancel", "Cancel"))
            }
        } message: {
            Text(verbatim: ARStrings.text(
                "alertRules.bulk.deleteConfirm.body",
                "These rules will stop firing immediately. This cannot be undone."
            ))
        }
    }

    // MARK: - Actions (web toolbar `actions`)

    private var enableButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { Task { await model.bulkEnable() } },
            label: { actionLabel("alertRules.bulk.enable", "Enable", systemImage: "play.fill") }
        )
    }

    private var disableButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { Task { await model.bulkDisable() } },
            label: { actionLabel("alertRules.bulk.disable", "Disable", systemImage: "pause.fill") }
        )
    }

    private var deleteButton: some View {
        TSButton(
            variant: .destructive,
            size: .small,
            action: { confirmingDelete = true },
            label: { actionLabel("alertRules.bulk.delete", "Delete", systemImage: "trash") }
        )
    }

    private var clearButton: some View {
        Button { model.clearSelection() } label: {
            Text(ARStrings.key("bulk.clear"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
    }

    private func actionLabel(_ key: String, _ fallback: String, systemImage: String) -> some View {
        Label {
            Text(verbatim: ARStrings.text(key, fallback))
        } icon: {
            Image(systemName: systemImage)
        }
    }
}
