//
//  ReauthDialog.Views.swift
//  TeslaSync — P4 modal/dialog · 0007 · ReauthDialog (Apple)
//
//  The populated content for `ReauthDialog`: the modal header (lock glyph + mode title + freshness chip
//  + close), and the form — the mode-driven body line, then the credential fork (the Password /
//  Authenticator tabs + the secure or numeric field + the helper line) or the confirm fork (the
//  typed-confirmation field), the inline error, and the Cancel / Continue-or-Confirm footer. All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No web Tailwind ports live
//  here.
//

import SwiftUI

// MARK: - Header (web Modal title + close)

/// The dialog header: the lock glyph, the mode title + freshness chip, and the trailing close button
/// (web `Modal` title bar with its `onClose` "×").
struct ReauthHeader: View {
    let title: String
    let connection: ReauthConnection
    let closeLabel: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                ReauthFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "lock.shield.fill")
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

/// The populated form shown for `.content`: the inline reload error (when a mode refresh failed while a
/// cached context remains), the body line, the mode fork (credential tabs + field + helper, or the
/// typed-confirmation field), the submit error, and the footer actions. Owns the field focus so the
/// active field gets first responder on appear + tab switch (web `autoFocus`).
struct ReauthForm: View {
    @Bindable var model: ReauthDialogModel
    let onCancel: () -> Void
    let onSubmit: () -> Void
    @FocusState private var fieldFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let message = model.inlineErrorMessage {
                ReauthInlineError(message: message)
            }
            Text(verbatim: model.bodyText)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            if model.isCredentialMode {
                credentialSection
            } else {
                confirmSection
            }
            if let error = model.errorMessage {
                ReauthErrorText(message: error)
            }
            ReauthFooter(
                cancelLabel: ReauthStrings.string("sudo.cancel", "Cancel"),
                submitLabel: model.submitTitle,
                submitting: model.submitting,
                onCancel: onCancel,
                onSubmit: onSubmit
            )
        }
        .onAppear { fieldFocused = true }
        .onChange(of: model.activeTab) { _, _ in fieldFocused = true }
    }

    /// The forward-auth credential fork: the method tabs (when more than one), the active field, and the
    /// helper line.
    @ViewBuilder
    private var credentialSection: some View {
        if model.methods.count > 1 {
            ReauthMethodTabs(model: model)
        }
        if model.activeTab == .password {
            ReauthSecureField(
                text: $model.password,
                label: model.fieldLabel(for: .password),
                disabled: model.submitting,
                focus: $fieldFocused,
                onSubmit: onSubmit
            )
        } else {
            ReauthNumericField(
                text: totpBinding,
                label: model.fieldLabel(for: .totp),
                disabled: model.submitting,
                focus: $fieldFocused,
                onSubmit: onSubmit
            )
        }
        Text(verbatim: model.helperText)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The open-mode confirm fork: the typed-confirmation field.
    private var confirmSection: some View {
        ReauthTextField(
            text: $model.confirmText,
            label: model.confirmFieldLabel,
            disabled: model.submitting,
            focus: $fieldFocused,
            onSubmit: onSubmit
        )
    }

    /// Routes TOTP edits through the model's sanitiser (web `replace(/\D/g,'').slice(0,8)`).
    private var totpBinding: Binding<String> {
        Binding(
            get: { model.totp },
            set: { model.updateTOTP($0) }
        )
    }
}

// MARK: - Method tabs (web `Tabs`)

