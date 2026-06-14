import SwiftUI

/// Shared modal scaffold for the Feature Flags write dialogs: a titled header, a
/// scrolling body, and a trailing-aligned footer of actions. Reproduces the web
/// `Drawer` / `Modal` chrome as an HIG-native sheet, adaptive across macOS (sized window)
/// and iOS (content-sized sheet).
struct FeatureFlagSheetScaffold<Content: View, Footer: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    @ViewBuilder let footer: () -> Footer

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: TSSpacing.md)
            }
            .padding(TSSpacing.lg)
            Divider().overlay(Color.TS.border)
            ScrollView {
                content()
                    .padding(TSSpacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider().overlay(Color.TS.border)
            HStack(spacing: TSSpacing.sm) {
                footer()
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.surface)
        #if os(macOS)
            .frame(minWidth: 480, minHeight: 360)
        #endif
    }
}

/// The create / edit dialog for `FeatureFlagsPage` (web `FlagEditDrawer`). One surface
/// powers both modes: edit (an existing flag, with an immutable key) when
/// `model.editing != nil`, and create otherwise. The value is a free-form JSON editor —
/// invalid JSON disables Save and surfaces the inline parse error (web `parsed`); the
/// reason is required by the backend audit row. All copy resolves from
/// `Localizable.xcstrings` with the web key names; state binds to the `@Observable`
/// `FeatureFlagsPageModel`.
struct FeatureFlagEditorSheet: View {
    @Bindable var model: FeatureFlagsPageModel

    var body: some View {
        FeatureFlagSheetScaffold(title: titleText) {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                keySection
                valueSection
                reasonSection
                if let saveError = model.saveError {
                    Text(verbatim: saveError)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.statusDanger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } footer: {
            Spacer(minLength: 0)
            TSButton("common.cancel", variant: .secondary) {
                model.closeEditor()
            }
            .disabled(model.isSaving)
            TSButton("admin.flags.drawer.save", variant: .primary, isLoading: model.isSaving) {
                Task { await model.save() }
            }
            .disabled(!model.canSave)
        }
        .interactiveDismissDisabled(model.isSaving)
    }

    /// Web `editing ? 'Edit flag "{{key}}"' : 'Create flag'`.
    private var titleText: String {
        if let editing = model.editing {
            return String(format: String(localized: "admin.flags.drawer.editTitle"), editing.key)
        }
        return String(localized: "admin.flags.drawer.createTitle")
    }

    // MARK: - Key (web `Input` — immutable once created)

    private var keySection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSTextField(
                "admin.flags.editor.keyPlaceholder", // parity:allow i18n key name, not a stub
                text: $model.editorKey,
                label: "admin.flags.editor.keyLabel"
            )
            .disabled(model.isEditing)
            if model.isEditing {
                TSHelperText("admin.flags.editor.keyImmutable")
            }
        }
    }

    // MARK: - Value (web `Textarea` — free-form JSON with inline parse error)

    private var valueSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSTextArea(text: $model.editorValueText, label: "admin.flags.editor.valueLabel", minHeight: 160)
                .font(.system(.body, design: .monospaced))
            valueError
        }
    }

    @ViewBuilder
    private var valueError: some View {
        switch model.editorValueError {
        case .none:
            EmptyView()
        case .empty:
            TSErrorText("admin.flags.editor.valueEmpty")
        case .invalid:
            TSErrorText("admin.flags.editor.valueInvalid")
        }
    }

    // MARK: - Reason (web `Input` — required by the audit row)

    private var reasonSection: some View {
        TSTextField(
            "admin.flags.editor.reasonPlaceholder", // parity:allow i18n key name, not a stub
            text: $model.editorReason,
            label: "admin.flags.editor.reasonLabel"
        )
    }
}
