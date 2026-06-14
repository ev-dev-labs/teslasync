//
//  ConditionBuilder.Fields.swift
//  TeslaSync — P4 feature view · 0083 · ConditionBuilder (Apple)
//
//  The four per-kind field editors composed by `ConditionRowPanel` — the SwiftUI
//  parity of the web `ConditionFields` switch (signal / time-window / geofence /
//  other-automation). Each binds to its concrete condition struct and routes every
//  edit through the pure `ConditionBuilderAdapter` transforms so the produced payload
//  matches the web exactly. Fields wrap to a column on compact widths (web
//  `flex-wrap`). No networking, no Tailwind ports — shared P1/S9 tokens + components.
//

import SwiftUI

// MARK: - Wrapping field row (web `flex flex-wrap items-end`)

/// Lays its fields in a row when they fit, else stacks them — the native equivalent of
/// the web `flex-wrap` so the editor reflows on iPhone / narrow split views.
struct CBFieldRow<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .bottom, spacing: TSSpacing.md) { content() }
            VStack(alignment: .leading, spacing: TSSpacing.md) { content() }
        }
    }
}

// MARK: - Numeric field (web `<UiInput type="number">`)

/// A labeled numeric input bound to a `Double`, with the shared field chrome. The
/// visual label is hidden (the `TSLabel` above supplies it) but kept for VoiceOver.
struct CBNumberField: View {
    let label: LocalizedStringKey
    @Binding var value: Double

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel(label)
            TextField(value: $value, format: .number) { Text(label) }
                .labelsHidden()
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .monospacedDigit()
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.sm)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
                .frame(maxWidth: 120)
                .accessibilityLabel(Text(label))
        }
    }
}

// MARK: - Signal condition (web `case 'condition_signal'`)

/// The signal-check editor: signal + operator + a value editor that adapts to the
/// signal's type (boolean select / text field / numeric field / Min–Max range).
struct SignalFields: View {
    @Binding var condition: SignalCondition

    private var isBool: Bool {
        ConditionBuilderAdapter.isBoolSignal(condition.signal)
    }

    private var isText: Bool {
        condition.signal == "state" || condition.op == .inList
    }

    var body: some View {
        CBFieldRow {
            signalSelect
            operatorSelect
            valueEditor
        }
    }

    private var signalSelect: some View {
        TSSelect(
            selection: signalBinding,
            options: ConditionBuilderAdapter.signalFields.map { TSSelectOption($0.key, CBView.key($0.label)) },
            label: CBView.key("automations.builder.signal", "Signal")
        )
        .frame(maxWidth: 200)
    }

    private var operatorSelect: some View {
        TSSelect(
            selection: operatorBinding,
            options: ConditionBuilderAdapter.operators(isBool: isBool).map { TSSelectOption($0, CBView.key($0.label)) },
            label: CBView.key("automations.builder.operator", "Operator")
        )
        .frame(maxWidth: 160)
    }

    @ViewBuilder
    private var valueEditor: some View {
        if condition.op == .between {
            CBNumberField(label: CBView.key("automations.builder.minValue", "Min"), value: minBinding)
            CBNumberField(label: CBView.key("automations.builder.maxValue", "Max"), value: maxBinding)
        } else if isBool {
            TSSelect(
                selection: boolBinding,
                options: [
                    TSSelectOption(true, CBView.key("common.true", "True")),
                    TSSelectOption(false, CBView.key("common.false", "False"))
                ],
                label: CBView.key("automations.builder.value", "Value")
            )
            .frame(maxWidth: 120)
        } else if isText {
            TSTextField(
                statePrompt,
                text: textBinding,
                label: CBView.key("automations.builder.value", "Value")
            )
            .frame(maxWidth: 160)
        } else {
            CBNumberField(label: CBView.key("automations.builder.value", "Value"), value: numberBinding)
        }
    }

    private var statePrompt: LocalizedStringKey {
        condition.signal == "state"
            ? CBView.key("automations.builder.statePlaceholder", "online") // parity:allow ui
            : CBView.key(" ")
    }

    // MARK: Bindings (web `onChange` ports)

    private var signalBinding: Binding<String> {
        Binding(
            get: { condition.signal },
            set: { condition = ConditionBuilderAdapter.signalChanged(to: $0) }
        )
    }

    private var operatorBinding: Binding<AutomationConditionSignalOp> {
        Binding(
            get: { condition.op },
            set: { condition = ConditionBuilderAdapter.operatorChanged(condition, to: $0) }
        )
    }

    private var numberBinding: Binding<Double> {
        Binding(
            get: { ConditionBuilderAdapter.numericValue(condition.valueNum, fallback: 20) },
            set: { condition = ConditionBuilderAdapter.withNumber(condition, $0) }
        )
    }

    private var minBinding: Binding<Double> {
        Binding(
            get: { ConditionBuilderAdapter.numericValue(condition.valueMin, fallback: 0) },
            set: { condition = ConditionBuilderAdapter.withMin(condition, $0) }
        )
    }

