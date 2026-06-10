//
//  VehicleCommandCenter.Dialogs.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  The command dialogs presented by `VehicleCommandCenter` — the native parity of the
//  web `CommandInputDialog` / `CommandSelectDialog` / `CommandConfirmDialog`. Each is a
//  HIG-native sheet: the input dialog collects the command's field(s), the select dialog
//  offers the COP-temp style choices, and the confirm dialog gates a dangerous command
//  behind an optional countdown + typed confirmation. All bind back to
//  `VehicleCommandCenterModel` (P1/S8); no networking lives here.
//

import SwiftUI

// MARK: - Dialog router

/// Routes the active dialog request to the matching sheet body (web `activeDialog?.kind`).
struct VCCCommandDialog: View {
    let request: VCCDialogRequest
    let model: VehicleCommandCenterModel

    var body: some View {
        switch request.kind {
        case .input:
            VCCInputDialog(command: request.command, model: model)
        case .select:
            VCCSelectDialog(command: request.command, model: model)
        case .confirm:
            VCCConfirmDialog(command: request.command, model: model)
        }
    }
}

// MARK: - Shared chrome

/// A sheet scaffold shared by the dialogs: a navigation title, a Cancel toolbar button,
/// and a leading prompt line.
private struct VCCDialogScaffold<Content: View>: View {
    let titleKey: String
    let titleFallback: String
    let promptKey: String
    let promptFallback: String
    let onCancel: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                Text(verbatim: VehicleCommandCenterStrings.string(promptKey, promptFallback))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                content()
                Spacer(minLength: 0)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
            .navigationTitle(Text(verbatim: VehicleCommandCenterStrings.string(titleKey, titleFallback)))
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(action: onCancel) {
                            VehicleCommandCenterStrings.text("commands.dialog.cancel", "Cancel")
                        }
                        .accessibilityLabel(VehicleCommandCenterStrings.text("commands.dialog.cancel", "Cancel"))
                    }
                }
        }
        #if os(macOS)
        .frame(minWidth: 360, minHeight: 240)
        #endif
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Input dialog (web `CommandInputDialog`)

/// Collects the command's input field(s) and dispatches on submit (web `handleInputSubmit`).
struct VCCInputDialog: View {
    let command: VehicleCommand
    let model: VehicleCommandCenterModel

    @State private var values: [String: String]
    private let fields: [VCCInputField]
    private let config: VCCInputConfig

    init(command: VehicleCommand, model: VehicleCommandCenterModel) {
        self.command = command
        self.model = model
        guard case let .input(config) = command.dialog else {
            config = VCCInputConfig(promptKey: "", promptFallback: "", paramName: "")
            fields = []
            _values = State(initialValue: [:])
            return
        }
        self.config = config
        let resolved = config.resolvedFields()
        fields = resolved
        var seed: [String: String] = [:]
        for field in resolved {
            seed[field.name] = (config.paramName == field.name ? config.defaultValue : nil) ?? ""
        }
        _values = State(initialValue: seed)
    }

    var body: some View {
        VCCDialogScaffold(
            titleKey: command.labelKey,
            titleFallback: command.labelFallback,
            promptKey: config.promptKey,
            promptFallback: config.promptFallback,
            onCancel: { model.cancelDialog() },
            content: {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(fields) { field in
                        fieldRow(field)
                    }
                    submitButton
                }
            }
        )
    }

    private func fieldRow(_ field: VCCInputField) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: VehicleCommandCenterStrings.string(field.labelKey, field.labelFallback))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            TextField(
                text: binding(for: field.name),
                prompt: field.hint.map { Text(verbatim: $0) }
            ) {
                Text(verbatim: VehicleCommandCenterStrings.string(field.labelKey, field.labelFallback))
            }
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .padding(TSSpacing.sm)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            #if os(iOS)
            .keyboardType(field.keyboard.uiKeyboard)
            #endif
            .accessibilityLabel(Text(verbatim: VehicleCommandCenterStrings.string(field.labelKey, field.labelFallback)))
        }
    }

    private var submitButton: some View {
        TSButton(
            VehicleCommandCenterStrings.localizedKey("commands.dialog.send", "Send"),
            variant: .primary,
            isLoading: model.isBusy
        ) {
            model.submitInput(values)
        }
        .disabled(!canSubmit)
        .accessibilityLabel(VehicleCommandCenterStrings.text("commands.dialog.send", "Send"))
    }

    private var canSubmit: Bool {
        fields.allSatisfy { !(values[$0.name] ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private func binding(for name: String) -> Binding<String> {
        Binding(get: { values[name] ?? "" }, set: { values[name] = $0 })
    }
}

// MARK: - Select dialog (web `CommandSelectDialog`)

/// Offers the command's select options and dispatches the chosen value (web `handleSelectSubmit`).
struct VCCSelectDialog: View {
    let command: VehicleCommand
    let model: VehicleCommandCenterModel

    private let options: [VCCSelectOption]

    init(command: VehicleCommand, model: VehicleCommandCenterModel) {
        self.command = command
        self.model = model
        if case let .select(config) = command.dialog {
            options = config.options
        } else {
            options = []
        }
    }

    var body: some View {
        VCCDialogScaffold(
            titleKey: command.labelKey,
            titleFallback: command.labelFallback,
            promptKey: "commands.dialog.selectPrompt",
            promptFallback: "Choose an option",
            onCancel: { model.cancelDialog() },
            content: {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    ForEach(options) { option in
                        optionRow(option)
                    }
                }
            }
        )
    }

    private func optionRow(_ option: VCCSelectOption) -> some View {
        Button {
            model.submitSelect(option.value)
        } label: {
            HStack(spacing: TSSpacing.md) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: VehicleCommandCenterStrings.string(option.labelKey, option.labelFallback))
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textPrimary)
                    if let description = option.descriptionText {
                        Text(verbatim: description)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            .padding(TSSpacing.md)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: VehicleCommandCenterStrings.string(option.labelKey, option.labelFallback)))
        .accessibilityHint(option.descriptionText.map { Text(verbatim: $0) } ?? Text(verbatim: ""))
    }
}

