import SwiftUI

/// The create dialog for `APIKeysPage` (web create `Modal`). One surface powers both
/// phases: the **form** (name + permission, web `Input` + `Select`) and, once the key is
/// minted, the one-time **reveal** of the plaintext secret (web `generatedKey` branch with
/// the `MaskedValue` inside a `GlassPanel` — the first web `GlassPanel`/GlassPanel1 — plus
/// a `CopyButton`). Presented as an HIG-native sheet, adaptive across macOS (sized window)
/// and iOS (content-sized sheet); it cannot be dismissed mid-create. All copy resolves
/// from `Localizable.xcstrings` with the web key names; state binds to the `@Observable`
/// `APIKeysPageModel`.
struct APIKeysCreateSheet: View {
    @Bindable var model: APIKeysPageModel

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color.TS.border)
            ScrollView {
                Group {
                    if model.hasGeneratedKey {
                        generatedView
                    } else {
                        formView
                    }
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(Color.TS.surface)
        #if os(macOS)
            .frame(minWidth: 460, minHeight: 300)
        #endif
            .interactiveDismissDisabled(model.isCreating)
    }

    // MARK: - Header (web Modal title: "New API Key" → "API Key Created")

    private var header: some View {
        HStack {
            Text(titleKey)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.md)
        }
        .padding(TSSpacing.lg)
    }

    private var titleKey: LocalizedStringKey {
        model.hasGeneratedKey ? "API Key Created" : "New API Key"
    }

    // MARK: - Form (web `Input` name + `Select` permissions + Generate / Cancel)

    private var formView: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSTextField(
                "My Application", // web field prompt (web Input prompt text)
                text: $model.newName,
                label: "Name"
            )
            TSSelect(
                selection: $model.newPermission,
                options: APIKeyPermission.allCases.map { TSSelectOption($0, $0.labelKey) },
                label: "Permissions"
            )
            if let createError = model.createError {
                Text(verbatim: createError)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: TSSpacing.sm) {
                TSButton(variant: .primary, isLoading: model.isCreating) {
                    Task { await model.generate() }
                } label: {
                    Label("Generate Key", systemImage: "plus")
                }
                .disabled(!model.canGenerate)
                TSButton("Cancel", variant: .secondary) {
                    model.closeCreate()
                }
                .disabled(model.isCreating)
            }
        }
    }

    // MARK: - Reveal (web `generatedKey` branch: GlassPanel1 + MaskedValue + CopyButton)

    @ViewBuilder
    private var generatedView: some View {
        if let key = model.generatedKey {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSCaption("Copy this key now — it won't be shown again.")
                HStack(spacing: TSSpacing.sm) {
                    TSGlassPanel {
                        TSMaskedValue(key)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityLabel(Text("API key, click to reveal"))
                    }
                    TSCopyButton(value: key)
                        .accessibilityLabel(Text("Copy API key"))
                        .help("Copy")
                }
                TSButton("Done", variant: .secondary) {
                    model.closeCreate()
                }
            }
        }
    }
}