    private var maxBinding: Binding<Double> {
        Binding(
            get: { ConditionBuilderAdapter.numericValue(condition.valueMax, fallback: 100) },
            set: { condition = ConditionBuilderAdapter.withMax(condition, $0) }
        )
    }

    private var boolBinding: Binding<Bool> {
        Binding(
            get: { condition.valueBool ?? true },
            set: { condition = ConditionBuilderAdapter.withBool(condition, $0) }
        )
    }

    private var textBinding: Binding<String> {
        Binding(
            get: { ConditionBuilderAdapter.signalValueString(condition) },
            set: { condition = ConditionBuilderAdapter.signalValueFromInput(condition, value: $0) }
        )
    }
}

// MARK: - Time-window condition (web `case 'condition_time_window'`)

/// The time-window editor: start + end time, timezone, and the day-of-week toggles.
struct TimeWindowFields: View {
    @Binding var condition: TimeWindowCondition

    var body: some View {
        CBFieldRow {
            TSTextField(
                CBView.key("06:00"),
                text: startBinding,
                label: CBView.key("automations.builder.startTime", "Start")
            )
            .frame(maxWidth: 110)
            TSTextField(
                CBView.key("09:00"),
                text: endBinding,
                label: CBView.key("automations.builder.endTime", "End")
            )
            .frame(maxWidth: 110)
            TSSelect(
                selection: timezoneBinding,
                options: ConditionBuilderAdapter.timezones.map { TSSelectOption($0.value, CBView.key($0.label)) },
                label: CBView.key("automations.builder.timezone", "Timezone")
            )
            .frame(maxWidth: 200)
            daysPicker
        }
    }

    private var daysPicker: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel(CBView.key("automations.builder.days", "Days"))
            HStack(spacing: TSSpacing.xs) {
                ForEach(0 ..< ConditionBuilderAdapter.dayShortNames.count, id: \.self) { day in
                    CBDayToggle(
                        dayIndex: day,
                        isActive: condition.daysOfWeek.contains(day)
                    ) {
                        condition.daysOfWeek = ConditionBuilderAdapter.toggleDay(condition.daysOfWeek, day)
                    }
                }
            }
        }
    }

    private var startBinding: Binding<String> {
        Binding(get: { condition.startTime }, set: { condition.startTime = $0 })
    }

    private var endBinding: Binding<String> {
        Binding(get: { condition.endTime }, set: { condition.endTime = $0 })
    }

    private var timezoneBinding: Binding<String> {
        Binding(
            get: { ConditionBuilderAdapter.timezoneSelection(condition.timezone) },
            set: { condition.timezone = $0 }
        )
    }
}

// MARK: - Geofence condition (web `case 'condition_geofence'`)

/// The geofence editor: the multi-state geofence picker + the geofence state select.
struct GeofenceFields: View {
    @Binding var condition: GeofenceCondition
    let geofenceModel: GeofenceOptionsModel

    var body: some View {
        CBFieldRow {
            GeofencePickerField(placeId: placeIdBinding, geofenceModel: geofenceModel)
            TSSelect(
                selection: stateBinding,
                options: AutomationGeofenceState.allCases.map { TSSelectOption($0, CBView.key($0.label)) },
                label: CBView.key("automations.builder.state", "State")
            )
            .frame(maxWidth: 130)
        }
    }

    private var placeIdBinding: Binding<Int> {
        Binding(get: { condition.placeId }, set: { condition.placeId = $0 })
    }

    private var stateBinding: Binding<AutomationGeofenceState> {
        Binding(get: { condition.state }, set: { condition.state = $0 })
    }
}

// MARK: - Other-automation condition (web `case 'condition_other_automation'`)

/// The other-automation editor: the automation id + the tracked state select.
struct OtherAutomationFields: View {
    @Binding var condition: OtherAutomationCondition

    var body: some View {
        CBFieldRow {
            TSTextField(
                CBView.key("1"),
                text: idBinding,
                label: CBView.key("automations.builder.otherAutomationId", "Automation ID")
            )
            .frame(maxWidth: 160)
            TSSelect(
                selection: stateBinding,
                options: AutomationOtherAutomationState.allCases.map { TSSelectOption($0, CBView.key($0.label)) },
                label: CBView.key("automations.builder.state", "State")
            )
            .frame(maxWidth: 180)
        }
    }

    /// Web `value={other_automation_id || ''}` + `parseInt(value, 10) || 0`.
    private var idBinding: Binding<String> {
        Binding(
            get: { condition.otherAutomationId == 0 ? "" : String(condition.otherAutomationId) },
            set: { condition.otherAutomationId = ConditionBuilderAdapter.parseIntOrZero($0) }
        )
    }

    private var stateBinding: Binding<AutomationOtherAutomationState> {
        Binding(get: { condition.state }, set: { condition.state = $0 })
    }
}
