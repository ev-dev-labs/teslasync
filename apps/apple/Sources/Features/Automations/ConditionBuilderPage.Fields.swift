//
//  ConditionBuilderPage.Fields.swift
//  TeslaSync — P7 page · automations/ConditionBuilder (Apple)
//
//  The per-condition editor card (web per-condition `GlassPanel` row) and the four per-kind field
//  groups (web `ConditionFields` switch: signal / time-window / geofence / other-automation). Each
//  group is a controlled editor bound to the page model: it reads the row's condition and routes
//  every edit back through `model.updateBody` / `model.changeKind`, reusing the pure
//  `ConditionBuilderAdapter` transforms so the produced payload matches the web byte-for-byte. The
//  geofence group renders the multi-state geofence picker bound to the reused `useGeofences` feed.
//

import SwiftUI

// MARK: - Condition card (web per-condition GlassPanel row)

/// One condition editor card (web `conditions.map(...) → <GlassPanel>`): the condition-type select
/// (labeled only on the first row, web `index === 0`), the kind-specific fields, and the remove
/// affordance. This is the page's single named panel — **GlassPanel1**.
struct ConditionBuilderPageCard: View {
    let model: ConditionBuilderPageModel
    let row: AutomationConditionInput
    let index: Int

    private var isFirst: Bool {
        index == 0
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                kindPicker
                ConditionBuilderPageFields(model: model, row: row)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            removeButton
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: rowLabel))
    }

    private var rowLabel: String {
        "\(ConditionBuilderPageStrings.localize("a11y.conditionBuilder.condition", "Condition")) \(index + 1)"
    }

    private var kindPicker: some View {
        ConditionBuilderPagePicker(
            labelKey: isFirst ? "automations.builder.conditionType" : nil,
            labelFallback: "Condition Type",
            accessibilityKey: "automations.builder.conditionType",
            accessibilityFallback: "Condition Type",
            options: kindOptions,
            selection: kindBinding,
            maxWidth: 224
        )
    }

    private var removeButton: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { model.removeCondition(id: row.id) },
            label: {
                Image(systemName: "trash")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
            }
        )
        .padding(.top, isFirst ? TSSpacing.x2xl : 0)
        .accessibilityLabel(
            Text(verbatim: ConditionBuilderPageStrings.localize(
                "automations.builder.removeCondition",
                "Remove condition"
            ))
        )
    }

    private var kindOptions: [ConditionBuilderPageOption<AutomationConditionKind>] {
        AutomationConditionKind.allCases.map { kind in
            ConditionBuilderPageOption(tag: kind, label: ConditionBuilderPageStrings.localize(kind.label))
        }
    }

    private var kindBinding: Binding<AutomationConditionKind> {
        Binding(
            get: { row.body.kind },
            set: { model.changeKind(id: row.id, to: $0) }
        )
    }
}

// MARK: - Dispatcher (web ConditionFields switch)

/// Renders the field group for the row's condition kind (web `ConditionFields`).
struct ConditionBuilderPageFields: View {
    let model: ConditionBuilderPageModel
    let row: AutomationConditionInput

    var body: some View {
        switch row.body {
        case let .signal(condition):
            ConditionBuilderPageSignalFields(model: model, rowID: row.id, condition: condition)
        case let .timeWindow(condition):
            ConditionBuilderPageTimeWindowFields(model: model, rowID: row.id, condition: condition)
        case let .geofence(condition):
            ConditionBuilderPageGeofenceFields(model: model, rowID: row.id, condition: condition)
        case let .otherAutomation(condition):
            ConditionBuilderPageOtherAutomationFields(model: model, rowID: row.id, condition: condition)
        }
    }
}

// MARK: - Time-window condition (web `case 'condition_time_window'`)

/// The time-window editor: start + end time, timezone, and the day-of-week toggles.
struct ConditionBuilderPageTimeWindowFields: View {
    let model: ConditionBuilderPageModel
    let rowID: AutomationConditionInput.ID
    let condition: TimeWindowCondition

    var body: some View {
        ConditionBuilderPageFieldRow {
            ConditionBuilderPageTextField(
                labelKey: "automations.builder.startTime",
                labelFallback: "Start",
                promptFallback: "06:00",
                value: startBinding,
                maxWidth: 110
            )
            ConditionBuilderPageTextField(
                labelKey: "automations.builder.endTime",
                labelFallback: "End",
                promptFallback: "09:00",
                value: endBinding,
                maxWidth: 110
            )
            ConditionBuilderPagePicker(
                labelKey: "automations.builder.timezone",
                labelFallback: "Timezone",
                accessibilityKey: "automations.builder.timezone",
                accessibilityFallback: "Timezone",
                options: ConditionBuilderAdapter.timezones.map {
                    ConditionBuilderPageOption(tag: $0.value, label: ConditionBuilderPageStrings.localize($0.label))
                },
                selection: timezoneBinding,
                maxWidth: 200
            )
            daysPicker
        }
    }

