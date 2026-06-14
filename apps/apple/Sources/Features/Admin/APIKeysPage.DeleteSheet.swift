import SwiftUI

/// The delete-confirmation dialog for `APIKeysPage` (web `ConfirmDialog`). Confirms a
/// permanent key removal, reproducing the web title + message (with the key name) + Cancel
/// / Delete actions. The dialog cannot be dismissed while the delete is in flight and stays
/// open carrying the error if it fails (web keeps `deleteTarget` set on failure). Presented
/// as an HIG-native sheet, adaptive across macOS (sized window) and iOS (content-sized
/// sheet). All copy resolves from `Localizable.xcstrings` with the web key names; state
/// binds to the `@Observable` `APIKeysPageModel`.
struct APIKeysDeleteSheet: View {
    @Bindable var model: APIKeysPageModel
    let target: APIKeyEntry

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color.TS.border)
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    Text(verbatim: APIKeysPage.deleteMessage(for: target.name))
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let deleteError = model.deleteError {
                        Text(verbatim: deleteError)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.statusDanger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider().overlay(Color.TS.border)
            footer
        }
        .background(Color.TS.surface)
        #if os(macOS)
            .frame(minWidth: 420, minHeight: 200)
        #endif
            .interactiveDismissDisabled(model.isDeleting)
    }

    private var header: some View {
        HStack {
            Text("Delete API Key")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.md)
        }
        .padding(TSSpacing.lg)
    }

    private var footer: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            TSButton("Cancel", variant: .secondary) {
                model.cancelDelete()
            }
            .disabled(model.isDeleting)
            TSButton("Delete", variant: .destructive, isLoading: model.isDeleting) {
                Task { await model.confirmDelete() }
            }
        }
        .padding(TSSpacing.lg)
    }
}
