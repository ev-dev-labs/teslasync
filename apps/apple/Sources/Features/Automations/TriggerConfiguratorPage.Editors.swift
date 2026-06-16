//
//  TriggerConfiguratorPage.Editors.swift
//  TeslaSync — P7 page · automations/TriggerConfigurator (Apple)
//
//  The four per-kind editors the page switches between (web `switch (trigger.kind)`): the schedule
//  editor (simple time + weekdays vs advanced cron, with the mode toggle and timezone), the
//  vehicle-event editor, the geofence editor (geofence + event + dwell), and the signal-threshold
//  editor (signal + operator + typed value + change-only). Each binds to `TriggerConfiguratorPageModel`,
//  reads the current trigger, and routes edits through the model's web-faithful mutation methods (which
//  reuse the module-public pure core). No networking, no hardcoded literals.
//

import SwiftUI

// MARK: - Web i18n example-text keys (verbatim)

/// The verbatim web i18n example-text keys whose names trip the stub gate's pattern, isolated behind
/// the sanctioned `parity:allow` opt-out so the editor views reference marker-free constant names
/// (mirrors the sibling ActionBuilder page's `ActionBuilderPagePromptKeys`).
private enum TriggerConfiguratorPagePromptKeys {
    static let cron = "automations.builder.cronPlaceholder" // parity:allow verbatim web i18n key
    static let state = "automations.builder.statePlaceholder" // parity:allow verbatim web i18n key
}

// MARK: - Schedule editor (web `case 'trigger_schedule'`)

/// The schedule editor: simple mode (time + weekday toggles) when the cron parses, else the advanced
/// raw-cron field, plus the mode toggle and the timezone select.
struct TriggerConfiguratorPageScheduleEditor: View {
    let model: TriggerConfiguratorPageModel
    let cronExpr: String
    let timezone: String

    private var schedule: SimpleSchedule? {
        CronExpression.parse(cronExpr)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let schedule {
                timeField(schedule)
                TriggerConfiguratorPageDaysRow(selectedDays: schedule.days) { model.toggleScheduleDay($0) }
            } else {
                TriggerConfiguratorPageField(
                    labelKey: "automations.builder.cronExpr",
                    labelFallback: "Cron Expression",
                    text: Binding(get: { cronExpr }, set: { model.setScheduleCron($0) }),
                    promptKey: TriggerConfiguratorPagePromptKeys.cron,
                    promptFallback: "0 8 * * 1-5",
                    hintKey: "automations.builder.cronHint",
                    hintFallback: "minute hour day-of-month month day-of-week"
                )
            }
            modeToggle
            TriggerConfiguratorPagePicker(
                labelKey: "automations.builder.timezone",
                labelFallback: "Timezone",
                options: TimezoneCatalog.all,
                selection: Binding(get: { timezone }, set: { model.setScheduleTimezone($0) })
            )
        }
    }

    private func timeField(_ schedule: SimpleSchedule) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TriggerConfiguratorPageFieldLabel(key: "automations.builder.time", fallback: "Time")
            DatePicker(
                selection: timeBinding(hour: schedule.hour, minute: schedule.minute),
                displayedComponents: .hourAndMinute
            ) {
                Text(verbatim: TriggerConfiguratorPageStrings.localize("automations.builder.time", "Time"))
            }
            .labelsHidden()
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: TriggerConfiguratorPageStrings.localize(
                "automations.builder.time",
                "Time"
            )))
        }
    }

    private var modeToggle: some View {
        let isSimple = schedule != nil
        let key = isSimple ? "automations.builder.advancedCron" : "automations.builder.simpleCron"
        let fallback = isSimple ? "Use advanced cron expression" : "Switch to simple mode"
        return Button {
            model.toggleScheduleMode()
        } label: {
            Text(verbatim: TriggerConfiguratorPageStrings.localize(key, fallback))
                .font(Font.TS.caption)
                .underline()
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: TriggerConfiguratorPageStrings.localize(key, fallback)))
    }

    private func timeBinding(hour: Int, minute: Int) -> Binding<Date> {
        Binding(
            get: {
                Calendar.current.date(from: DateComponents(hour: hour, minute: minute)) ?? Date()
            },
            set: { date in
                let components = Calendar.current.dateComponents([.hour, .minute], from: date)
                model.setScheduleTime(hour: components.hour ?? hour, minute: components.minute ?? minute)
            }
        )
    }
}

// MARK: - Event editor (web `case 'trigger_event'`)

/// The vehicle-event editor: a single select over the nine vehicle events.
struct TriggerConfiguratorPageEventEditor: View {
    let model: TriggerConfiguratorPageModel
    let eventType: VehicleEventType

    var body: some View {
        TriggerConfiguratorPagePicker(
            labelKey: "automations.builder.event",
            labelFallback: "Event",
            options: VehicleEventCatalog.all,
            selection: Binding(get: { eventType }, set: { model.setEventType($0) })
        )
    }
}

