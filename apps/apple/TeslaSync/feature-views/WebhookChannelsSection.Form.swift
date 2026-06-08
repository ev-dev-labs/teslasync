//
//  WebhookChannelsSection.Form.swift
//  TeslaSync — P4 feature view · 0218 · WebhookChannelsSection (Apple)
//
//  The add/edit form sheet (web `WebhookFormModal`) and its live HMAC signature
//  preview (web `SignaturePreview`). The sheet holds the editable form locally
//  (mirroring the web modal's `useState`) and delegates validation + save + the
//  debounced preview to `WebhookChannelsSectionModel`. Token-driven + localized
//  through the surface i18n facade; no networking lives here.
//

import SwiftUI

// MARK: - Prompt keys (verbatim web i18n keys)

/// The verbatim web i18n keys for the form field prompts. The web key names embed a
/// term the stub-scanner also forbids, so the literals are isolated here behind the
/// sanctioned `parity:allow` opt-out — keeping the scan green while the keys still
/// match the web source byte-for-byte.
private enum WebhookPromptKey {
    static let name = "webhookChannels.form.namePlaceholder" // parity:allow verbatim web i18n key
    static let url = "webhookChannels.form.urlPlaceholder" // parity:allow verbatim web i18n key
    static let secret = "webhookChannels.form.secretPlaceholder" // parity:allow verbatim web i18n key
    static let secretEdit = "webhookChannels.form.secretPlaceholderEdit" // parity:allow verbatim web i18n key
}

// MARK: - Form sheet (web `WebhookFormModal`)

/// The add/edit webhook form. Seeded from `model.editingForm`, it edits a local
/// `WebhookFormState` copy and routes submit / cancel / signature-preview through the
/// bound model. Every state the web modal renders is reproduced: validation error,
/// the debounced signature preview, the secret show/hide toggle, and the in-flight
/// save button.
struct WebhookFormSheet: View {
    @Bindable var model: WebhookChannelsSectionModel
    let seed: WebhookFormState

    @State private var form: WebhookFormState
    @State private var showSecret = false

    init(model: WebhookChannelsSectionModel, seed: WebhookFormState) {
        self.model = model
        self.seed = seed
        _form = State(initialValue: seed)
    }

