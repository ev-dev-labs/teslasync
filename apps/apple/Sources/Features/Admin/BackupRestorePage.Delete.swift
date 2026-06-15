import SwiftUI

/// The delete-confirmation dialog (web `ConfirmDialog`). Confirms a permanent config
/// removal, reproducing the web message (with the config name) + Cancel / Delete actions.
/// The dialog cannot be dismissed while the delete is in flight. All copy resolves from
/// `Localizable.xcstrings` with the web key names; state binds to the `@Observable`
/// `BackupRestorePageModel`.
struct BackupConfigDeleteSheet: View {
    @Bindable var model: BackupRestorePageModel
    let target: BackupConfig

    var body: some View {
        BackupSheetScaffold(title: "backup.deleteConfig") {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                Text(verbatim: Self.message(for: target.name))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let deleteError = model.deleteError {
                    TSErrorText("backup.configDeleteFailed")
                        .accessibilityValue(Text(verbatim: deleteError))
                }
            }
        } footer: {
            Spacer(minLength: 0)
            TSButton("common.cancel", variant: .secondary) {
                model.cancelDelete()
            }
            .disabled(model.isDeleting)
            TSButton("backup.delete", variant: .destructive, isLoading: model.isDeleting) {
                Task { await model.confirmDelete() }
            }
        }
        .interactiveDismissDisabled(model.isDeleting)
    }

    /// Web `'Are you sure you want to delete "{{name}}"? …'` resolved with the config name.
    static func message(for name: String) -> String {
        String(format: String(localized: "backup.deleteConfigMessage"), name)
    }
}
