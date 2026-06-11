//
//  CommandInputDialog.Views.swift
//  TeslaSync — P4 modal/dialog · 0030 · CommandInputDialog (Apple)
//
//  The populated content for `CommandInputDialog`: the modal header (command glyph + title + prompt +
//  freshness chip + close), and the form — one row per field (its optional label, the kind-appropriate
//  entry field, and the inline validation error) followed by the Cancel / Send footer. The single-field
//  and multi-field web shapes are unified through the model's `fields`. All copy resolves through the
//  P1/S10 facade; all chrome is token-driven (P1/S9). No web Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (web Modal title + close)

/// The dialog header: the command glyph in a rounded surface, the title + prompt + freshness chip, and
/// the trailing close button (web header row with its `onClose` "×").
struct CommandInputHeader: View {
    let iconSystemName: String
    let title: String
    let prompt: String
    let connection: CommandInputConnection
    let closeLabel: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(spacing: TSSpacing.sm) {
                    Text(verbatim: title)
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    CommandInputFreshnessChip(connection: connection)
                }
                if !prompt.isEmpty {
                    Text(verbatim: prompt)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: iconSystemName)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.textSecondary)
            .frame(width: 36, height: 36)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
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

/// The populated form shown for `.content`: one row per field, then the footer actions. Owns the field
/// focus so the first field gets first responder on appear (web `firstInputRef.focus()`), advances
/// focus on Return, and validates a field on blur (web `handleBlur` when focus leaves it).
struct CommandInputForm: View {
    @Bindable var model: CommandInputDialogModel
    let onCancel: () -> Void
    let onSubmit: () -> Void
    @FocusState private var focusedField: String?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(Array(model.fields.enumerated()), id: \.element.id) { index, field in
                CommandInputFieldRow(
                    model: model,
                    field: field,
                    nextFieldName: nextFieldName(after: index),
                    focus: $focusedField,
                    onSubmit: onSubmit
                )
            }
            CommandInputFooter(
                cancelLabel: model.cancelTitle,
                submitLabel: model.submitTitle,
                submitting: model.submitting,
                submitDisabled: !model.isValid,
                onCancel: onCancel,
                onSubmit: onSubmit
            )
        }
        .onAppear { focusedField = model.fields.first?.name }
        .onChange(of: focusedField) { previous, _ in
            if let previous { model.blurField(previous) }
        }
    }

    /// The name of the field after `index`, or `nil` for the last field (which submits on Return).
    private func nextFieldName(after index: Int) -> String? {
        let next = index + 1
        guard next < model.fields.count else { return nil }
        return model.fields[next].name
    }
}

// MARK: - Field row (web `<Input>` + label + error)

/// One field's row: the optional label, the kind-appropriate entry field, and the inline validation
/// error shown once the field is touched (web `error={touched[name] ? errors[name] : undefined}`).
struct CommandInputFieldRow: View {
    @Bindable var model: CommandInputDialogModel
    let field: CommandInputField
    let nextFieldName: String?
    var focus: FocusState<String?>.Binding
    let onSubmit: () -> Void

    var body: some View {
        let error = model.visibleError(for: field.name)
        return VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if let label = model.label(for: field) {
                CommandInputFieldLabel(text: label)
            }
            entryField(hasError: error != nil)
            if let error {
                CommandInputErrorText(message: error)
            }
        }
    }

    private var binding: Binding<String> {
        Binding(
            get: { model.value(for: field.name) },
            set: { model.updateValue(field.name, $0) }
        )
    }

    private var accessibilityLabel: String {
        model.label(for: field) ?? (field.hint.isEmpty ? model.title : field.hint)
    }

    @ViewBuilder
    private func entryField(hasError: Bool) -> some View {
        let mode = model.entryMode(for: field)
        Group {
            if mode == .secureNumeric {
                SecureField(text: binding, prompt: hintText) { hintText }
                    .textContentType(.oneTimeCode)
                    .commandInputKeyboard(mode)
            } else {
                TextField(text: binding, prompt: hintText) { hintText }
                    .commandInputKeyboard(mode)
                    .commandInputTextTraits(mode)
            }
        }
        .labelsHidden()
        .focused(focus, equals: field.name)
        .submitLabel(nextFieldName == nil ? .done : .next)
        .onSubmit(handleReturn)
        .disabled(model.submitting)
        .modifier(CommandInputFieldChrome(hasError: hasError))
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var hintText: Text {
        Text(verbatim: field.hint)
    }

    /// Advances to the next field, or submits when this is the last (web Enter-to-submit on a single-row
    /// form; multi-row forms tab forward).
    private func handleReturn() {
        if let nextFieldName {
            focus.wrappedValue = nextFieldName
        } else {
            onSubmit()
        }
    }
}

// MARK: - Footer (web Cancel + Send)

/// The form footer: the ghost Cancel (web `onClose`) and the primary Send (web `loading` spinner,
/// `disabled={!isValid()}`).
struct CommandInputFooter: View {
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

/// A form field's visible label (web `<Input label>`), styled as a token label.
struct CommandInputFieldLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The per-field validation error line (web `<Input error>`).
struct CommandInputErrorText: View {
    let message: String

    var body: some View {
        Text(verbatim: message)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.statusDanger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text(verbatim: message))
    }
}

/// Shared field chrome: token surface + rounded border, reddened when the field is in error (web
/// `<Input>` box with its error ring).
private struct CommandInputFieldChrome: ViewModifier {
    let hasError: Bool

    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(hasError ? Color.TS.statusDanger : Color.TS.border, lineWidth: 1)
            )
    }
}

extension View {
    /// Applies the keypad for a numeric/decimal entry mode on iOS/iPadOS; a no-op on macOS where
    /// `keyboardType` is unavailable.
    @ViewBuilder
    func commandInputKeyboard(_ mode: CommandFieldEntryMode) -> some View {
        #if os(iOS)
            switch mode {
            case .secureNumeric, .numeric:
                keyboardType(.numberPad)
            case .decimal:
                keyboardType(.decimalPad)
            case .text:
                self
            }
        #else
            self
        #endif
    }

    /// Disables autocapitalization + autocorrection for free-text entry on iOS/iPadOS; a no-op on macOS
    /// and for numeric modes (which need neither).
    @ViewBuilder
    func commandInputTextTraits(_ mode: CommandFieldEntryMode) -> some View {
        #if os(iOS)
            if mode == .text {
                textInputAutocapitalization(.never).autocorrectionDisabled(true)
            } else {
                self
            }
        #else
            self
        #endif
    }
}

// MARK: - Localization Text helper

extension CommandInputStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
