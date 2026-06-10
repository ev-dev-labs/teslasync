//
//  ConfirmDialog.Views.swift
//  TeslaSync — P4 modal / dialog · 0012 · ConfirmDialog (Apple)
//
//  The presented panel + populated content for `ConfirmDialog`: the panel shell (web `Modal` card,
//  faded in inside a `TSGlassPanel`), the always-on header (severity icon chip + title + freshness
//  chip + close), and the `.content` body — the severity-tinted message block, the optional
//  typed-confirmation field, the optional "Don't ask again" checkbox, and the Cancel / Confirm
//  footer. The loading / empty / error envelopes + the freshness chip / cached-data banner live in
//  ConfirmDialog.States.swift. All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9). No web Tailwind ports live here.
//

import SwiftUI

// MARK: - Panel shell (web `Modal` card)

/// The presented dialog: the always-on header, an optional cached-data banner, and the phase body —
/// wrapped in a `TSGlassPanel` (web `Modal` surface). Every phase renders real chrome under the
/// header so the dialog is never a blank box (engineering guideline #6).
struct ConfirmDialogPanel: View {
    @Bindable var model: ConfirmDialogModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                ConfirmDialogHeader(
                    severity: model.severity,
                    iconSystemName: model.iconSystemName,
                    title: model.titleText,
                    connection: model.connection
                ) { model.dismiss() }
                if model.connection != .live {
                    ConfirmDialogConnectivityBanner(connection: model.connection)
                }
                body(for: model.phase)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: 420)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.panelAccessibilityLabel))
    }

    /// The web modal body under the header: the populated confirm content for `.content`, else the
    /// loading / empty / error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: ConfirmPhase) -> some View {
        switch phase {
        case .loading:
            ConfirmDialogLoadingState()
        case .empty:
            ConfirmDialogEmptyState()
        case let .error(message):
            ConfirmDialogErrorState(message: message) { model.refresh() }
        case .content:
            ConfirmDialogContent(model: model)
        }
    }
}

// MARK: - Header (web Modal title + close)

/// The dialog header: the severity icon chip, the caller title, the freshness chip, and the trailing
/// close button (web `Modal` close "×" → `handleModalClose`).
struct ConfirmDialogHeader: View {
    let severity: ConfirmSeverity
    let iconSystemName: String
    let title: String
    let connection: ConfirmConnection
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                ConfirmDialogFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: iconSystemName)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(severity.tone)
            .frame(width: 32, height: 32)
            .background(severity.tone.opacity(0.15), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(severity.tone.opacity(0.20), lineWidth: 1)
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
        .accessibilityLabel(ConfirmDialogStrings.text("confirm.close", "Close"))
    }
}

// MARK: - Content (web populated body)

