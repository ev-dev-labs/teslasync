//
//  CommandConfirmDialog.Views.swift
//  TeslaSync — P4 modal / dialog · 0029 · CommandConfirmDialog (Apple)
//
//  The presented panel + populated content for `CommandConfirmDialog`: the panel shell (web `Modal`
//  card, faded in inside a `TSGlassPanel`), the always-on header (red warning glyph + command label +
//  freshness chip + close), and the `.content` body — the danger-tinted message block, the optional
//  type-to-confirm field, and the Cancel / Confirm footer (the latter showing the live `(Ns)`
//  countdown + a spinner while the dispatch is in flight). The loading / empty / error envelopes + the
//  freshness chip / cached-data banner live in CommandConfirmDialog.States.swift. All copy resolves
//  through the P1/S10 facade; all chrome is token-driven (P1/S9). No web Tailwind ports live here.
//

import SwiftUI

// MARK: - Panel shell (web `Modal` card)

/// The presented dialog: the always-on header, an optional cached-data banner, and the phase body —
/// wrapped in a `TSGlassPanel` (web `Modal` surface). Every phase renders real chrome under the header
/// so the dialog is never a blank box (engineering guideline #6).
struct CommandConfirmPanel: View {
    @Bindable var model: CommandConfirmModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                CommandConfirmHeader(
                    title: model.titleText,
                    connection: model.connection,
                    closeLabel: model.closeAccessibilityLabel
                ) { model.dismiss() }
                if model.connection != .live {
                    CommandConfirmConnectivityBanner(connection: model.connection)
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
    private func body(for phase: CommandConfirmPhase) -> some View {
        switch phase {
        case .loading:
            CommandConfirmLoadingState()
        case .empty:
            CommandConfirmEmptyState()
        case let .error(message):
            CommandConfirmErrorState(message: message) { model.refresh() }
        case .content:
            CommandConfirmContent(model: model)
        }
    }
}

// MARK: - Header (web Modal title + close)

/// The dialog header: the red warning icon chip, the command label, the freshness chip, and the
/// trailing close button (web `Modal` close "×" → `onClose`).
struct CommandConfirmHeader: View {
    let title: String
    let connection: CommandConfirmConnection
    let closeLabel: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                CommandConfirmFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "exclamationmark.triangle.fill")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.statusDanger)
            .frame(width: 32, height: 32)
            .background(Color.TS.statusDanger.opacity(0.15), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.statusDanger.opacity(0.20), lineWidth: 1)
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

// MARK: - Content (web populated body)

/// The `.content` body: the inline reload error (when a refresh failed while a cached command
/// remains), the danger-tinted message block, the optional type-to-confirm field, and the Cancel /
/// Confirm footer.
struct CommandConfirmContent: View {
    @Bindable var model: CommandConfirmModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let message = model.inlineErrorMessage {
                CommandConfirmInlineError(message: message)
            }
            CommandConfirmMessagePanel(
                message: model.messageText,
                accessibilityLabel: model.messageAccessibilityLabel
            )
            if model.showsTypedInput {
                CommandConfirmTypedField(
                    label: model.typeToConfirmLabelText,
                    prompt: model.requiredTypedText,
                    accessibilityLabel: model.typedFieldAccessibilityLabel,
                    disabled: model.isBusy,
                    text: $model.typed
                )
            }
            CommandConfirmActions(
                cancelLabel: model.cancelLabelText,
                confirmLabel: model.confirmLabelText,
                busy: model.isBusy,
                confirmDisabled: model.confirmDisabled,
                countingDown: model.countdownActive,
                countdownValue: model.confirmCountdownAccessibilityValue,
                onCancel: { model.cancel() },
                onConfirm: { Task { await model.confirm() } }
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Message block (web `<p>` warning copy)

/// The danger-tinted message block (web red `AlertTriangle` glyph + the confirm copy). Read by
/// VoiceOver as one "Warning"-prefixed phrase.
struct CommandConfirmMessagePanel: View {
    let message: String
    let accessibilityLabel: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusDanger.opacity(0.10),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.30), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - Type-to-confirm field (web `Input`)

/// The type-to-confirm field (web `Input` gate): the prompt label, a text field whose inline prompt is
/// the required word, disabled while a dispatch is in flight. Bound to `model.typed`; matched
/// case-insensitively in the model.
struct CommandConfirmTypedField: View {
    let label: String
    let prompt: String
    let accessibilityLabel: String
    let disabled: Bool
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            TextField(text: $text) {
                Text(verbatim: prompt)
            }
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .autocorrectionDisabled(true)
            .commandConfirmNoAutocapitalization()
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

// MARK: - Footer (web Cancel / Confirm)

/// The footer actions: the ghost "Cancel" (web `variant="ghost"`, bound to Escape) and the solid
/// danger "Confirm" (web `variant="danger"`, bound to Return), the latter dimmed + gated while the
/// countdown ticks and showing a spinner while the dispatch is in flight.
struct CommandConfirmActions: View {
    let cancelLabel: String
    let confirmLabel: String
    let busy: Bool
    let confirmDisabled: Bool
    let countingDown: Bool
    let countdownValue: String
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .small, action: onCancel) {
                Text(verbatim: cancelLabel)
            }
            .keyboardShortcut(.cancelAction)
            .accessibilityLabel(Text(verbatim: cancelLabel))
            TSButton(variant: .destructive, size: .small, isLoading: busy, action: onConfirm) {
                Text(verbatim: confirmLabel)
            }
            .disabled(confirmDisabled)
            .opacity(countingDown ? 0.5 : 1)
            .keyboardShortcut(.defaultAction)
            .accessibilityLabel(Text(verbatim: confirmLabel))
            .accessibilityValue(Text(verbatim: countdownValue))
        }
    }
}

// MARK: - Localization Text helper

extension CommandConfirmStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

private extension View {
    /// Disables autocapitalization where the platform supports it (iOS), a no-op on macOS, so the
    /// type-to-confirm field never alters the exact word the user types.
    @ViewBuilder
    func commandConfirmNoAutocapitalization() -> some View {
        #if os(iOS)
            textInputAutocapitalization(.never)
        #else
            self
        #endif
    }
}
