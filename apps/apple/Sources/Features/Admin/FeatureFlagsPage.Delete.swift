import SwiftUI

/// The delete-confirmation dialog for `FeatureFlagsPage` (web delete `Modal`). Confirms
/// a permanent flag removal with a required reason (the backend audit row is rejected
/// without it), reproducing the web message + reason input + Cancel / Delete actions. The
/// dialog cannot be dismissed while the delete is in flight (web `if (isPending) return`).
/// All copy resolves from `Localizable.xcstrings` with the web key names; state binds to
/// the `@Observable` `FeatureFlagsPageModel`.
struct FeatureFlagDeleteSheet: View {
    @Bindable var model: FeatureFlagsPageModel
    let target: FeatureFlagEntry

    var body: some View {
        FeatureFlagSheetScaffold(title: String(localized: "admin.flags.delete.title")) {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                Text(verbatim: Self.message(for: target.key))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                TSTextField(
                    "admin.flags.delete.reasonPlaceholder", // parity:allow i18n key name, not a stub
                    text: $model.deleteReason,
                    label: "admin.flags.delete.reasonLabel"
                )
                if let deleteError = model.deleteError {
                    Text(verbatim: deleteError)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.statusDanger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } footer: {
            Spacer(minLength: 0)
            TSButton("common.cancel", variant: .secondary) {
                model.cancelDelete()
            }
            .disabled(model.isDeleting)
            TSButton("admin.flags.delete.confirm", variant: .destructive, isLoading: model.isDeleting) {
                Task { await model.confirmDelete() }
            }
            .disabled(!model.canConfirmDelete)
        }
        .interactiveDismissDisabled(model.isDeleting)
    }

    /// Web `'Permanently remove flag "{{key}}". …'` resolved with the flag key.
    static func message(for key: String) -> String {
        String(format: String(localized: "admin.flags.delete.message"), key)
    }
}
