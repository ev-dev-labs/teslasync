//
//  AlertRulesPage.NameCell.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/AlertRules (Apple) — Editable name cell
//
//  The name column's editable cell (web `EditableText`): the rule name links to
//  Alert Studio for editing, a pencil affordance starts an inline rename, and the
//  rename form validates the 120-char cap (web `validate` → `alertRules.error
//  .nameTooLong`) before calling `useSaveAlertRule`. Presentation only — the cap +
//  the save round-trip live on `AlertRulesPageModel`.
//

import SwiftUI

// MARK: - Name cell (web `EditableText` display + rename trigger)

struct AlertRuleNameCell: View {
    let rule: AlertRule
    let onOpenStudio: () -> Void
    let validate: (String) -> String?
    let onRename: (String) async -> Void

    @State private var isRenaming = false

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Button(action: onOpenStudio) {
                Text(verbatim: rule.name)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.accent)
                    .underline()
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .buttonStyle(.plain)

            Button {
                isRenaming = true
            } label: {
                Image(systemName: "pencil")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: ARStrings.renameRule(name: rule.name)))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(isPresented: $isRenaming) {
            AlertRuleRenameSheet(rule: rule, validate: validate, onRename: onRename)
        }
    }
}

// MARK: - Rename form (web `EditableText` edit mode)

struct AlertRuleRenameSheet: View {
    let rule: AlertRule
    let validate: (String) -> String?
    let onRename: (String) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft: String
    @State private var isSaving = false

    init(rule: AlertRule, validate: @escaping (String) -> String?, onRename: @escaping (String) async -> Void) {
        self.rule = rule
        self.validate = validate
        self.onRename = onRename
        _draft = State(initialValue: rule.name)
    }

    private var trimmed: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var validationError: String? {
        draft.isEmpty ? nil : validate(draft)
    }

    private var canSave: Bool {
        !trimmed.isEmpty && validate(trimmed) == nil
    }

    var body: some View {
        NavigationStack {
            Form {
                TSTextField(
                    ARStrings.key("alertRules.col.name"),
                    text: $draft,
                    label: ARStrings.key("alertRules.col.name"),
                    error: validationError.map { LocalizedStringKey($0) }
                )
                .accessibilityLabel(Text(verbatim: ARStrings.renameRule(name: rule.name)))
            }
            .navigationTitle(Text(verbatim: ARStrings.renameRule(name: rule.name)))
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(ARStrings.key("common.cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(ARStrings.key("common.save")) {
                        Task {
                            isSaving = true
                            await onRename(trimmed)
                            isSaving = false
                            dismiss()
                        }
                    }
                    .disabled(!canSave || isSaving)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
