//
//  SavedViewMenu.Dialogs.swift
//  TeslaSync — P4 shared surface · 0102 · SavedViewMenu (Apple)
//
//  The sheet contents for the saved-views menu — the native parity of the web `SavedViewSaveDialog`,
//  `SavedViewRenameDialog`, and `SavedViewManageDialog`. Each is presented by `SavedViewMenu` through
//  `.tsModal` (the shared titled-sheet wrapper, web `Modal`); the delete confirmation uses a
//  `.confirmationDialog` wired in the entry file. These are pure presentational forms — they own only
//  their local field state and forward submit / cancel to the model.
//

import SwiftUI

// MARK: - Shared field text (web name input prompt + label)

/// The name field's prompt + label, shared by the save + rename forms (the prompt key is kept
/// verbatim for i18n parity with the web source).
private enum SavedViewFieldText {
    static var prompt: LocalizedStringKey {
        LocalizedStringKey(SavedViewMenuStrings.string(SavedViewMenuStrings.namePromptKey, "View name"))
    }

    static var label: LocalizedStringKey {
        LocalizedStringKey(SavedViewMenuStrings.string("savedViews.name", "Name"))
    }
}

// MARK: - Save form (web SavedViewSaveDialog)

/// The "Save current view…" form — a name field, the "make default" checkbox, and Cancel / Save
/// actions. Save is disabled while the trimmed name is empty or a save is in flight (web disabled
/// `Save`); the label switches to "Saving…" while pending.
struct SavedViewSaveForm: View {
    let saving: Bool
    let onCancel: () -> Void
    let onSave: (String, Bool) -> Void

    @State private var name = ""
    @State private var makeDefault = false

    private var trimmed: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSTextField(SavedViewFieldText.prompt, text: $name, label: SavedViewFieldText.label)
            TSCheckbox(makeDefaultLabel, isOn: $makeDefault)
            SavedViewDialogActions(
                saving: saving,
                isSubmitDisabled: trimmed.isEmpty,
                onCancel: onCancel,
                onSubmit: { onSave(trimmed, makeDefault) }
            )
        }
    }

    private var makeDefaultLabel: LocalizedStringKey {
        LocalizedStringKey(SavedViewMenuStrings.string(
            "savedViews.makeDefault", "Apply automatically when I open this page"
        ))
    }
}

// MARK: - Rename form (web SavedViewRenameDialog)

/// The "Rename view" form — a name field seeded with the current name and Cancel / Save actions. An
/// empty or unchanged name on submit is treated as a no-op by the model (web `handleSubmit`).
struct SavedViewRenameForm: View {
    let initialName: String
    let saving: Bool
    let onCancel: () -> Void
    let onRename: (String) -> Void

    @State private var name: String

    init(
        initialName: String,
        saving: Bool,
        onCancel: @escaping () -> Void,
        onRename: @escaping (String) -> Void
    ) {
        self.initialName = initialName
        self.saving = saving
        self.onCancel = onCancel
        self.onRename = onRename
        _name = State(initialValue: initialName)
    }

    private var trimmed: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSTextField(SavedViewFieldText.prompt, text: $name, label: SavedViewFieldText.label)
            SavedViewDialogActions(
                saving: saving,
                isSubmitDisabled: trimmed.isEmpty,
                onCancel: onCancel,
                onSubmit: { onRename(trimmed) }
            )
        }
    }
}

// MARK: - Shared dialog actions (Cancel + Save)

/// The Cancel / Save button pair shared by the save + rename forms — the web dialog footer. The
/// submit label switches to "Saving…" while a mutation is in flight (web `saving ? 'Saving…'`).
struct SavedViewDialogActions: View {
    let saving: Bool
    let isSubmitDisabled: Bool
    let onCancel: () -> Void
    let onSubmit: () -> Void

    private var submitLabel: String {
        saving
            ? SavedViewMenuStrings.string("common.saving", "Saving…")
            : SavedViewMenuStrings.string("common.save", "Save")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer()
            TSButton(variant: .ghost, size: .small, action: onCancel) {
                Text(verbatim: SavedViewMenuStrings.string("common.cancel", "Cancel"))
            }
            .accessibilityLabel(Text(verbatim: SavedViewMenuStrings.string("common.cancel", "Cancel")))
            TSButton(variant: .primary, size: .small, action: onSubmit) {
                Text(verbatim: submitLabel)
            }
            .disabled(isSubmitDisabled || saving)
            .accessibilityLabel(Text(verbatim: submitLabel))
        }
    }
}

// MARK: - Manage list (web SavedViewManageDialog)

/// The "Manage views" list — every saved view with its full action set and a closing button. Each row
/// carries a `.help` tooltip of its querystring (web row `title={v.query || 'No filters'}`).
struct SavedViewManageList: View {
    let resolved: SavedViewMenuResolved
    let onApply: (SavedViewRow) -> Void
    let onToggleDefault: (SavedViewRow) -> Void
    let onTogglePin: (SavedViewRow) -> Void
    let onRename: (SavedViewRow) -> Void
    let onDelete: (SavedViewRow) -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if resolved.rows.isEmpty {
                TSEmptyState(title: LocalizedStringKey(resolved.emptyMessage), systemImage: "bookmark")
            } else {
                list
            }
            HStack {
                Spacer()
                TSButton(variant: .secondary, size: .small, action: onClose) {
                    Text(verbatim: SavedViewMenuStrings.string("common.close", "Close"))
                }
                .accessibilityLabel(Text(verbatim: SavedViewMenuStrings.string("common.close", "Close")))
            }
        }
        .frame(minWidth: 320)
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ForEach(resolved.rows) { row in
                    SavedViewMenuRow(
                        row: row,
                        onApply: { onApply(row) },
                        onToggleDefault: { onToggleDefault(row) },
                        onTogglePin: { onTogglePin(row) },
                        onRename: { onRename(row) },
                        onDelete: { onDelete(row) }
                    )
                    .help(Text(verbatim: row.queryDescription))
                }
            }
        }
        .frame(maxHeight: 420)
    }
}
