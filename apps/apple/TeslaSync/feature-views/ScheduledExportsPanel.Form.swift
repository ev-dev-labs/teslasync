//
//  ScheduledExportsPanel.Form.swift
//  TeslaSync — P4 feature view · 0262 · ScheduledExportsPanel (Apple)
//
//  The inline new/edit schedule form — the SwiftUI parity of the web `<form>` the panel
//  renders when `showForm` is true (name, cron, export type, format, range window,
//  delivery kind, and the conditional delivery target, plus Cancel / Save). Bound through
//  `ScheduledExportsModel` field-by-field via `@Bindable`; copy via P1/S10; chrome via the
//  P1/S9 tokens. Native controls (`TextField`, menu `Picker`) per Apple HIG — no web
//  Tailwind ports. Client validation is deliberately minimal (the server owns it): Save is
//  enabled once the form's `isSubmittable` predicate holds.
//

import SwiftUI

// MARK: - Form container

/// The inline new/edit form. Single-column field stack (reflow-friendly on compact widths,
/// the same shape the web grid collapses to) inside a bordered card, with a trailing
/// Cancel / Save action row.
struct ScheduledExportForm: View {
    @Bindable var model: ScheduledExportsModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            fields
            actionRow
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var fields: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ScheduledExportTextField(
                labelKey: "dataExport.scheduled.form.name",
                labelFallback: "Name",
                promptKey: "dataExport.scheduled.form.namePlaceholder", // parity:allow verbatim web i18n key
                promptFallback: "Drives weekly",
                text: $model.form.name
            )
            ScheduledExportTextField(
                labelKey: "dataExport.scheduled.form.scheduleCron",
                labelFallback: "Cron expression",
                promptKey: "dataExport.scheduled.form.scheduleCronExample",
                promptFallback: "0 9 * * 0",
                text: $model.form.scheduleCron,
                helpKey: "dataExport.scheduled.form.scheduleCronHelp",
                helpFallback: "Standard 5-field cron, e.g. '0 9 * * 0'.",
                monospaced: true
            )
            ScheduledExportEnumPicker(
                labelKey: "dataExport.scheduled.form.exportType",
                labelFallback: "Export type",
                selection: $model.form.exportType
            )
            ScheduledExportEnumPicker(
                labelKey: "dataExport.scheduled.form.format",
                labelFallback: "Format",
                selection: $model.form.format
            )
            ScheduledExportTextField(
                labelKey: "dataExport.scheduled.form.rangeWindow",
                labelFallback: "Range window",
                promptKey: "dataExport.scheduled.form.rangeWindowExample",
                promptFallback: "7d",
                text: $model.form.rangeWindow,
                helpKey: "dataExport.scheduled.form.rangeWindowHelp",
                helpFallback: "Format: number + m/h/d."
            )
            ScheduledExportEnumPicker(
                labelKey: "dataExport.scheduled.form.deliveryKind",
                labelFallback: "Delivery kind",
                selection: $model.form.deliveryKind
            )
            if model.form.requiresDeliveryTarget {
                deliveryTargetField
            }
        }
    }

    private var deliveryTargetField: some View {
        let isEmail = model.form.deliveryKind == .email
        let promptFallback = isEmail ? "you@example.com" : "https://example.com/hook"
        let promptKey = isEmail
            ? "dataExport.scheduled.form.deliveryTargetEmailExample"
            : "dataExport.scheduled.form.deliveryTargetWebhookExample"
        return ScheduledExportTextField(
            labelKey: "dataExport.scheduled.form.deliveryTarget",
            labelFallback: "Delivery target",
            promptKey: promptKey,
            promptFallback: promptFallback,
            text: $model.form.deliveryTarget,
            helpKey: "dataExport.scheduled.form.deliveryTargetHelp",
            helpFallback: "Email address or HTTPS URL."
        )
    }

    private var actionRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            TSButton(
                variant: .ghost,
                size: .small,
                action: { model.closeForm() },
                label: { ScheduledExportsStrings.text("dataExport.scheduled.form.cancel", "Cancel") }
            )
            .accessibilityLabel(ScheduledExportsStrings.text("dataExport.scheduled.form.cancel", "Cancel"))
            TSButton(
                variant: .primary,
                size: .small,
                isLoading: model.isFormBusy,
                action: { Task { await model.submit() } },
                label: { ScheduledExportsStrings.text("dataExport.scheduled.form.submit", "Save schedule") }
            )
            .disabled(!model.form.isSubmittable)
            .accessibilityLabel(ScheduledExportsStrings.text(
                "dataExport.scheduled.form.submit", "Save schedule"
            ))
        }
    }
}

// MARK: - Labeled text field (web `Input` + label + help)

/// A labeled single-line input with optional monospaced styling + helper text, all copy
/// routed through the P1/S10 facade (verbatim prompt so it isn't re-localized).
struct ScheduledExportTextField: View {
    let labelKey: String
    let labelFallback: String
    let promptKey: String
    let promptFallback: String
    @Binding var text: String
    var helpKey: String?
    var helpFallback: String?
    var monospaced = false

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ScheduledExportFieldLabel(key: labelKey, fallback: labelFallback)
            TextField(ScheduledExportsStrings.string(promptKey, promptFallback), text: $text)
                .textFieldStyle(.plain)
                .font(monospaced ? .system(.body, design: .monospaced) : Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.sm)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
                .accessibilityLabel(ScheduledExportsStrings.text(labelKey, labelFallback))
            if let helpKey, let helpFallback {
                ScheduledExportsStrings.text(helpKey, helpFallback)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - Labeled enum picker (web `Select`)

/// A labeled menu `Picker` over a `ScheduledExportOption` enum — written once and reused
/// for export type / format / delivery kind (DRY). Option titles resolve through the
/// facade so no English literal lives in code.
struct ScheduledExportEnumPicker<Value: ScheduledExportOption>: View {
    let labelKey: String
    let labelFallback: String
    @Binding var selection: Value

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ScheduledExportFieldLabel(key: labelKey, fallback: labelFallback)
            Picker(selection: $selection) {
                ForEach(Array(Value.allCases), id: \.self) { option in
                    Text(verbatim: ScheduledExportsStrings.string(option.labelKey, option.labelFallback))
                        .tag(option)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(ScheduledExportsStrings.text(labelKey, labelFallback))
        }
    }
}

// MARK: - Field label (web uppercase tracking label)

/// The small uppercased field label (web `text-xs uppercase tracking-wide`).
struct ScheduledExportFieldLabel: View {
    let key: String
    let fallback: String

    var body: some View {
        ScheduledExportsStrings.text(key, fallback)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .foregroundStyle(Color.TS.textSecondary)
    }
}