    private var daysPicker: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ConditionBuilderPageFieldLabel(key: "automations.builder.days", fallback: "Days")
            HStack(spacing: TSSpacing.xs) {
                ForEach(0 ..< ConditionBuilderAdapter.dayShortNames.count, id: \.self) { day in
                    ConditionBuilderPageDayToggle(
                        dayIndex: day,
                        isActive: condition.daysOfWeek.contains(day)
                    ) {
                        var next = condition
                        next.daysOfWeek = ConditionBuilderAdapter.toggleDay(condition.daysOfWeek, day)
                        model.updateBody(id: rowID, .timeWindow(next))
                    }
                }
            }
        }
    }

    private var startBinding: Binding<String> {
        Binding(
            get: { condition.startTime },
            set: { var next = condition; next.startTime = $0; model.updateBody(id: rowID, .timeWindow(next)) }
        )
    }

    private var endBinding: Binding<String> {
        Binding(
            get: { condition.endTime },
            set: { var next = condition; next.endTime = $0; model.updateBody(id: rowID, .timeWindow(next)) }
        )
    }

    private var timezoneBinding: Binding<String> {
        Binding(
            get: { ConditionBuilderAdapter.timezoneSelection(condition.timezone) },
            set: { var next = condition; next.timezone = $0; model.updateBody(id: rowID, .timeWindow(next)) }
        )
    }
}

// MARK: - Geofence condition (web `case 'condition_geofence'`)

/// The geofence editor: the multi-state geofence picker + the geofence state select.
struct ConditionBuilderPageGeofenceFields: View {
    let model: ConditionBuilderPageModel
    let rowID: AutomationConditionInput.ID
    let condition: GeofenceCondition

    var body: some View {
        ConditionBuilderPageFieldRow {
            ConditionBuilderPageGeofencePicker(placeId: placeIdBinding, geofences: model.geofences)
            ConditionBuilderPagePicker(
                labelKey: "automations.builder.state",
                labelFallback: "State",
                accessibilityKey: "automations.builder.state",
                accessibilityFallback: "State",
                options: AutomationGeofenceState.allCases.map {
                    ConditionBuilderPageOption(tag: $0, label: ConditionBuilderPageStrings.localize($0.label))
                },
                selection: stateBinding,
                maxWidth: 130
            )
        }
    }

    private var placeIdBinding: Binding<Int> {
        Binding(
            get: { condition.placeId },
            set: { model.updateBody(id: rowID, .geofence(GeofenceCondition(placeId: $0, state: condition.state))) }
        )
    }

    private var stateBinding: Binding<AutomationGeofenceState> {
        Binding(
            get: { condition.state },
            set: { model.updateBody(id: rowID, .geofence(GeofenceCondition(placeId: condition.placeId, state: $0))) }
        )
    }
}

// MARK: - Other-automation condition (web `case 'condition_other_automation'`)

/// The other-automation editor: the automation id + the tracked state select.
struct ConditionBuilderPageOtherAutomationFields: View {
    let model: ConditionBuilderPageModel
    let rowID: AutomationConditionInput.ID
    let condition: OtherAutomationCondition

    var body: some View {
        ConditionBuilderPageFieldRow {
            ConditionBuilderPageTextField(
                labelKey: "automations.builder.otherAutomationId",
                labelFallback: "Automation ID",
                promptFallback: "1",
                value: idBinding,
                numeric: true,
                maxWidth: 160
            )
            ConditionBuilderPagePicker(
                labelKey: "automations.builder.state",
                labelFallback: "State",
                accessibilityKey: "automations.builder.state",
                accessibilityFallback: "State",
                options: AutomationOtherAutomationState.allCases.map {
                    ConditionBuilderPageOption(tag: $0, label: ConditionBuilderPageStrings.localize($0.label))
                },
                selection: stateBinding,
                maxWidth: 180
            )
        }
    }

    /// Web `value={other_automation_id || ''}` + `parseInt(value, 10) || 0`.
    private var idBinding: Binding<String> {
        Binding(
            get: { condition.otherAutomationId == 0 ? "" : String(condition.otherAutomationId) },
            set: {
                model.updateBody(
                    id: rowID,
                    .otherAutomation(OtherAutomationCondition(
                        otherAutomationId: ConditionBuilderAdapter.parseIntOrZero($0),
                        state: condition.state
                    ))
                )
            }
        )
    }

    private var stateBinding: Binding<AutomationOtherAutomationState> {
        Binding(
            get: { condition.state },
            set: {
                model.updateBody(
                    id: rowID,
                    .otherAutomation(OtherAutomationCondition(
                        otherAutomationId: condition.otherAutomationId, state: $0
                    ))
                )
            }
        )
    }
}