/// The `.content` body: the inline reload error (when a refresh failed while a cached request
/// remains), the severity-tinted message block, the optional typed-confirmation field, the optional
/// "Don't ask again" checkbox, and the Cancel / Confirm footer.
struct ConfirmDialogContent: View {
    @Bindable var model: ConfirmDialogModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let message = model.inlineErrorMessage {
                ConfirmDialogInlineError(message: message)
            }
            ConfirmDialogMessagePanel(
                severity: model.severity,
                iconSystemName: model.iconSystemName,
                message: model.messageText,
                accessibilityLabel: model.messageAccessibilityLabel
            )
            if model.showsTypedInput {
                ConfirmDialogTypedField(
                    label: model.typedConfirmationLabelText,
                    prompt: model.requiredTypedText,
                    accessibilityLabel: model.typedFieldAccessibilityLabel,
                    disabled: model.isBusy,
                    text: $model.typed
                )
            }
            if model.showsSilenceToggle {
                ConfirmDialogSilenceToggle(
                    label: ConfirmDialogStrings.string(
                        ConfirmDialogProjection.Keys.silenceCheckbox,
                        ConfirmDialogProjection.Fallbacks.silenceCheckbox
                    ),
                    accessibilityLabel: model.silenceAccessibilityLabel,
                    disabled: model.isBusy,
                    isOn: $model.dontAskAgain
                )
            }
            ConfirmDialogActions(
                cancelLabel: model.cancelLabelText,
                confirmLabel: model.confirmLabelText,
                tone: model.severity.tone,
                busy: model.isBusy,
                submitting: model.submitting,
                confirmDisabled: model.confirmDisabled,
                onCancel: { model.cancel() },
                onConfirm: { Task { await model.confirm() } }
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Message block (web severity-tinted `<div>`)

/// The severity-tinted message block (web `div` with `tokens.bg` / `tokens.border` / `tokens.fg`
/// icon + the message). Read by VoiceOver as one severity-prefixed phrase.
struct ConfirmDialogMessagePanel: View {
    let severity: ConfirmSeverity
    let iconSystemName: String
    let message: String
    let accessibilityLabel: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: iconSystemName)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(severity.tone)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .background(
            severity.tone.opacity(0.10),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(severity.tone.opacity(0.30), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - Typed-confirmation field (web `Input`)

/// The typed-confirmation field (web `Input` gate): the caller label, a text field whose inline prompt
/// is the required string, disabled while a mutation is in flight. Bound to `model.typed`.
struct ConfirmDialogTypedField: View {
    let label: String
    let prompt: String
    let accessibilityLabel: String
    let disabled: Bool
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            TextField(text: $text) {
                Text(verbatim: prompt)
            }
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .autocorrectionDisabled(true)
            .confirmDialogNoAutocapitalization()
            .disabled(disabled)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .opacity(disabled ? 0.6 : 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - Silence toggle (web "Don't ask again" checkbox)

/// The "Don't ask again" checkbox (web `<input type="checkbox">` + label): an SF Symbol toggle with
/// the localized label, disabled while a mutation is in flight. Bound to `model.dontAskAgain`.
struct ConfirmDialogSilenceToggle: View {
    let label: String
    let accessibilityLabel: String
    let disabled: Bool
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: isOn ? "checkmark.square.fill" : "square")
                    .foregroundStyle(isOn ? Color.TS.accent : Color.TS.textMuted)
                    .imageScale(.large)
                Text(verbatim: label)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.6 : 1)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Footer (web Cancel / Confirm)

/// The footer actions: the secondary "Cancel" and the solid severity-colored "Confirm" (web
/// `Button variant=danger` / the amber `primary` override), the latter showing a spinner and
/// disabled while busy or while the typed gate is unmet.
struct ConfirmDialogActions: View {
    let cancelLabel: String
    let confirmLabel: String
    let tone: Color
    let busy: Bool
    let submitting: Bool
    let confirmDisabled: Bool
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .secondary, size: .small, action: onCancel) {
                Text(verbatim: cancelLabel)
            }
            .disabled(busy)
            .accessibilityLabel(Text(verbatim: cancelLabel))
            ConfirmDialogConfirmButton(
                title: confirmLabel,
                tone: tone,
                loading: submitting,
                disabled: confirmDisabled,
                action: onConfirm
            )
            .accessibilityLabel(Text(verbatim: confirmLabel))
        }
    }
}

/// The solid severity-colored confirm button — the native parity of the web `confirmButtonClasses`
/// override (Button's built-in `danger` for the critical case, a solid amber fill for `warning`).
/// Reproduces `TSButton`'s small-size shape while taking the severity tone as its fill, since the
/// shared button has no amber variant (the same reason the web overrides Button's styling here).
struct ConfirmDialogConfirmButton: View {
    let title: String
    let tone: Color
    let loading: Bool
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(verbatim: title)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .opacity(loading ? 0 : 1)
                if loading {
                    ProgressView().controlSize(.small).tint(.white)
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .frame(minHeight: 28)
            .background(
                tone.opacity(disabled ? 0.5 : 1),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(disabled || loading)
    }
}

// MARK: - Localization Text helper

extension ConfirmDialogStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

private extension View {
    /// Disables autocapitalization where the platform supports it (iOS), a no-op on macOS, so the
    /// typed-confirmation field never auto-capitalizes the exact string the user must match.
    @ViewBuilder
    func confirmDialogNoAutocapitalization() -> some View {
        #if os(iOS)
            textInputAutocapitalization(.never)
        #else
            self
        #endif
    }
}