    private var title: String {
        form.isEdit
            ? WebhookStrings.string("webhookChannels.form.editTitle", "Edit webhook")
            : WebhookStrings.string("webhookChannels.form.addTitle", "Add webhook")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    nameField
                    urlField
                    methodField
                    secretField
                    signaturePreview
                    enabledRow
                    if !model.formError.isEmpty {
                        Text(verbatim: model.formError)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.statusDanger)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isStaticText)
                    }
                    actionRow
                }
                .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
            .navigationTitle(Text(verbatim: title))
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button {
                            model.dismissForm()
                        } label: {
                            WebhookStrings.text("webhookChannels.form.cancel", "Cancel")
                        }
                        .accessibilityLabel(WebhookStrings.text("webhookChannels.form.cancel", "Cancel"))
                    }
                }
        }
        .onAppear { model.requestSignaturePreview(secret: form.secret) }
        .onChange(of: form.secret) { _, value in
            model.requestSignaturePreview(secret: value)
        }
    }

    // MARK: Fields

    private var nameField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            WebhookFieldLabel(key: "webhookChannels.form.name", fallback: "Name", required: true)
            WebhookTextInput(
                text: $form.name,
                promptKey: WebhookPromptKey.name,
                promptFallback: "Discord #alerts",
                labelKey: "webhookChannels.form.name",
                labelFallback: "Name"
            )
        }
    }

    private var urlField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            WebhookFieldLabel(key: "webhookChannels.form.url", fallback: "URL", required: true)
            WebhookTextInput(
                text: $form.url,
                promptKey: WebhookPromptKey.url,
                promptFallback: "https://discord.com/api/webhooks/...",
                labelKey: "webhookChannels.form.url",
                labelFallback: "URL",
                isURL: true
            )
            WebhookHelperText(
                key: "webhookChannels.form.urlHelp",
                fallback: "Compatible with Discord, Slack, n8n, Home Assistant, and any HTTP receiver."
            )
        }
    }

    private var methodField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            WebhookFieldLabel(key: "webhookChannels.form.method", fallback: "HTTP method", required: false)
            Picker(selection: $form.method) {
                ForEach(WebhookMethod.formOptions) { method in
                    Text(verbatim: method.display).tag(method)
                }
            } label: {
                WebhookStrings.text("webhookChannels.form.method", "HTTP method")
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .tint(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .padding(.horizontal, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(WebhookStrings.text("webhookChannels.form.method", "HTTP method"))
        }
    }

    private var secretField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            WebhookFieldLabel(key: "webhookChannels.form.secret", fallback: "Signing secret", required: false)
            HStack(spacing: TSSpacing.sm) {
                secretInput
                Button {
                    showSecret.toggle()
                } label: {
                    Image(systemName: showSecret ? "eye.slash" : "eye")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.TS.textMuted)
                        .frame(width: 32, height: 40)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    showSecret
                        ? WebhookStrings.text("webhookChannels.form.hideSecret", "Hide secret")
                        : WebhookStrings.text("webhookChannels.form.showSecret", "Show secret")
                )
            }
            WebhookHelperText(
                key: "webhookChannels.form.secretHelp",
                fallback: "When set, every request includes X-TeslaSync-Signature: sha256=<hmac> "
                    + "so the receiver can verify authenticity."
            )
        }
    }

    @ViewBuilder
    private var secretInput: some View {
        let prompt = Text(verbatim: form.isEdit
            ? WebhookStrings.string(WebhookPromptKey.secretEdit, "Leave blank to keep existing")
            : WebhookStrings.string(WebhookPromptKey.secret, "Optional — used for HMAC signing"))
        Group {
            if showSecret {
                TextField(text: $form.secret, prompt: prompt) {
                    WebhookStrings.text("webhookChannels.form.secret", "Signing secret")
                }
            } else {
                SecureField(text: $form.secret, prompt: prompt) {
                    WebhookStrings.text("webhookChannels.form.secret", "Signing secret")
                }
            }
        }
        .labelsHidden()
        .textFieldStyle(.plain)
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textPrimary)
        .padding(.horizontal, TSSpacing.sm)
        .frame(minHeight: 40)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        #if os(iOS)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        #endif
    }

    private var signaturePreview: some View {
        WebhookSignaturePreviewView(state: model.signatureState)
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }

    private var enabledRow: some View {
        Toggle(isOn: $form.enabled) {
            WebhookStrings.text("webhookChannels.form.enabled", "Enabled")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .toggleStyle(.switch)
        .tint(Color.TS.accent)
        .padding(.top, TSSpacing.xs)
        .overlay(alignment: .top) { Divider().opacity(0) }
    }

    private var actionRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            Button {
                model.dismissForm()
            } label: {
                WebhookStrings.text("webhookChannels.form.cancel", "Cancel")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.sm)
                    .frame(minHeight: 34)
                    .background(
                        Color.TS.surfaceGlass,
                        in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                            .strokeBorder(Color.TS.border, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(WebhookStrings.text("webhookChannels.form.cancel", "Cancel"))
            saveButton
        }
    }

    private var saveButton: some View {
        let key = form.isEdit ? "webhookChannels.form.saveEdit" : "webhookChannels.form.save"
        let fallback = form.isEdit ? "Save changes" : "Add webhook"
        let label = model.saving
            ? WebhookStrings.string("webhookChannels.form.saving", "Saving…")
            : WebhookStrings.string(key, fallback)
        return Button {
            model.submit(form)
        } label: {
            HStack(spacing: TSSpacing.xs) {
                if model.saving { ProgressView().controlSize(.mini).tint(.white) }
                Text(verbatim: label).font(Font.TS.caption).fontWeight(.semibold)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .frame(minHeight: 34)
            .background(Color.TS.accent, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(model.saving)
        .accessibilityLabel(Text(verbatim: label))
    }
}
