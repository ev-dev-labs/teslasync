//
//  ScheduledExportsPanel.RowActions.swift
//  TeslaSync — P4 feature view · 0262 · ScheduledExportsPanel (Apple)
//
//  The per-row action cluster — the native parity of the web Actions cell (Run now /
//  Enable-Disable / Edit / Delete). Each web `<Button>` maps to a shared `TSButton`; the
//  run-now + toggle buttons surface their mutation's in-flight state (web
//  `runNow.isPending && runNow.variables === row.id`), and the whole cluster wraps to a
//  second line via `ViewThatFits` when it can't fit on one (compact widths / large Dynamic
//  Type). Bound through `ScheduledExportsModel`; copy via P1/S10.
//

import SwiftUI

/// The four per-row actions, laid out on one line when they fit and wrapped to two lines
/// otherwise. The buttons are defined once and reused across both arrangements (DRY).
struct ScheduledExportRowActions: View {
    @Bindable var model: ScheduledExportsModel
    let item: ScheduledExportItem

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: TSSpacing.xs) {
                runNowButton
                toggleButton
                editButton
                deleteButton
            }
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(spacing: TSSpacing.xs) {
                    runNowButton
                    toggleButton
                }
                HStack(spacing: TSSpacing.xs) {
                    editButton
                    deleteButton
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    // MARK: Buttons

    private var runNowButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            isLoading: model.isRunning(item.id),
            action: { Task { await model.runNow(item) } },
            label: { ScheduledExportsStrings.text("dataExport.scheduled.actions.runNow", "Run now") }
        )
        .accessibilityLabel(ScheduledExportsStrings.text("dataExport.scheduled.actions.runNow", "Run now"))
    }

    private var toggleButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            isLoading: model.isToggling(item.id),
            action: { Task { await model.toggleEnabled(item) } },
            label: { Text(verbatim: toggleLabel) }
        )
        .accessibilityLabel(Text(verbatim: toggleLabel))
    }

    private var editButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { model.startEdit(item) },
            label: { ScheduledExportsStrings.text("dataExport.scheduled.actions.edit", "Edit") }
        )
        .accessibilityLabel(ScheduledExportsStrings.text("dataExport.scheduled.actions.edit", "Edit"))
    }

    private var deleteButton: some View {
        TSButton(
            variant: .destructive,
            size: .small,
            action: { model.requestDelete(item) },
            label: { ScheduledExportsStrings.text("dataExport.scheduled.actions.delete", "Delete") }
        )
        .accessibilityLabel(deleteAccessibilityLabel)
    }

    // MARK: Labels

    /// Web `row.enabled ? 'Disable' : 'Enable'`.
    private var toggleLabel: String {
        item.enabled
            ? ScheduledExportsStrings.string("dataExport.scheduled.actions.disable", "Disable")
            : ScheduledExportsStrings.string("dataExport.scheduled.actions.enable", "Enable")
    }

    /// "Delete {{name}}" so VoiceOver users know which schedule the button targets.
    private var deleteAccessibilityLabel: Text {
        Text(verbatim: ScheduledExportsStrings.string(
            "dataExport.scheduled.actions.deleteAria", "Delete {{name}}", "{{name}}", item.name
        ))
    }
}
