//
//  ConditionBuilderPage.SignalFields.swift
//  TeslaSync — P7 page · automations/ConditionBuilder (Apple)
//
//  The signal-check editor group (web `ConditionFields` `case 'condition_signal'`) — the most
//  involved of the four condition kinds: a signal select, an operator select filtered by the
//  signal's type, and a value editor that flips between a boolean True/False select, a free-text
//  field, a numeric field, and a Min–Max range, exactly like the web. Every edit routes back through
//  `model.updateBody` reusing the pure `ConditionBuilderAdapter` coercion ladder so the produced
//  payload matches the web byte-for-byte. Split from `ConditionBuilderPage.Fields.swift` to keep each
//  source file within the project's length budget.
//

import SwiftUI

// MARK: - Web i18n example-text keys (verbatim)

/// The verbatim web i18n example-text key whose name trips the stub gate's pattern. It is isolated
/// here behind the sanctioned `parity:allow` opt-out so the field view references a marker-free
/// constant name (mirrors the P4 feature-view + the sibling `ActionBuilderPagePromptKeys`).
enum ConditionBuilderPagePromptKeys {
    static let state = "automations.builder.statePlaceholder" // parity:allow verbatim web i18n key
}

// MARK: - Signal condition (web `case 'condition_signal'`)

/// The signal-check editor: signal + operator + a value editor that adapts to the signal's type
/// (boolean select / text field / numeric field / Min–Max range).
struct ConditionBuilderPageSignalFields: View {
    let model: ConditionBuilderPageModel
    let rowID: AutomationConditionInput.ID
    let condition: SignalCondition

    private var isBool: Bool {
        ConditionBuilderAdapter.isBoolSignal(condition.signal)
    }

    private var isText: Bool {
        condition.signal == "state" || condition.op == .inList
    }

    var body: some View {
        ConditionBuilderPageFieldRow {
            signalSelect
            operatorSelect
            valueEditor
        }
    }

    private var signalSelect: some View {
        ConditionBuilderPagePicker(
            labelKey: "automations.builder.signal",
            labelFallback: "Signal",
            accessibilityKey: "automations.builder.signal",
            accessibilityFallback: "Signal",
            options: ConditionBuilderAdapter.signalFields.map {
                ConditionBuilderPageOption(tag: $0.key, label: ConditionBuilderPageStrings.localize($0.label))
            },
            selection: signalBinding,
            maxWidth: 200
        )
    }

    private var operatorSelect: some View {
        ConditionBuilderPagePicker(
            labelKey: "automations.builder.operator",
            labelFallback: "Operator",
            accessibilityKey: "automations.builder.operator",
            accessibilityFallback: "Operator",
            options: ConditionBuilderAdapter.operators(isBool: isBool).map {
                ConditionBuilderPageOption(tag: $0, label: ConditionBuilderPageStrings.localize($0.label))
            },
            selection: operatorBinding,
            maxWidth: 160
        )
    }

    @ViewBuilder
    private var valueEditor: some View {
        if condition.op == .between {
            ConditionBuilderPageNumberField(
                labelKey: "automations.builder.minValue", labelFallback: "Min", value: minBinding
            )
            ConditionBuilderPageNumberField(
                labelKey: "automations.builder.maxValue", labelFallback: "Max", value: maxBinding
            )
        } else if isBool {
            ConditionBuilderPagePicker(
                labelKey: "automations.builder.value",
                labelFallback: "Value",
                accessibilityKey: "automations.builder.value",
                accessibilityFallback: "Value",
                options: [
                    ConditionBuilderPageOption(
                        tag: true, label: ConditionBuilderPageStrings.localize("common.true", "True")
                    ),
                    ConditionBuilderPageOption(
                        tag: false, label: ConditionBuilderPageStrings.localize("common.false", "False")
                    )
                ],
                selection: boolBinding,
                maxWidth: 120
            )
        } else if isText {
            ConditionBuilderPageTextField(
                labelKey: "automations.builder.value",
                labelFallback: "Value",
                promptKey: condition.signal == "state" ? ConditionBuilderPagePromptKeys.state : "",
                promptFallback: "online",
                value: textBinding,
                maxWidth: 160
            )
        } else {
            ConditionBuilderPageNumberField(
                labelKey: "automations.builder.value", labelFallback: "Value", value: numberBinding
            )
        }
    }

    // MARK: Bindings (web `onChange` ports)

    private var signalBinding: Binding<String> {
        Binding(
            get: { condition.signal },
            set: { model.updateBody(id: rowID, .signal(ConditionBuilderAdapter.signalChanged(to: $0))) }
        )
    }

    private var operatorBinding: Binding<AutomationConditionSignalOp> {
        Binding(
            get: { condition.op },
            set: { model.updateBody(id: rowID, .signal(ConditionBuilderAdapter.operatorChanged(condition, to: $0))) }
        )
    }

    private var numberBinding: Binding<Double> {
        Binding(
            get: { ConditionBuilderAdapter.numericValue(condition.valueNum, fallback: 20) },
            set: { model.updateBody(id: rowID, .signal(ConditionBuilderAdapter.withNumber(condition, $0))) }
        )
    }

    private var minBinding: Binding<Double> {
        Binding(
            get: { ConditionBuilderAdapter.numericValue(condition.valueMin, fallback: 0) },
            set: { model.updateBody(id: rowID, .signal(ConditionBuilderAdapter.withMin(condition, $0))) }
        )
    }

    private var maxBinding: Binding<Double> {
        Binding(
            get: { ConditionBuilderAdapter.numericValue(condition.valueMax, fallback: 100) },
            set: { model.updateBody(id: rowID, .signal(ConditionBuilderAdapter.withMax(condition, $0))) }
        )
    }

    private var boolBinding: Binding<Bool> {
        Binding(
            get: { condition.valueBool ?? true },
            set: { model.updateBody(id: rowID, .signal(ConditionBuilderAdapter.withBool(condition, $0))) }
        )
    }

    private var textBinding: Binding<String> {
        Binding(
            get: { ConditionBuilderAdapter.signalValueString(condition) },
            set: { model.updateBody(
                id: rowID,
                .signal(ConditionBuilderAdapter.signalValueFromInput(condition, value: $0))
            ) }
        )
    }
}
