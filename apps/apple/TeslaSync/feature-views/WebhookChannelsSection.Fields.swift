//
//  WebhookChannelsSection.Fields.swift
//  TeslaSync — P4 feature view · 0218 · WebhookChannelsSection (Apple)
//
//  The form's reusable field primitives — the field label (web `Label` + required
//  asterisk), the helper text (web `HelperText`), the token-styled text input (web
//  `Input`), and the live signature preview (web `SignaturePreview`). Split from
//  WebhookChannelsSection.Form.swift to respect the house file-length limit.
//

import SwiftUI

// MARK: - Field label (web `Label` with required asterisk)

/// A field label with an optional required asterisk (web `Label … required`).
struct WebhookFieldLabel: View {
    let key: String
    let fallback: String
    let required: Bool

    var body: some View {
        HStack(spacing: 2) {
            WebhookStrings.text(key, fallback)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            if required {
                Text(verbatim: "*")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Helper text under a field (web `HelperText`).
struct WebhookHelperText: View {
    let key: String
    let fallback: String

    var body: some View {
        WebhookStrings.text(key, fallback)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Labeled text input (web `Input`)

/// A token-styled single-line text field (web `Input`) with a localized prompt.
struct WebhookTextInput: View {
    @Binding var text: String
    let promptKey: String
    let promptFallback: String
    let labelKey: String
    let labelFallback: String
    var isURL = false

    var body: some View {
        TextField(text: $text, prompt: Text(verbatim: WebhookStrings.string(promptKey, promptFallback))) {
            WebhookStrings.text(labelKey, labelFallback)
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
        .keyboardType(isURL ? .URL : .default)
        .textContentType(isURL ? .URL : nil)
        #endif
        .accessibilityLabel(WebhookStrings.text(labelKey, labelFallback))
    }
}

// MARK: - Signature preview (web `SignaturePreview`)

/// The live HMAC signature preview. Renders the empty helper, the loading row, the
/// failure message, or the resolved signature with a copy affordance + help text —
/// a faithful port of the web `SignaturePreview` branches.
struct WebhookSignaturePreviewView: View {
    let state: WebhookSignatureState

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            switch state {
            case .empty:
                WebhookStrings.text(
                    "webhookChannels.signature.empty",
                    "Add a signing secret to preview the X-TeslaSync-Signature header."
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            case .loading:
                label
                HStack(spacing: TSSpacing.xs) {
                    ProgressView().controlSize(.mini)
                    WebhookStrings.text("webhookChannels.signature.loading", "Computing signature…")
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                help
            case let .failed(message):
                label
                Text(verbatim: WebhookStrings.interpolate(
                    "webhookChannels.signature.error", "Failed to compute signature: {{error}}",
                    ["error": message]
                ))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.statusDanger)
                .fixedSize(horizontal: false, vertical: true)
                help
            case let .loaded(signature):
                label
                HStack(spacing: TSSpacing.sm) {
                    Text(verbatim: signature)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        WebhookClipboard.copy(signature)
                    } label: {
                        Image(systemName: WebhookGlyph.copy)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.TS.textMuted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(WebhookStrings.text("webhookChannels.copy", "Copy"))
                }
                help
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var label: some View {
        WebhookStrings.text("webhookChannels.signature.label", "Signature preview")
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
    }

    private var help: some View {
        WebhookStrings.text(
            "webhookChannels.signature.help",
            "Send this header value with every webhook so receivers can verify authenticity."
        )
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .fixedSize(horizontal: false, vertical: true)
    }
}
