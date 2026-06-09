//
//  ScheduledExportsPanel.Actions.swift
//  TeslaSync — P4 feature view · 0262 · ScheduledExportsPanel (Apple)
//
//  The destructive delete confirmation — the native parity of the web `ConfirmDialog`
//  ("Delete schedule?" / "This will stop future runs of {{name}}."). Presented while the
//  model holds a `pendingDelete`; the message names the schedule. Deleting a schedule is
//  destructive (it stops all future runs), so it ALWAYS confirms. Bound through
//  `ScheduledExportsModel`; copy via P1/S10.
//

import SwiftUI

// MARK: - Delete confirm (web `ConfirmDialog variant="danger"`)

/// Confirms deleting one schedule. Presented while the model holds a `pendingDelete`; the
/// message interpolates the schedule name (web `{{name}}`).
private struct ScheduledExportDeleteConfirmation: ViewModifier {
    @Bindable var model: ScheduledExportsModel

    func body(content: Content) -> some View {
        content.confirmationDialog(
            Text(verbatim: ScheduledExportsStrings.string(
                "dataExport.scheduled.deleteConfirmTitle", "Delete schedule?"
            )),
            isPresented: presented,
            titleVisibility: .visible,
            presenting: model.pendingDelete
        ) { _ in
            Button(role: .destructive) {
                Task { await model.confirmDelete() }
            } label: {
                ScheduledExportsStrings.text("dataExport.scheduled.actions.delete", "Delete")
            }
            Button(role: .cancel) {
                model.cancelDelete()
            } label: {
                ScheduledExportsStrings.text("dataExport.scheduled.deleteConfirmCancel", "Cancel")
            }
        } message: { target in
            Text(verbatim: message(for: target))
        }
    }

    private var presented: Binding<Bool> {
        Binding(
            get: { model.pendingDelete != nil },
            set: { isPresented in if !isPresented { model.cancelDelete() } }
        )
    }

    private func message(for target: ScheduledExportItem) -> String {
        ScheduledExportsStrings.string(
            "dataExport.scheduled.deleteConfirmBody",
            "This will stop future runs of {{name}}.",
            "{{name}}",
            target.name
        )
    }
}

// MARK: - Composition

extension View {
    /// Attaches the delete confirmation bound through the model. Applied once by
    /// `ScheduledExportsPanel`.
    func scheduledExportsDeleteConfirmation(model: ScheduledExportsModel) -> some View {
        modifier(ScheduledExportDeleteConfirmation(model: model))
    }
}
