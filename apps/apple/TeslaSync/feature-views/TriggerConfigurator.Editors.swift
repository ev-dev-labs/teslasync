//
//  TriggerConfigurator.Editors.swift
//  TeslaSync — P4 feature view · 0086 · TriggerConfigurator (Apple)
//
//  The four per-kind editors the surface switches between (web `switch (trigger.kind)`):
//  the schedule editor (simple time + weekdays vs advanced cron, with the mode toggle and
//  timezone), the vehicle-event editor, the geofence editor (geofence + event + dwell), and
//  the signal-threshold editor (signal + operator + typed value + change-only). Each binds
//  to `TriggerConfiguratorModel`, reads the current trigger, and routes edits through the
//  model's web-faithful mutation methods. No networking, no literals.
//

import SwiftUI

// MARK: - Schedule editor (web `case 'trigger_schedule'`)

/// The schedule editor: simple mode (time + weekday toggles) when the cron parses, else the
/// advanced raw-cron field, plus the mode toggle and the timezone select.
struct ScheduleEditor: View {
    let model: TriggerConfiguratorModel
    let cronExpr: String
    let timezone: String

    private var schedule: SimpleSchedule? {
        CronExpression.parse(cronExpr)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let schedule {
                timeField(schedule)
                DaysToggleRow(selectedDays: schedule.days) { model.toggleScheduleDay($0) }
            } else {
                TCField(
                    labelKey: "automations.builder.cronExpr",
                    labelFallback: "Cron Expression",
                    text: Binding(get: { cronExpr }, set: { model.setScheduleCron($0) }),
                    promptKey: "automations.builder.cronPlaceholder", // parity:allow verbatim web i18n key
                    promptFallback: "0 8 * * 1-5",
                    hintKey: "automations.builder.cronHint",
                    hintFallback: "minute hour day-of-month month day-of-week"
                )
            }
            modeToggle
            TCSelectRow(
                labelKey: "automations.builder.timezone",
                labelFallback: "Timezone",
                options: TimezoneCatalog.all,
                selection: Binding(get: { timezone }, set: { model.setScheduleTimezone($0) })
            )
        }
    }

    private func timeField(_ schedule: SimpleSchedule) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: TCStrings.string("automations.builder.time", "Time"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            DatePicker(
                selection: timeBinding(hour: schedule.hour, minute: schedule.minute),
                displayedComponents: .hourAndMinute
            ) {
                EmptyView()
            }
            .labelsHidden()
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: TCStrings.string("automations.builder.time", "Time")))
        }
    }

    private var modeToggle: some View {
        let isSimple = schedule != nil
        let key = isSimple ? "automations.builder.advancedCron" : "automations.builder.simpleCron"
        let fallback = isSimple ? "Use advanced cron expression" : "Switch to simple mode"
        return Button {
            model.toggleScheduleMode()
        } label: {
            Text(verbatim: TCStrings.string(key, fallback))
                .font(Font.TS.caption)
                .underline()
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: TCStrings.string(key, fallback)))
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
struct EventEditor: View {
    let model: TriggerConfiguratorModel
    let eventType: VehicleEventType

    var body: some View {
        TCSelectRow(
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
struct GeofenceEditor: View {
    let model: TriggerConfiguratorModel
    let placeID: Int
    let event: GeofenceEvent
    let dwellMinutes: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            GeofencePickerField(
                phase: model.geofencePhase,
                geofences: model.geofences,
                isStale: model.geofencesStale,
                isOffline: model.geofencesOffline,
                selection: Binding(
                    get: { placeID > 0 ? String(placeID) : "" },
                    set: { model.setGeofencePlace(Int($0) ?? 0) }
                ),
                onRetry: { model.refreshGeofences() }
            )
            TCSelectRow(
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
                    Text(verbatim: TCStrings.string("automations.builder.dwellMinutes", "Dwell Minutes"))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textSecondary)
                    Spacer()
                    Text(verbatim: String(dwellMinutes ?? GeofenceEventCatalog.defaultDwellMinutes))
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(Color.TS.textPrimary)
                }
            }
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: TCStrings.string(
                "automations.builder.dwellMinutes", "Dwell Minutes"
            )))
            .accessibilityValue(Text(verbatim: String(dwellMinutes ?? GeofenceEventCatalog.defaultDwellMinutes)))
            Text(verbatim: TCStrings.string("automations.builder.dwellHint", "Required for dwell triggers"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Signal editor (web `case 'trigger_signal'`)

/// The signal-threshold editor: the signal select, the operator select, the typed value
/// control (boolean select / state text / numeric field) shown unless the operator is
/// `changed`, and the "Fire on any change" toggle.
struct SignalEditor: View {
    let model: TriggerConfiguratorModel
    let trigger: SignalTrigger

    private var isBool: Bool {
        SignalCatalog.boolFieldKeys.contains(trigger.signal)
    }

    private var displayValue: String {
        TriggerAdapter.displayValue(for: trigger)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TCSelectRow(
                labelKey: "automations.builder.signal",
                labelFallback: "Signal",
                options: SignalCatalog.options,
                selection: Binding(get: { trigger.signal }, set: { model.setSignal($0) })
            )
            TCSelectRow(
                labelKey: "automations.builder.operator",
                labelFallback: "Operator",
                options: SignalOperatorCatalog.all,
                selection: Binding(get: { trigger.op }, set: { model.setOperator($0) })
            )
            if trigger.op != .changed {
                valueControl
            }
            Toggle(isOn: Binding(get: { trigger.op == .changed }, set: { model.setChangedOnly($0) })) {
                Text(verbatim: TCStrings.string("automations.builder.changedOnly", "Fire on any change"))
                    .font(Font.TS.body)
            }
            .tint(Color.TS.accent)
        }
    }

    @ViewBuilder
    private var valueControl: some View {
        if isBool {
            TCSelectRow(
                labelKey: "automations.builder.value",
                labelFallback: "Value",
                options: SignalEditor.boolOptions,
                selection: Binding(get: { displayValue }, set: { model.setSignalValue($0) })
            )
        } else if trigger.signal == "state" {
            TCField(
                labelKey: "automations.builder.value",
                labelFallback: "Value",
                text: Binding(get: { displayValue }, set: { model.setSignalValue($0) }),
                promptKey: "automations.builder.statePlaceholder", // parity:allow verbatim web i18n key
                promptFallback: "online"
            )
        } else {
            TCField(
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
