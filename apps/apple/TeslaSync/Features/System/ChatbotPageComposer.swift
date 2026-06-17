//
//  ChatbotPageComposer.swift
//  TeslaSync — P4-APPLE P7 · page:system/Chatbot (Apple) — Composer
//
//  The conversation composer — the native parity of the web `Textarea` + Send/Stop control row
//  at the bottom of the chat `GlassPanel`. A growing multi-line input carries the prompt key
//  plus the `chatbot.inputLabel` VoiceOver label; Return submits (web
//  Enter-to-send). While a reply reveals, the Send button is swapped for a Stop control whose
//  visible label is `chatbot.actions.stop`, VoiceOver label `chatbot.actions.stopStreaming`, and
//  tooltip `chatbot.actions.stopHint` (web `aria-label` + `title`). All copy resolves from the
//  app catalog under the web key names.
//

import SwiftUI

struct ChatbotComposer: View {
    @Bindable var model: ChatbotPageModel

    var body: some View {
        HStack(alignment: .bottom, spacing: TSSpacing.sm) {
            inputField
            if model.isStreaming {
                stopButton
            } else {
                sendButton
            }
        }
        .padding(TSSpacing.md)
    }

    private var inputField: some View {
        TextField(model.inputPromptKey, text: $model.input, axis: .vertical)
            .lineLimit(1 ... 5)
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .padding(TSSpacing.sm)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .frame(maxWidth: .infinity)
            .accessibilityLabel(Text(model.inputLabelKey))
            .onSubmit { model.send() }
    }

    private var sendButton: some View {
        TSButton(
            variant: .primary,
            size: .medium,
            action: { model.send() },
            label: {
                Image(systemName: "paperplane.fill")
                    .accessibilityHidden(true)
            }
        )
        .disabled(isSendDisabled)
        .accessibilityLabel(Text(model.sendKey))
    }

    private var stopButton: some View {
        TSButton(
            variant: .secondary,
            size: .medium,
            action: { model.stopStreaming() },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "stop.fill")
                        .accessibilityHidden(true)
                    Text(model.stopKey)
                }
            }
        )
        .accessibilityLabel(Text(model.stopStreamingKey))
        .help(Text(model.stopHintKey))
    }

    private var isSendDisabled: Bool {
        model.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isSending
    }
}