/// The Password / Authenticator selector — the verbatim-titled native parity of the web `Tabs`. Built
/// in-surface (rather than the shared `TSTabs`, whose `LocalizedStringKey` API can't resolve the
/// per-surface i18n table) so titles render through the P1/S10 facade with no double-localization.
struct ReauthMethodTabs: View {
    @Bindable var model: ReauthDialogModel

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(model.methods) { method in
                tab(method)
            }
        }
        .padding(TSSpacing.xs)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(ReauthStrings.text("sudo.tabs.label", "Reauth method"))
    }

    private func tab(_ method: ReauthMethod) -> some View {
        let selected = method == model.activeTab
        return Button {
            model.selectMethod(method)
        } label: {
            Text(verbatim: model.methodLabel(for: method))
                .font(Font.TS.bodySm)
                .fontWeight(selected ? .semibold : .regular)
                .foregroundStyle(selected ? Color.white : Color.TS.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.sm)
                .background(selected ? Color.TS.accent : Color.clear, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.methodTabAccessibilityLabel(for: method)))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Fields (web `<Input>`)

/// A masked password field (web `<Input type="password" autoComplete="current-password">`) with a
/// visible label above and the field label as its accessibility name.
struct ReauthSecureField: View {
    @Binding var text: String
    let label: String
    let disabled: Bool
    var focus: FocusState<Bool>.Binding
    let onSubmit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ReauthFieldLabel(text: label)
            SecureField(text: $text, prompt: Text(verbatim: label)) {
                Text(verbatim: label)
            }
            .labelsHidden()
            .textContentType(.password)
            .focused(focus)
            .submitLabel(.continue)
            .onSubmit(onSubmit)
            .disabled(disabled)
            .modifier(ReauthFieldChrome())
            .accessibilityLabel(Text(verbatim: label))
        }
    }
}

/// A numeric one-time-code field (web `<Input inputMode="numeric" autoComplete="one-time-code">`). The
/// bound value is sanitised upstream by the model, so this only presents the field + numeric keyboard.
struct ReauthNumericField: View {
    @Binding var text: String
    let label: String
    let disabled: Bool
    var focus: FocusState<Bool>.Binding
    let onSubmit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ReauthFieldLabel(text: label)
            TextField(text: $text, prompt: Text(verbatim: label)) {
                Text(verbatim: label)
            }
            .labelsHidden()
            .textContentType(.oneTimeCode)
            .reauthNumericKeyboard()
            .focused(focus)
            .submitLabel(.continue)
            .onSubmit(onSubmit)
            .disabled(disabled)
            .modifier(ReauthFieldChrome())
            .accessibilityLabel(Text(verbatim: label))
        }
    }
}

/// A plain single-line text field (web `<Input type="text" autoComplete="off">`) for the typed
/// confirmation.
struct ReauthTextField: View {
    @Binding var text: String
    let label: String
    let disabled: Bool
    var focus: FocusState<Bool>.Binding
    let onSubmit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ReauthFieldLabel(text: label)
            TextField(text: $text, prompt: Text(verbatim: label)) {
                Text(verbatim: label)
            }
            .labelsHidden()
            .reauthNoAutocapitalization()
            .autocorrectionDisabled(true)
            .focused(focus)
            .submitLabel(.continue)
            .onSubmit(onSubmit)
            .disabled(disabled)
            .modifier(ReauthFieldChrome())
            .accessibilityLabel(Text(verbatim: label))
        }
    }
}

// MARK: - Footer (web Cancel + submit)

/// The form footer: the ghost Cancel (disabled while submitting) and the primary submit action
/// (Continue in confirm mode, Confirm in credential mode), which shows a spinner while in flight.
struct ReauthFooter: View {
    let cancelLabel: String
    let submitLabel: String
    let submitting: Bool
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
            .accessibilityLabel(Text(verbatim: submitLabel))
        }
    }
}

// MARK: - Field helpers

/// A form field's visible label (web `<Input label>`), styled as a token label.
struct ReauthFieldLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The submit-error line under the form (web `<ErrorText>`).
struct ReauthErrorText: View {
    let message: String

    var body: some View {
        Text(verbatim: message)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.statusDanger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(Text(verbatim: message))
    }
}

/// Shared field chrome: token surface + rounded border (web `<Input>` box).
private struct ReauthFieldChrome: ViewModifier {
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
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

extension View {
    /// Applies the numeric keypad on iOS/iPadOS; a no-op on macOS where `keyboardType` is unavailable.
    @ViewBuilder
    func reauthNumericKeyboard() -> some View {
        #if os(iOS)
            keyboardType(.numberPad)
        #else
            self
        #endif
    }

    /// Disables autocapitalization on iOS/iPadOS; a no-op on macOS where the modifier is unavailable.
    @ViewBuilder
    func reauthNoAutocapitalization() -> some View {
        #if os(iOS)
            textInputAutocapitalization(.never)
        #else
            self
        #endif
    }
}

// MARK: - Localization Text helper

extension ReauthStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
