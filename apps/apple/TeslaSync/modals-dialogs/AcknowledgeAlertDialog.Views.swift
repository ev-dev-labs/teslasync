//
//  AcknowledgeAlertDialog.Views.swift
//  TeslaSync — P4 modal/dialog · 0017 · AcknowledgeAlertDialog (Apple)
//
//  The populated content for `AcknowledgeAlertDialog`: the modal header (bell glyph + title + freshness
//  chip + close), and the form — the optional alert subtitle, the multi-line note editor (web
//  `Textarea`) with its live character counter + hint/too-long line, the inline submit error, and the
//  Cancel / Acknowledge footer. All copy resolves through the P1/S10 facade; all chrome is token-driven
//  (P1/S9). No web Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (web Modal title + close)

/// The dialog header: the bell glyph, the title + freshness chip, and the trailing close button (web
/// `Modal` title bar with its `onClose` "×").
struct AckAlertHeader: View {
    let title: String
    let connection: AckAlertConnection
    let closeLabel: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                AckAlertFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "bell.badge.fill")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 32, height: 32)
            .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: closeLabel))
    }
}

// MARK: - Form (web populated `<form>`)

/// The populated form shown for `.content`: the inline reload error (when a refresh failed while a
/// cached context remains), the optional alert subtitle, the note editor, the submit error, and the
/// footer actions. Owns the field focus so the note gets first responder on appear (web `autoFocus`).
struct AckAlertForm: View {
    @Bindable var model: AckAlertModel
    let onCancel: () -> Void
    let onSubmit: () -> Void
    @FocusState private var noteFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let message = model.inlineErrorMessage {
                AckAlertInlineError(message: message)
            }
            if let subtitle = model.subtitle {
                Text(verbatim: subtitle)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityLabel(Text(verbatim: subtitle))
            }
            AckNoteEditor(
                label: model.noteLabel,
                prompt: model.notePromptText,
                hint: model.noteHint,
                text: noteBinding,
                tooLong: model.isTooLong,
                characterCount: model.characterCount,
                limit: AckAlertProjection.noteMaxLength,
                countLabel: model.noteCountAccessibilityLabel,
                disabled: model.submitting,
                focus: $noteFocused
            )
            if let error = model.errorMessage {
                AckErrorText(message: error)
            }
            AckAlertFooter(
                cancelLabel: model.cancelTitle,
                submitLabel: model.submitTitle,
                submitting: model.submitting,
                submitDisabled: model.submitDisabled,
                onCancel: onCancel,
                onSubmit: onSubmit
            )
        }
        .onAppear { noteFocused = true }
    }

    /// Routes note edits through the model's input cap (web `maxLength`).
    private var noteBinding: Binding<String> {
        Binding(
            get: { model.note },
            set: { model.updateNote($0) }
        )
    }
}

// MARK: - Note editor (web `Textarea`)

/// The multi-line note input — the native parity of the web `Textarea`: a labelled `TextEditor` with a
/// prompt shown when empty, the always-present hint (styled as an error when too long), and a live
/// character counter toward the limit.
struct AckNoteEditor: View {
    let label: String
    let prompt: String
    let hint: String
    @Binding var text: String
    let tooLong: Bool
    let characterCount: Int
    let limit: Int
    let countLabel: String
    let disabled: Bool
    var focus: FocusState<Bool>.Binding

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            AckFieldLabel(text: label)
            editor
            footer
        }
    }

    private var editor: some View {
        TextEditor(text: $text)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .scrollContentBackground(.hidden)
            .frame(minHeight: 96)
            .focused(focus)
            .disabled(disabled)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(alignment: .topLeading) { promptOverlay }
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(tooLong ? Color.TS.statusDanger : Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(Text(verbatim: label))
            .accessibilityValue(Text(verbatim: countLabel))
    }

    @ViewBuilder
    private var promptOverlay: some View {
        if text.isEmpty {
            Text(verbatim: prompt)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.sm)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private var footer: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: hint)
                .font(Font.TS.caption)
                .foregroundStyle(tooLong ? Color.TS.statusDanger : Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: "\(characterCount)/\(limit)")
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(tooLong ? Color.TS.statusDanger : Color.TS.textMuted)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Footer (web Cancel + Acknowledge)

/// The form footer: the ghost Cancel (disabled while submitting) and the primary Acknowledge action
/// (disabled while submitting or too long), which shows a spinner while in flight.
struct AckAlertFooter: View {
    let cancelLabel: String
    let submitLabel: String
    let submitting: Bool
    let submitDisabled: Bool
    let onCancel: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .medium, action: onCancel) {
                Text(verbatim: cancelLabel)
            }
            .disabled(submitting)
            .accessibilityLabel(Text(verbatim: cancelLabel))
            TSButton(variant: .primary, size: .medium, isLoading: submitting, action: onSubmit) {
                Text(verbatim: submitLabel)
            }
            .disabled(submitDisabled)
            .accessibilityLabel(Text(verbatim: submitLabel))
        }
    }
}

// MARK: - Field helpers

/// A form field's visible label (web `<Textarea label>`), styled as a token label.
struct AckFieldLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The submit-error line under the form (web parent toast surfaced inline by the native client).
struct AckErrorText: View {
    let message: String

    var body: some View {
        Text(verbatim: message)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.statusDanger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text(verbatim: message))
    }
}

// MARK: - Localization Text helper

extension AckAlertStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