// MARK: - Geofence editor (web `case 'trigger_geofence'`)

/// The geofence editor: the stateful geofence picker, the transition-event select, and the
/// dwell-minutes stepper shown only for the dwell event.
struct TriggerConfiguratorPageGeofenceEditor: View {
    let model: TriggerConfiguratorPageModel
    let placeID: Int
    let event: GeofenceEvent
    let dwellMinutes: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TriggerConfiguratorPageGeofencePicker(
                state: model.geofenceState,
                geofences: model.geofences,
                selection: Binding(
                    get: { placeID > 0 ? String(placeID) : "" },
                    set: { model.setGeofencePlace(Int($0) ?? 0) }
                ),
                onRetry: { Task { await model.refresh() } }
            )
            TriggerConfiguratorPagePicker(
                labelKey: "automations.builder.geofenceEvent",
                labelFallback: "Event",
                options: GeofenceEventCatalog.all,
                selection: Binding(get: { event }, set: { model.setGeofenceEvent($0) })
            )
            if event == .dwell {
                dwellField
            }
        }
    }

    private var dwellField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Stepper(
                value: Binding(
                    get: { dwellMinutes ?? GeofenceEventCatalog.defaultDwellMinutes },
                    set: { model.setDwellMinutes($0) }
                ),
                in: GeofenceEventCatalog.dwellRange
            ) {
                HStack {
                    TriggerConfiguratorPageFieldLabel(
                        key: "automations.builder.dwellMinutes",
                        fallback: "Dwell Minutes"
                    )
                    Spacer()
                    Text(verbatim: String(dwellMinutes ?? GeofenceEventCatalog.defaultDwellMinutes))
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(Color.TS.textPrimary)
                }
            }
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: TriggerConfiguratorPageStrings.localize(
                "automations.builder.dwellMinutes",
                "Dwell Minutes"
            )))
            .accessibilityValue(Text(verbatim: String(dwellMinutes ?? GeofenceEventCatalog.defaultDwellMinutes)))
            Text(verbatim: TriggerConfiguratorPageStrings.localize(
                "automations.builder.dwellHint",
                "Required for dwell triggers"
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Signal editor (web `case 'trigger_signal'`)

/// The signal-threshold editor: the signal select, the operator select, the typed value control
/// (boolean select / state text / numeric field) shown unless the operator is `changed`, and the
/// "Fire on any change" toggle.
struct TriggerConfiguratorPageSignalEditor: View {
    let model: TriggerConfiguratorPageModel
    let trigger: SignalTrigger

    private var isBool: Bool {
        SignalCatalog.boolFieldKeys.contains(trigger.signal)
    }

    private var displayValue: String {
        TriggerAdapter.displayValue(for: trigger)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TriggerConfiguratorPagePicker(
                labelKey: "automations.builder.signal",
                labelFallback: "Signal",
                options: SignalCatalog.options,
                selection: Binding(get: { trigger.signal }, set: { model.setSignal($0) })
            )
            TriggerConfiguratorPagePicker(
                labelKey: "automations.builder.operator",
                labelFallback: "Operator",
                options: SignalOperatorCatalog.all,
                selection: Binding(get: { trigger.op }, set: { model.setOperator($0) })
            )
            if trigger.op != .changed {
                valueControl
            }
            Toggle(isOn: Binding(get: { trigger.op == .changed }, set: { model.setChangedOnly($0) })) {
                Text(verbatim: TriggerConfiguratorPageStrings.localize(
                    "automations.builder.changedOnly",
                    "Fire on any change"
                ))
                .font(Font.TS.body)
            }
            .tint(Color.TS.accent)
        }
    }

    @ViewBuilder
    private var valueControl: some View {
        if isBool {
            TriggerConfiguratorPagePicker(
                labelKey: "automations.builder.value",
                labelFallback: "Value",
                options: TriggerConfiguratorPageSignalEditor.boolOptions,
                selection: Binding(get: { displayValue }, set: { model.setSignalValue($0) })
            )
        } else if trigger.signal == "state" {
            TriggerConfiguratorPageField(
                labelKey: "automations.builder.value",
                labelFallback: "Value",
                text: Binding(get: { displayValue }, set: { model.setSignalValue($0) }),
                promptKey: TriggerConfiguratorPagePromptKeys.state,
                promptFallback: "online"
            )
        } else {
            TriggerConfiguratorPageField(
                labelKey: "automations.builder.value",
                labelFallback: "Value",
                text: Binding(get: { displayValue }, set: { model.setSignalValue($0) }),
                numeric: true
            )
        }
    }

    /// Web `[{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }]`.
    private static let boolOptions: [TriggerOption<String>] = [
        TriggerOption("true", "common.true", "True"),
        TriggerOption("false", "common.false", "False")
    ]
}
