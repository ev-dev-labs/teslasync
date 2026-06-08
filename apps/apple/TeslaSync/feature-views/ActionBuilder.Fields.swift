//
//  ActionBuilder.Fields.swift
//  TeslaSync — P4 feature view · 0080 · ActionBuilder (Apple)
//
//  The four per-kind field groups (web `ActionFields` switch) plus the dispatcher that
//  picks one by `action.kind`. Each group is a controlled editor: it reads the current
//  action and hands a fresh `AutomationAction` back via `onChange` (the host model's
//  `replaceAction`). The command group reproduces the web JSON-params local state +
//  validation effect; the others map 1:1 to the web `Select`/`Input`/`Textarea` inputs.
//

import SwiftUI

// MARK: - Web i18n example-text keys

/// The verbatim web i18n keys whose names end in the marker the stub gate flags. They
/// are isolated here behind the sanctioned `parity:allow` opt-out so the field views
/// reference marker-free constant names.
enum ActionBuilderPromptKeys {
    static let commandParams = "automations.builder.commandParamsPlaceholder" // parity:allow verbatim web i18n key
    static let settingKey = "automations.builder.settingKeyPlaceholder" // parity:allow verbatim web i18n key
    static let notify = "automations.builder.notifyPlaceholder" // parity:allow verbatim web i18n key
    static let valueNumber = "automations.builder.valueNumberPlaceholder" // parity:allow verbatim web i18n key
    static let valueText = "automations.builder.valueTextPlaceholder" // parity:allow verbatim web i18n key
}

// MARK: - Dispatcher (web ActionFields switch)

/// Renders the field group for the action's kind (web `ActionFields`). The host
/// supplies the channel options + the `onChange` that replaces the action.
struct ActionFields: View {
    let action: AutomationAction
    let channelOptions: [ChannelOption]
    let onChange: (AutomationAction) -> Void

    var body: some View {
        switch action {
        case let .command(commandName, params):
            CommandActionFields(commandName: commandName, params: params, onChange: onChange)
        case let .notify(channelID, template):
            NotifyActionFields(
                channelID: channelID,
                template: template,
                channelOptions: channelOptions,
                onChange: onChange
            )
        case let .setSetting(settingKey, value):
            SetSettingActionFields(settingKey: settingKey, value: value, onChange: onChange)
        case let .callAutomation(targetID):
            CallAutomationActionFields(targetID: targetID, onChange: onChange)
        }
    }
}

// MARK: - Command (web action_command)

/// Command select + the optional JSON params editor (web `action_command`). The params
/// text + error are local state seeded from `command_params` (web `useEffect`), and the
/// editor validates on edit: empty clears, a JSON object commits, a non-object or
/// malformed text shows the matching inline error without committing.
struct CommandActionFields: View {
    let commandName: String
    let params: ActionJSON?
    let onChange: (AutomationAction) -> Void

    @State private var paramsText = ""
    @State private var paramsError: String?

    private var commandOptions: [ActionLabeledOption<String>] {
        ActionBuilderAdapter.commandOptions(localize: ActionBuilderStrings.localize)
            .map { ActionLabeledOption(tag: $0.value, label: $0.label) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ActionLabeledPicker(
                labelKey: "automations.builder.command",
                labelFallback: "Command",
                accessibilityKey: "automations.builder.command",
                accessibilityFallback: "Command",
                options: commandOptions,
                selection: commandBinding
            )
            ActionTextAreaRow(
                labelKey: "automations.builder.commandParams",
                labelFallback: "Params (JSON, optional)",
                promptKey: ActionBuilderPromptKeys.commandParams,
                promptFallback: "{\"temp\": 21}",
                value: paramsBinding,
                error: paramsError,
                mono: true
            )
        }
        .onChange(of: params, initial: true) { _, _ in seedParams() }
    }

    private var commandBinding: Binding<String> {
        Binding(
            get: { commandName },
            set: { onChange(.command(commandName: $0, params: params)) }
        )
    }

    private var paramsBinding: Binding<String> {
        Binding(get: { paramsText }, set: { handleParamsChange($0) })
    }

    private func seedParams() {
        paramsText = ActionBuilderAdapter.commandParamsSeed(params)
        paramsError = nil
    }

    private func handleParamsChange(_ newText: String) {
        paramsText = newText
        guard !newText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            paramsError = nil
            onChange(.command(commandName: commandName, params: nil))
            return
        }
        do {
            let parsed = try ActionJSONParser.parse(newText)
            guard parsed.isObject else {
                paramsError = ActionBuilderStrings.string(
                    "automations.builder.commandParamsObjectError",
                    "Params must be a JSON object."
                )
                return
            }
            paramsError = nil
            onChange(.command(commandName: commandName, params: parsed))
        } catch {
            paramsError = ActionBuilderStrings.string("automations.builder.invalidJson", "Invalid JSON")
        }
    }
}

