//
//  CommandSelectDialog.Views.swift
//  TeslaSync — P4 modal / dialog · 0031 · CommandSelectDialog (Apple)
//
//  The presented panel + populated content for `CommandSelectDialog`: the panel shell (web `Modal`
//  card, faded in inside a `TSGlassPanel`), the always-on header (the command icon chip + title +
//  freshness chip + close), and the `.content` body — the optional inline reload error, the vertical
//  list of option buttons (each an already-translated label + an optional description, the tapped one
//  showing a spinner while in flight), and the trailing Cancel footer. The loading / empty / error
//  envelopes + the freshness chip / cached-data banner live in CommandSelectDialog.States.swift. All
//  copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No web Tailwind ports
//  live here.
//

import SwiftUI

// MARK: - Panel shell (web `Modal` card)

/// The presented dialog: the always-on header, an optional cached-data banner, and the phase body —
/// wrapped in a `TSGlassPanel` (web `Modal` surface, `size="sm"`). Every phase renders real chrome
/// under the header so the dialog is never a blank box (engineering guideline #6).
struct CommandSelectDialogPanel: View {
    @Bindable var model: CommandSelectModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                CommandSelectHeader(
                    iconSystemName: model.iconSystemName,
                    title: model.titleText,
                    connection: model.connection,
                    closeLabel: model.closeAccessibilityLabel
                ) { model.cancel() }
                if model.connection != .live {
                    CommandSelectConnectivityBanner(connection: model.connection)
                }
                body(for: model.phase)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: 420)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.panelAccessibilityLabel))
    }

    /// The web modal body under the header: the populated option list for `.content`, else the
    /// loading / empty / error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: CommandSelectPhase) -> some View {
        switch phase {
        case .loading:
            CommandSelectLoadingState()
        case .empty:
            CommandSelectEmptyState()
        case let .error(message):
            CommandSelectErrorState(message: message) { model.refresh() }
        case .content:
            CommandSelectContent(model: model)
        }
    }
}

// MARK: - Header (web Modal title + close)

/// The dialog header: the command icon chip, the title, the freshness chip, and the trailing close
/// button (web `Modal` close "×" → `onClose`).
struct CommandSelectHeader: View {
    let iconSystemName: String
    let title: String
    let connection: CommandSelectConnection
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
                CommandSelectFreshnessChip(connection: connection)
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
            .frame(width: 32, height: 32)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md))
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

// MARK: - Content (web populated body)

/// The `.content` body: the inline reload error (when a refresh failed while a cached request
/// remains), the vertical list of option buttons (web `sc.options.map`), and the Cancel footer.
struct CommandSelectContent: View {
    @Bindable var model: CommandSelectModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let message = model.inlineErrorMessage {
                CommandSelectInlineError(message: message)
            }
            VStack(spacing: TSSpacing.sm) {
                ForEach(model.options) { option in
                    CommandSelectOptionRow(
                        option: option,
                        busy: model.isBusy,
                        submitting: model.isSubmitting(option.value),
                        accessibilityLabel: model.optionAccessibilityLabel(option)
                    ) {
                        Task { await model.select(option.value) }
                    }
                }
            }
            footer
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The trailing Cancel footer (web `flex justify-end` with the ghost Cancel button → `onClose`).
    private var footer: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .small) {
                model.cancel()
            } label: {
                Text(verbatim: model.cancelLabelText)
            }
            .disabled(model.isBusy)
            .accessibilityLabel(Text(verbatim: model.cancelLabelText))
        }
    }
}

// MARK: - Option row (web ghost `Button`)

/// One selectable option — the native parity of the web ghost `ControlButton`: a full-width,
/// left-aligned card showing the option label (medium weight) and an optional description line, with
/// a chevron / spinner accessory. Disabled while any dispatch is in flight; the tapped option shows a
/// spinner (the parity of the web `loading` + `opacity-50 cursor-not-allowed`).
struct CommandSelectOptionRow: View {
    let option: CommandSelectOption
    let busy: Bool
    let submitting: Bool
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: option.label)
                        .font(Font.TS.body)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let description = option.description, !description.isEmpty {
                        Text(verbatim: description)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                accessory
            }
            .padding(TSSpacing.md)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .opacity(busy && !submitting ? 0.5 : 1)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder
    private var accessory: some View {
        if submitting {
            ProgressView().controlSize(.small)
        } else {
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Localization Text helper

extension CommandSelectStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
