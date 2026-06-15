import SwiftUI

/// The create / edit configuration dialog (web create/edit `Modal`). One surface powers
/// both modes: edit (`model.editingConfig != nil`, Save → Save Changes) and create. The form
/// reproduces the web fields — name, enabled, type, provider, frequency, retention, the
/// dynamic provider credential fields, and the compress/encrypt options. All copy resolves
/// from `Localizable.xcstrings` with the web key names; state binds to the `@Observable`
/// `BackupRestorePageModel`.
struct BackupConfigEditorSheet: View {
    @Bindable var model: BackupRestorePageModel

    var body: some View {
        BackupSheetScaffold(title: model.isEditing ? "backup.editConfig" : "backup.newConfig") {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                nameField
                TSToggle("backup.enabled", isOn: $model.form.enabled)
                typeAndProvider
                frequencyAndRetention
                BackupProviderFieldsSection(model: model)
                optionsToggles
                if let saveError = model.saveError {
                    TSErrorText("backup.configCreateFailed")
                        .accessibilityValue(Text(verbatim: saveError))
                }
            }
        } footer: {
            Spacer(minLength: 0)
            TSButton("common.cancel", variant: .secondary) {
                model.closeEditor()
            }
            .disabled(model.isSaving)
            TSButton(
                model.isEditing ? "backup.saveChanges" : "backup.create",
                variant: .primary,
                isLoading: model.isSaving
            ) {
                Task { await model.save() }
            }
            .disabled(!model.canSave)
        }
        .interactiveDismissDisabled(model.isSaving)
    }

    private var nameField: some View {
        TSTextField(
            "backup.configNamePlaceholder", // parity:allow i18n key name, not a stub
            text: $model.form.name,
            label: "backup.configName"
        )
    }

    private var typeAndProvider: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSelect(
                selection: $model.form.backupType,
                options: [
                    TSSelectOption(.full, "backup.full"),
                    TSSelectOption(.incremental, "backup.incremental")
                ],
                label: "backup.backupType"
            )
            TSSelect(
                selection: Binding(get: { model.form.provider }, set: { model.selectProvider($0) }),
                options: BackupProvider.allCases.map { TSSelectOption($0, LocalizedStringKey($0.displayName)) },
                label: "backup.provider"
            )
        }
    }

    private var frequencyAndRetention: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSStepper("backup.frequencyDays", value: $model.form.frequencyDays, in: 1 ... 365)
            TSStepper("backup.maxRetention", value: $model.form.maxRetention, in: 1 ... 365)
        }
    }

    private var optionsToggles: some View {
        HStack(spacing: TSSpacing.x2xl) {
            TSToggle("backup.compress", isOn: $model.form.compress)
            TSToggle("backup.encrypt", isOn: $model.form.encrypt)
        }
    }
}

/// The dynamic provider credential fields (web `PROVIDER_FIELDS[provider]`), inside a
/// titled bordered group. Field labels/prompts are vendor terms rendered verbatim, matching
/// the web; the control kind (text / password / multi-line) tracks the web field `type`.
struct BackupProviderFieldsSection: View {
    @Bindable var model: BackupRestorePageModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSLabel("backup.providerSettings")
            ForEach(model.form.provider.fields) { field in
                fieldRow(field)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private func fieldRow(_ field: BackupProviderField) -> some View {
        switch field.kind {
        case .text:
            TSTextField(
                LocalizedStringKey(field.prompt),
                text: binding(for: field),
                label: LocalizedStringKey(field.displayLabel)
            )
        case .password:
            TSSecureField(
                LocalizedStringKey(field.prompt),
                text: binding(for: field),
                label: LocalizedStringKey(field.displayLabel)
            )
        case .multiline:
            TSTextArea(text: binding(for: field), label: LocalizedStringKey(field.displayLabel))
        }
    }

    private func binding(for field: BackupProviderField) -> Binding<String> {
        Binding(
            get: { [model] in model.providerValue(field.key) },
            set: { [model] newValue in model.setProviderField(field.key, newValue) }
        )
    }
}