// MARK: - Notify (web action_notify)

/// Channel select + message editor (web `action_notify`).
struct NotifyActionFields: View {
    let channelID: Int
    let template: String
    let channelOptions: [ChannelOption]
    let onChange: (AutomationAction) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ActionChannelPicker(options: channelOptions, channelID: channelBinding)
            ActionTextAreaRow(
                labelKey: "automations.builder.notifyMessage",
                labelFallback: "Message",
                promptKey: ActionBuilderPromptKeys.notify,
                promptFallback: "Car is warming up!",
                value: templateBinding
            )
        }
    }

    private var channelBinding: Binding<Int> {
        Binding(
            get: { channelID },
            set: { onChange(.notify(channelID: $0, template: template)) }
        )
    }

    private var templateBinding: Binding<String> {
        Binding(
            get: { template },
            set: { onChange(.notify(channelID: channelID, template: $0)) }
        )
    }
}

// MARK: - Set setting (web action_set_setting)

/// Setting-key input + value-type select + the value editor that flips between a
/// True/False select (boolean) and a text/number input (web `action_set_setting`).
struct SetSettingActionFields: View {
    let settingKey: String
    let value: SettingValue
    let onChange: (AutomationAction) -> Void

    private var valueKind: SettingValueKind {
        value.kind
    }

    private var valueString: String {
        ActionBuilderAdapter.displaySettingValue(value)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ActionTextRow(
                labelKey: "automations.builder.settingKey",
                labelFallback: "Setting Key",
                promptKey: ActionBuilderPromptKeys.settingKey,
                promptFallback: "charge_limit",
                value: keyBinding
            )
            ActionLabeledPicker(
                labelKey: "automations.builder.valueType",
                labelFallback: "Value Type",
                accessibilityKey: "automations.builder.valueType",
                accessibilityFallback: "Value Type",
                options: valueKindOptions,
                selection: kindBinding
            )
            valueField
        }
    }

    @ViewBuilder private var valueField: some View {
        if valueKind == .boolean {
            ActionLabeledPicker(
                labelKey: "automations.builder.value",
                labelFallback: "Value",
                accessibilityKey: "automations.builder.value",
                accessibilityFallback: "Value",
                options: boolOptions,
                selection: boolBinding
            )
        } else {
            ActionTextRow(
                labelKey: "automations.builder.value",
                labelFallback: "Value",
                promptKey: valueKind == .number ? ActionBuilderPromptKeys.valueNumber : ActionBuilderPromptKeys
                    .valueText,
                promptFallback: valueKind == .number ? "80" : "enabled",
                value: valueBinding,
                numeric: valueKind == .number
            )
        }
    }

    private var keyBinding: Binding<String> {
        Binding(
            get: { settingKey },
            set: { onChange(.setSetting(key: $0, value: value)) }
        )
    }

    private var kindBinding: Binding<SettingValueKind> {
        Binding(
            get: { valueKind },
            set: { onChange(ActionBuilderAdapter.actionWithSettingValue(key: settingKey, kind: $0, value: valueString))
            }
        )
    }

    private var valueBinding: Binding<String> {
        Binding(
            get: { valueString },
            set: { onChange(ActionBuilderAdapter.actionWithSettingValue(key: settingKey, kind: valueKind, value: $0)) }
        )
    }

    private var boolBinding: Binding<String> {
        Binding(
            get: { valueString },
            set: { onChange(ActionBuilderAdapter.actionWithSettingValue(key: settingKey, kind: .boolean, value: $0)) }
        )
    }

    private var valueKindOptions: [ActionLabeledOption<SettingValueKind>] {
        SettingValueKind.allCases.map { kind in
            ActionLabeledOption(tag: kind, label: ActionBuilderStrings.string(kind.labelKey, kind.fallback))
        }
    }

    private var boolOptions: [ActionLabeledOption<String>] {
        [
            ActionLabeledOption(tag: "true", label: ActionBuilderStrings.string("common.true", "True")),
            ActionLabeledOption(tag: "false", label: ActionBuilderStrings.string("common.false", "False"))
        ]
    }
}

// MARK: - Call automation (web action_call_automation)

/// Target automation id number input (web `action_call_automation`). Shows empty for
/// the 0 sentinel and coerces input through the JS `parseInt(...) || 0` rule.
struct CallAutomationActionFields: View {
    let targetID: Int
    let onChange: (AutomationAction) -> Void

    var body: some View {
        ActionTextRow(
            labelKey: "automations.builder.targetAutomationId",
            labelFallback: "Target Automation ID",
            value: targetBinding,
            numeric: true
        )
    }

    private var targetBinding: Binding<String> {
        Binding(
            get: { ActionBuilderAdapter.targetIDFieldValue(targetID) },
            set: { onChange(.callAutomation(targetID: ActionBuilderAdapter.jsParseIntOrZero($0))) }
        )
    }
}