// MARK: - Confirm dialog (web `CommandConfirmDialog`)

/// Gates a dangerous command behind an optional countdown + typed confirmation (web
/// `CommandConfirmDialog`: `confirmKey` message, `countdown`, `confirmInput`).
struct VCCConfirmDialog: View {
    let command: VehicleCommand
    let model: VehicleCommandCenterModel

    private let config: VCCConfirmConfig
    @State private var remaining: Int
    @State private var typed: String = ""
    @State private var ticker: Timer?

    init(command: VehicleCommand, model: VehicleCommandCenterModel) {
        self.command = command
        self.model = model
        config = command.confirm ?? VCCConfirmConfig(messageKey: "", messageFallback: "")
        _remaining = State(initialValue: command.confirm?.countdown ?? 0)
    }

    var body: some View {
        VCCDialogScaffold(
            titleKey: command.labelKey,
            titleFallback: command.labelFallback,
            promptKey: config.messageKey,
            promptFallback: config.messageFallback,
            onCancel: {
                stop()
                model.cancelDialog()
            },
            content: {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    if let confirmInput = config.confirmInput {
                        typedConfirmField(confirmInput)
                    }
                    confirmButton
                }
            }
        )
        .onAppear(perform: startCountdown)
        .onDisappear(perform: stop)
    }

    private func typedConfirmField(_ expected: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: VehicleCommandCenterStrings.format(
                "commands.dialog.typeToConfirm",
                "Type %@ to confirm",
                expected
            ))
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textMuted)
            TextField(text: $typed) { Text(verbatim: expected) }
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .padding(TSSpacing.sm)
                .background(
                    Color.TS.surfaceGlass,
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
                .accessibilityLabel(VehicleCommandCenterStrings.text(
                    "commands.dialog.confirmField",
                    "Confirmation text"
                ))
        }
    }

    private var confirmButton: some View {
        TSButton(
            LocalizedStringKey(confirmTitle),
            variant: .destructive,
            isLoading: model.isBusy
        ) {
            stop()
            model.confirm()
        }
        .disabled(!canConfirm)
        .accessibilityLabel(Text(verbatim: confirmTitle))
    }

    private var confirmTitle: String {
        if remaining > 0 {
            return VehicleCommandCenterStrings.format("commands.dialog.confirmCountdown", "Confirm (%d)", remaining)
        }
        return VehicleCommandCenterStrings.string("commands.dialog.confirm", "Confirm")
    }

    private var canConfirm: Bool {
        guard remaining == 0 else { return false }
        if let expected = config.confirmInput {
            return typed == expected
        }
        return true
    }

    private func startCountdown() {
        guard remaining > 0 else { return }
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            Task { @MainActor in
                if remaining > 0 { remaining -= 1 }
                if remaining == 0 { stop() }
            }
        }
    }

    private func stop() {
        ticker?.invalidate()
        ticker = nil
    }
}

// MARK: - Keyboard mapping + facade helper

#if os(iOS)
    import UIKit

    extension VCCKeyboard {
        /// The UIKit keyboard type for the field hint.
        var uiKeyboard: UIKeyboardType {
            switch self {
            case .text: .default
            case .number: .numberPad
            case .decimal: .decimalPad
            }
        }
    }
#endif

extension VehicleCommandCenterStrings {
    /// Resolves a key to a `LocalizedStringKey` carrying the resolved string, so
    /// `TSButton`'s `LocalizedStringKey` title shows the localized value.
    static func localizedKey(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(string(key, fallback))
    }
}
