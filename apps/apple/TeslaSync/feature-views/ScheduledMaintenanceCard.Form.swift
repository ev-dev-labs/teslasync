//
//  ScheduledMaintenanceCard.Form.swift
//  TeslaSync — P4 feature view · 0251 · ScheduledMaintenanceCard (Apple)
//
//  The inline schedule form — the native mirror of the web `handleSchedule` form: a start picker
//  (web `<Input type="datetime-local">` → native `DatePicker`), a duration field (web number input,
//  min 5 / max 1440), an optional message field (web text input, maxLength 500), and the Cancel /
//  Schedule actions. The fields bind to the card's transient `@State`; submission routes through
//  `ScheduledMaintenanceModel.schedule(...)`. VoiceOver labels + hints replace the web `useId`
//  `htmlFor` label associations.
//

import SwiftUI

// MARK: - Schedule form (web inline `<form onSubmit={handleSchedule}>`)

/// The inline scheduling form revealed under "Schedule a window". Native primitives per Apple HIG
/// (a `DatePicker` for the start, numeric + text fields for duration + message) styled with P1/S9
/// tokens; every control carries a VoiceOver label + hint.
struct ScheduledMaintenanceFormView: View {
    @Binding var startDate: Date
    @Binding var durationText: String
    @Binding var message: String
    let isMutating: Bool
    let onSchedule: () -> Void
    let onCancel: () -> Void

    /// Web `maxLength={500}` on the message input.
    private let messageLimit = 500

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Divider().overlay(Color.TS.border)
            startField
            durationField
            messageField
            actions
        }
        .padding(.top, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Fields

    private var startField: some View {
        let label = ScheduledMaintenanceStrings.string("scheduled.field.start", "Start (local)")
        return VStack(alignment: .leading, spacing: TSSpacing.xs) {
            fieldLabel(label)
            DatePicker(
                "",
                selection: $startDate,
                displayedComponents: [.date, .hourAndMinute]
            )
            .labelsHidden()
            .accessibilityLabel(Text(verbatim: label))
            .accessibilityHint(Text(verbatim: ScheduledMaintenanceStrings.string(
                "scheduled.a11y.startHint",
                "Choose when the maintenance window begins"
            )))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var durationField: some View {
        let label = ScheduledMaintenanceStrings.string("scheduled.field.duration", "Duration (minutes)")
        return VStack(alignment: .leading, spacing: TSSpacing.xs) {
            fieldLabel(label)
            numericField(text: $durationText)
                .accessibilityLabel(Text(verbatim: label))
                .accessibilityHint(Text(verbatim: ScheduledMaintenanceStrings.string(
                    "scheduled.a11y.durationHint",
                    "How long the maintenance window lasts, in minutes"
                )))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var messageField: some View {
        let prompt = ScheduledMaintenanceStrings.string("scheduled.field.message", "What's happening (optional)")
        return VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TextField("", text: $message, prompt: Text(verbatim: prompt))
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .modifier(MaintenanceFieldChrome())
                .onChange(of: message) { _, value in
                    if value.count > messageLimit { message = String(value.prefix(messageLimit)) }
                }
                .accessibilityLabel(Text(verbatim: prompt))
                .accessibilityHint(Text(verbatim: ScheduledMaintenanceStrings.string(
                    "scheduled.a11y.messageHint",
                    "Optional note shown to users during maintenance"
                )))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Actions (web Cancel / Schedule)

    private var actions: some View {
        let cancel = ScheduledMaintenanceStrings.string("scheduled.action.cancel", "Cancel")
        let schedule = isMutating
            ? ScheduledMaintenanceStrings.string("scheduled.action.scheduling", "Scheduling…")
            : ScheduledMaintenanceStrings.string("scheduled.action.schedule", "Schedule")
        return HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .small, action: onCancel) {
                Text(verbatim: cancel)
            }
            .disabled(isMutating)
            .accessibilityLabel(Text(verbatim: cancel))
            TSButton(variant: .primary, size: .small, action: onSchedule) {
                Text(verbatim: schedule)
            }
            .disabled(isMutating)
            .accessibilityLabel(Text(verbatim: schedule))
        }
    }

    // MARK: Helpers

    private func fieldLabel(_ text: String) -> some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
    }

    private func numericField(text: Binding<String>) -> some View {
        let field = TextField("", text: text)
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .modifier(MaintenanceFieldChrome())
        #if os(iOS)
            return field.keyboardType(.numberPad)
        #else
            return field
        #endif
    }
}

// MARK: - Field chrome (token surface + hairline border)

/// Shared field chrome for the inline form controls: a token surface with the rounded hairline
/// border (the native peer of the web `Input` styling), kept local so the surface stays
/// self-contained.
private struct MaintenanceFieldChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}
