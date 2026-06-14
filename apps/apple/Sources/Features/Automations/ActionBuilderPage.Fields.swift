//
//  ActionBuilderPage.Fields.swift
//  TeslaSync — P7 page · automations/ActionBuilder (Apple)
//
//  The per-action editor card (web per-action `GlassPanel` row) and the four per-kind field
//  groups (web `ActionFields` switch). Each group is a controlled editor bound to the page
//  model: it reads the row's action and routes edits back through the model's replace / update
//  mutations. The command group drives the command-params JSON validation through the model
//  (web local `paramsText` / `paramsError`, lifted into the state holder). The pure coercion +
//  option projections are reused from the module-public `ActionBuilderAdapter`.
//

import SwiftUI

// MARK: - Web i18n example-text keys (verbatim)

/// The verbatim web i18n example-text keys whose names trip the stub gate's pattern. They are
/// isolated here behind the sanctioned `parity:allow` opt-out so the field views reference
/// marker-free constant names (mirrors the P4 feature-view's `ActionBuilderPromptKeys`).
private enum ActionBuilderPagePromptKeys {
    static let commandParams = "automations.builder.commandParamsPlaceholder" // parity:allow verbatim web i18n key
    static let notify = "automations.builder.notifyPlaceholder" // parity:allow verbatim web i18n key
    static let settingKey = "automations.builder.settingKeyPlaceholder" // parity:allow verbatim web i18n key
    static let valueNumber = "automations.builder.valueNumberPlaceholder" // parity:allow verbatim web i18n key
    static let valueText = "automations.builder.valueTextPlaceholder" // parity:allow verbatim web i18n key
}

// MARK: - Action card (web per-action GlassPanel row)

/// One action editor card (web `GlassPanel` row): the numbered index, the action-type select
/// (label only on the first row), the kind-specific fields, and the move/remove controls.
struct ActionBuilderPageCard: View {
    let model: ActionBuilderPageModel
    let row: ActionBuilderPageRow
    let index: Int

    private var showTypeLabel: Bool {
        index == 0
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            indexLabel
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ActionBuilderPagePicker(
                    labelKey: showTypeLabel ? "automations.builder.actionType" : nil,
                    labelFallback: "Action Type",
                    accessibilityKey: "automations.builder.actionType",
                    accessibilityFallback: "Action Type",
                    options: typeOptions,
                    selection: kindBinding
                )
                ActionBuilderPageFields(model: model, row: row)
            }
            ActionBuilderPageRowControls(
                canMoveUp: model.canMove(id: row.id, .up),
                canMoveDown: model.canMove(id: row.id, .down),
                onMoveUp: { model.moveAction(id: row.id, .up) },
                onMoveDown: { model.moveAction(id: row.id, .down) },
                onRemove: { model.removeAction(id: row.id) }
            )
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: rowLabel))
    }

    private var rowLabel: String {
        "\(ActionBuilderPageStrings.localize("a11y.actionBuilder.action", "Action")) \(index + 1)"
    }

    private var indexLabel: some View {
        Text(verbatim: "\(index + 1).")
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textMuted)
            .padding(.top, showTypeLabel ? TSSpacing.x2xl : TSSpacing.xs)
            .accessibilityHidden(true)
    }

    private var typeOptions: [ActionBuilderPageOption<AutomationActionKind>] {
        ActionCatalog.actionTypes.map { kind in
            ActionBuilderPageOption(tag: kind, label: ActionBuilderPageStrings.localize(kind.labelKey, kind.fallback))
        }
    }

    private var kindBinding: Binding<AutomationActionKind> {
        Binding(
            get: { row.action.kind },
            set: { model.changeKind(id: row.id, to: $0) }
        )
    }
}

// MARK: - Dispatcher (web ActionFields switch)

/// Renders the field group for the row's action kind (web `ActionFields`).
struct ActionBuilderPageFields: View {
    let model: ActionBuilderPageModel
    let row: ActionBuilderPageRow

    var body: some View {
        switch row.action {
        case let .command(commandName, params):
            ActionBuilderPageCommandFields(model: model, row: row, commandName: commandName, params: params)
        case let .notify(channelID, template):
            ActionBuilderPageNotifyFields(model: model, row: row, channelID: channelID, template: template)
        case let .setSetting(settingKey, value):
            ActionBuilderPageSetSettingFields(model: model, row: row, settingKey: settingKey, value: value)
        case let .callAutomation(targetID):
            ActionBuilderPageCallFields(model: model, row: row, targetID: targetID)
        }
    }
}

// MARK: - Command (web action_command)

/// Command select + the optional JSON params editor (web `action_command`). The params text +
/// error live in the model (web local state, lifted), so the editor is fully controlled: empty
/// clears, a JSON object commits, a non-object or malformed value shows the inline error.
struct ActionBuilderPageCommandFields: View {
    let model: ActionBuilderPageModel
    let row: ActionBuilderPageRow
    let commandName: String
    let params: ActionJSON?

    private var commandOptions: [ActionBuilderPageOption<String>] {
        model.commandOptions.map { ActionBuilderPageOption(tag: $0.value, label: $0.label) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ActionBuilderPagePicker(
                labelKey: "automations.builder.command",
                labelFallback: "Command",
                accessibilityKey: "automations.builder.command",
                accessibilityFallback: "Command",
                options: commandOptions,
                selection: commandBinding
            )
            ActionBuilderPageTextArea(
                labelKey: "automations.builder.commandParams",
                labelFallback: "Params (JSON, optional)",
                promptKey: ActionBuilderPagePromptKeys.commandParams,
                promptFallback: "{\"temp\": 21}",
                value: paramsBinding,
                error: row.paramsError,
                mono: true
            )
        }
    }

