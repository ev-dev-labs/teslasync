//
//  QuietHoursPanel.Form.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  The inline add/edit form — the native parity of the web `{draft && (...)}` block: the
//  title + "Enabled" toggle, the Start / End time pickers (web `<input type="time">`),
//  the IANA timezone picker (web `<Select>`), the weekday toggle chips, the bypass-
//  severity toggle chips, the inline validation error, and the Cancel / Update|Create
//  actions. Fields bind through `QuietHoursModel`'s controlled bindings; submission +
//  validation route through the model. Native primitives per Apple HIG (Toggle,
//  DatePicker, Picker) styled with P1/S9 tokens; every control carries a VoiceOver label.
//

import SwiftUI

// MARK: - Form container (web `{draft && <div data-testid="quiet-hours-form">}`)

/// The inline add/edit form revealed beneath the list while a draft is open.
struct QuietHoursForm: View {
    @Bindable var model: QuietHoursModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            QuietHoursFormHeader(model: model)
            QuietHoursTimeRow(model: model)
            QuietHoursTimezoneField(model: model)
            QuietHoursWeekdayPicker(model: model)
            QuietHoursSeverityPicker(model: model)
            if let error = model.validationError {
                Text(verbatim: error)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityAddTraits(.isStaticText)
            }
            QuietHoursFormActions(model: model)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web title + Enabled toggle)

/// The form title (add vs edit) plus the "Enabled" toggle (web `<Toggle>`).
struct QuietHoursFormHeader: View {
    @Bindable var model: QuietHoursModel

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            QuietHoursStrings.text(titleKey, titleFallback)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            Toggle(isOn: $model.draftEnabled) {
                QuietHoursStrings.text("quietHours.form.enabled", "Enabled")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .toggleStyle(.switch)
            .fixedSize()
        }
    }

    private var titleKey: String {
        model.isEditing ? "quietHours.form.editTitle" : "quietHours.form.addTitle"
    }

    private var titleFallback: String {
        model.isEditing ? "Edit window" : "New quiet-hours window"
    }
}

// MARK: - Field caption (web `<label>` / `<span>` above each control)

/// The muted caption shown above a form control (web field `<label>`).
struct QuietHoursFieldCaption: View {
    let key: String
    let fallback: String

    var body: some View {
        QuietHoursStrings.text(key, fallback)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
    }
}

// MARK: - Time row (web Start + End `<input type="time">`)

/// The Start + End time pickers side by side (web two-column grid).
struct QuietHoursTimeRow: View {
    @Bindable var model: QuietHoursModel

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            field(key: "quietHours.form.start", fallback: "Start", selection: $model.draftStartTime)
            field(key: "quietHours.form.end", fallback: "End", selection: $model.draftEndTime)
        }
    }

    private func field(key: String, fallback: String, selection: Binding<Date>) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            QuietHoursFieldCaption(key: key, fallback: fallback)
            DatePicker("", selection: selection, displayedComponents: [.hourAndMinute])
                .labelsHidden()
                .accessibilityLabel(QuietHoursStrings.text(key, fallback))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Timezone field (web `<Select>` of IANA zones)

/// The IANA timezone menu picker (web timezone `<Select>`).
struct QuietHoursTimezoneField: View {
    @Bindable var model: QuietHoursModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            QuietHoursFieldCaption(key: "quietHours.form.timezone", fallback: "Timezone (IANA)")
            Picker(selection: $model.draftTimezone) {
                ForEach(QuietHoursTimezones.options(current: model.draftTimezone), id: \.self) { zone in
                    Text(verbatim: zone).tag(zone)
                }
            } label: {
                QuietHoursStrings.text("quietHours.form.timezone", "Timezone (IANA)")
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .accessibilityLabel(QuietHoursStrings.text("quietHours.form.timezone", "Timezone (IANA)"))
        }
    }
}

// MARK: - Weekday picker (web weekday toggle buttons)

/// The seven weekday toggle chips (web `WEEKDAYS.map(<button aria-pressed>)`).
struct QuietHoursWeekdayPicker: View {
    @Bindable var model: QuietHoursModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            QuietHoursFieldCaption(key: "quietHours.form.weekdays", fallback: "Weekdays")
            HStack(spacing: TSSpacing.xs) {
                ForEach(QuietHoursWeekdays.ordered) { weekday in
                    let isOn = model.isWeekdayOn(weekday.bit)
                    Button { model.toggleWeekday(weekday.bit) } label: {
                        QuietHoursChipLabel(
                            text: model.localize(weekday.key, weekday.fallback),
                            isOn: isOn,
                            tone: Color.TS.accent
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: model.localize(weekday.key, weekday.fallback)))
                    .accessibilityAddTraits(isOn ? .isSelected : [])
                }
            }
        }
    }
}

// MARK: - Severity picker (web bypass-severity toggle buttons)

/// The bypass-severity toggle chips (web `SEVERITY_CHOICES.map(<button aria-pressed>)`).
struct QuietHoursSeverityPicker: View {
    @Bindable var model: QuietHoursModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            QuietHoursFieldCaption(
                key: "quietHours.form.bypass",
                fallback: "Always allow these severities through"
            )
            HStack(spacing: TSSpacing.xs) {
                ForEach(QuietHoursSeverity.allCases) { severity in
                    let isOn = model.isSeverityOn(severity.rawValue)
                    Button { model.toggleSeverity(severity.rawValue) } label: {
                        QuietHoursChipLabel(
                            text: model.localize(severity.labelKey, severity.labelFallback),
                            isOn: isOn,
                            tone: Color.TS.statusWarning
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: model.localize(severity.labelKey, severity.labelFallback)))
                    .accessibilityAddTraits(isOn ? .isSelected : [])
                }
            }
        }
    }
}

// MARK: - Actions (web Cancel + Update|Create)

/// The form footer: Cancel + the primary Update|Create action (busy while saving).
struct QuietHoursFormActions: View {
    @Bindable var model: QuietHoursModel

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: TSSpacing.sm)
            Button { model.cancel() } label: {
                actionLabel(
                    glyph: "xmark",
                    key: "quietHours.form.cancel",
                    fallback: "Cancel",
                    tone: Color.TS.textSecondary
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(QuietHoursStrings.text("quietHours.form.cancel", "Cancel"))

            Button { Task { await model.submit() } } label: {
                saveLabel
            }
            .buttonStyle(.plain)
            .disabled(model.isSaving)
            .accessibilityLabel(QuietHoursStrings.text(saveKey, saveFallback))
        }
        .padding(.top, TSSpacing.xs)
        .overlay(alignment: .top) {
            Rectangle().fill(Color.TS.border).frame(height: 1)
        }
    }

    private var saveLabel: some View {
        HStack(spacing: TSSpacing.xs) {
            if model.isSaving {
                ProgressView().controlSize(.small)
            } else {
                Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold))
            }
            QuietHoursStrings.text(saveKey, saveFallback).font(Font.TS.caption).fontWeight(.semibold)
        }
        .foregroundStyle(Color.TS.accent)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.accent.opacity(0.16), in: Capsule())
    }

    private func actionLabel(glyph: String, key: String, fallback: String, tone: Color) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: glyph).font(.system(size: 12, weight: .semibold))
            QuietHoursStrings.text(key, fallback).font(Font.TS.caption).fontWeight(.semibold)
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.10), in: Capsule())
    }

    private var saveKey: String {
        model.isEditing ? "quietHours.form.update" : "quietHours.form.create"
    }

    private var saveFallback: String {
        model.isEditing ? "Update" : "Create"
    }
}