    private var commandBinding: Binding<String> {
        Binding(
            get: { commandName },
            set: { model.replaceAction(id: row.id, with: .command(commandName: $0, params: params)) }
        )
    }

    private var paramsBinding: Binding<String> {
        Binding(
            get: { row.paramsText },
            set: { model.updateParams(id: row.id, text: $0) }
        )
    }
}

// MARK: - Notify (web action_notify)

/// Channel select + message editor (web `action_notify`).
struct ActionBuilderPageNotifyFields: View {
    let model: ActionBuilderPageModel
    let row: ActionBuilderPageRow
    let channelID: Int
    let template: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ActionBuilderPageChannelPicker(options: model.channelOptions, channelID: channelBinding)
            ActionBuilderPageTextArea(
                labelKey: "automations.builder.notifyMessage",
                labelFallback: "Message",
                promptKey: ActionBuilderPagePromptKeys.notify,
                promptFallback: "Car is warming up!",
                value: templateBinding
            )
        }
    }

    private var channelBinding: Binding<Int> {
        Binding(
            get: { channelID },
            set: { model.replaceAction(id: row.id, with: .notify(channelID: $0, template: template)) }
        )
    }

    private var templateBinding: Binding<String> {
        Binding(
            get: { template },
            set: { model.replaceAction(id: row.id, with: .notify(channelID: channelID, template: $0)) }
        )
    }
}

// MARK: - Set setting (web action_set_setting)

/// Setting-key input + value-type select + the value editor that flips between a True/False
/// select (boolean) and a text/number input (web `action_set_setting`).
struct ActionBuilderPageSetSettingFields: View {
    let model: ActionBuilderPageModel
    let row: ActionBuilderPageRow
    let settingKey: String
    let value: SettingValue

    private var valueKind: SettingValueKind {
        value.kind
    }

    private var valueString: String {
        ActionBuilderAdapter.displaySettingValue(value)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ActionBuilderPageTextField(
                labelKey: "automations.builder.settingKey",
                labelFallback: "Setting Key",
                promptKey: ActionBuilderPagePromptKeys.settingKey,
                promptFallback: "charge_limit",
                value: keyBinding
            )
            ActionBuilderPagePicker(
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
            ActionBuilderPagePicker(
                labelKey: "automations.builder.value",
                labelFallback: "Value",
                accessibilityKey: "automations.builder.value",
                accessibilityFallback: "Value",
                options: boolOptions,
                selection: boolBinding
            )
        } else {
            ActionBuilderPageTextField(
                labelKey: "automations.builder.value",
                labelFallback: "Value",
                promptKey: valueKind == .number
                    ? ActionBuilderPagePromptKeys.valueNumber
                    : ActionBuilderPagePromptKeys.valueText,
                promptFallback: valueKind == .number ? "80" : "enabled",
                value: valueBinding,
                numeric: valueKind == .number
            )
        }
    }

    private var keyBinding: Binding<String> {
        Binding(
            get: { settingKey },
            set: { model.replaceAction(id: row.id, with: .setSetting(key: $0, value: value)) }
        )
    }

    private var kindBinding: Binding<SettingValueKind> {
        Binding(
            get: { valueKind },
            set: {
                model.replaceAction(
                    id: row.id,
                    with: ActionBuilderAdapter.actionWithSettingValue(key: settingKey, kind: $0, value: valueString)
                )
            }
        )
    }

    private var valueBinding: Binding<String> {
        Binding(
            get: { valueString },
            set: {
                model.replaceAction(
                    id: row.id,
                    with: ActionBuilderAdapter.actionWithSettingValue(key: settingKey, kind: valueKind, value: $0)
                )
            }
        )
    }

    private var boolBinding: Binding<String> {
        Binding(
            get: { valueString },
            set: {
                model.replaceAction(
                    id: row.id,
                    with: ActionBuilderAdapter.actionWithSettingValue(key: settingKey, kind: .boolean, value: $0)
                )
            }
        )
    }

    private var valueKindOptions: [ActionBuilderPageOption<SettingValueKind>] {
        SettingValueKind.allCases.map { kind in
            ActionBuilderPageOption(tag: kind, label: ActionBuilderPageStrings.localize(kind.labelKey, kind.fallback))
        }
    }

    private var boolOptions: [ActionBuilderPageOption<String>] {
        [
            ActionBuilderPageOption(tag: "true", label: ActionBuilderPageStrings.localize("common.true", "True")),
            ActionBuilderPageOption(tag: "false", label: ActionBuilderPageStrings.localize("common.false", "False"))
        ]
    }
}

// MARK: - Call automation (web action_call_automation)

/// Target automation id number input (web `action_call_automation`). Shows empty for the 0
/// sentinel and coerces input through the JS `parseInt(...) || 0` rule.
struct ActionBuilderPageCallFields: View {
    let model: ActionBuilderPageModel
    let row: ActionBuilderPageRow
    let targetID: Int

    var body: some View {
        ActionBuilderPageTextField(
            labelKey: "automations.builder.targetAutomationId",
            labelFallback: "Target Automation ID",
            value: targetBinding,
            numeric: true
        )
    }

    private var targetBinding: Binding<String> {
        Binding(
            get: { ActionBuilderAdapter.targetIDFieldValue(targetID) },
            set: { model.replaceAction(
                id: row.id,
                with: .callAutomation(targetID: ActionBuilderAdapter.jsParseIntOrZero($0))
            ) }
        )
    }
}
