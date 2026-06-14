//
//  VehicleSettingsTab.Views.swift
//  TeslaSync — P4 feature view · 0308 · VehicleSettingsTab (Apple)
//
//  The presentational subviews composed by `VehicleSettingsTab`: the per-key override
//  rows (label + source pill + help, the typed input per kind, the inline validation /
//  action error, and the Save + Reset actions) and the loading / empty / error chrome.
//  All consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no
//  Tailwind ports, no raw hex.
//
//  Source-pill tone parity (web `SOURCE_PILL_VARIANT`, ADR-006 semantic): override →
//  success, user → info, vehicle → neutral, default → warning.
//

import SwiftUI

// MARK: - Source pill (web `<SourcePill>` / `Badge`)

/// The "source" pill — which layer produced the row's effective value. Tinted by the
/// same semantic mapping as the web `Badge` variant.
struct VehicleSettingsSourcePill: View {
    let source: EffectiveSettingSource

    private var tone: TSTone {
        switch source {
        case .override: .success
        case .user: .info
        case .vehicle: .neutral
        case .systemDefault: .warning
        }
    }

    private var label: String {
        Self.label(for: source)
    }

    /// The localised source label (web `t('vehicleSettings.source.{source}', source)`),
    /// shared by the pill and the row's VoiceOver header.
    static func label(for source: EffectiveSettingSource) -> String {
        VehicleSettingsStrings.string("vehicleSettings.source.\(source.rawValue)", fallback(for: source))
    }

    private static func fallback(for source: EffectiveSettingSource) -> String {
        switch source {
        case .override: "Override"
        case .user: "User default"
        case .vehicle: "Vehicle name"
        case .systemDefault: "System default"
        }
    }

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Rows body (web non-empty render)

/// The resolved per-key rows, divided like the web `<ul className="divide-y">`, wrapped
/// in the shared fade-in (web `FadeIn`).
struct VehicleSettingsRows: View {
    let model: VehicleSettingsTabModel

    var body: some View {
        TSFadeIn {
            VStack(spacing: 0) {
                ForEach(Array(model.rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 {
                        Divider().overlay(Color.TS.border)
                    }
                    VehicleSettingRowView(row: row, model: model)
                        .padding(.vertical, TSSpacing.md)
                }
            }
        }
    }
}

// MARK: - Per-row (web `<VehicleSettingRow>`)

/// One override row — the label + source pill + help, the typed input, the inline
/// validation/action error, and the Save + Reset actions.
struct VehicleSettingRowView: View {
    let row: RowViewState
    let model: VehicleSettingsTabModel

    private var label: String {
        VehicleSettingsStrings.string(row.descriptor.labelKey, row.descriptor.labelFallback)
    }

    private var help: String {
        VehicleSettingsStrings.string(row.descriptor.helpKey, row.descriptor.helpFallback)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: label)
                    .font(Font.TS.bodySm.weight(.medium))
                    .foregroundStyle(Color.TS.textPrimary)
                VehicleSettingsSourcePill(source: row.source)
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: VehicleSettingsAccessibility.rowLabel(
                label: label,
                source: VehicleSettingsSourcePill.label(for: row.source)
            )))
            .accessibilityAddTraits(.isHeader)

            if !help.isEmpty {
                Text(verbatim: help)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VehicleSettingInput(row: row, label: label, model: model)

            if let error = row.validationError {
                Text(verbatim: error)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .fixedSize(horizontal: false, vertical: true)
            }

            actions

            if let error = row.actionError {
                Text(verbatim: error)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var saveTitle: String {
        row.savePhase == .inFlight
            ? VehicleSettingsStrings.string("vehicleSettings.actions.saving", "Saving…")
            : VehicleSettingsStrings.string("vehicleSettings.actions.save", "Save")
    }

    private var resetTitle: String {
        row.resetPhase == .inFlight
            ? VehicleSettingsStrings.string("vehicleSettings.actions.resetting", "Resetting…")
            : VehicleSettingsStrings.string("vehicleSettings.actions.reset", "Reset to default")
    }

    private var actions: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            TSButton(
                variant: .primary,
                size: .small,
                isLoading: row.savePhase == .inFlight,
                action: { model.save(key: row.descriptor.key) },
                label: { Text(verbatim: saveTitle) }
            )
            .disabled(!row.canSave)
            .accessibilityLabel(Text(verbatim: saveTitle))

            TSButton(
                variant: .secondary,
                size: .small,
                isLoading: row.resetPhase == .inFlight,
                action: { model.reset(key: row.descriptor.key) },
                label: { Text(verbatim: resetTitle) }
            )
            .disabled(!row.canReset)
            .accessibilityLabel(Text(verbatim: resetTitle))
        }
    }
}

// MARK: - Typed input (web `renderInput`)

/// The typed input control for a row, dispatched on the descriptor kind — a text field,
/// a unit picker, or a date-and-time control.
struct VehicleSettingInput: View {
    let row: RowViewState
    let label: String
    let model: VehicleSettingsTabModel

    var body: some View {
        switch row.descriptor.kind {
        case .text:
            textInput
        case .select:
            selectInput
        case .timestamp:
            timestampInput
        }
    }

    private var textValue: String {
        if case let .text(value) = row.draft { return value }
        return ""
    }

    private var textInput: some View {
        TextField(
            "",
            text: Binding(
                get: { textValue },
                set: { model.edit(key: row.descriptor.key, draft: .text($0)) }
            )
        )
        .textFieldStyle(.plain)
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textPrimary)
        .modifier(VehicleSettingFieldChrome())
        .accessibilityLabel(Text(verbatim: label))
    }

    private var selectionValue: String {
        if case let .selection(value) = row.draft { return value }
        return ""
    }

    private var selectInput: some View {
        Picker(
            selection: Binding(
                get: { selectionValue },
                set: { model.edit(key: row.descriptor.key, draft: .selection($0)) }
            )
        ) {
            ForEach(row.descriptor.options) { option in
                Text(verbatim: option.symbol).tag(option.value)
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.menu)
        .tint(Color.TS.accent)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var timestampDate: Date? {
        if case let .timestamp(date) = row.draft { return date }
        return nil
    }

    @ViewBuilder
    private var timestampInput: some View {
        if let date = timestampDate {
            HStack(spacing: TSSpacing.sm) {
                DatePicker(
                    "",
                    selection: Binding(
                        get: { date },
                        set: { model.edit(key: row.descriptor.key, draft: .timestamp($0)) }
                    ),
                    displayedComponents: [.date, .hourAndMinute]
                )
                .labelsHidden()
                .tint(Color.TS.accent)
                .accessibilityLabel(Text(verbatim: label))
                Button {
                    model.edit(key: row.descriptor.key, draft: .timestamp(nil))
                } label: {
                    Text(verbatim: VehicleSettingsStrings.string("vehicleSettings.actions.clear", "Clear"))
                        .font(Font.TS.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.TS.accent)
                .accessibilityLabel(Text(verbatim: VehicleSettingsStrings.string(
                    "vehicleSettings.actions.clear", "Clear"
                )))
            }
        } else {
            Button {
                model.edit(key: row.descriptor.key, draft: .timestamp(Date()))
            } label: {
                Text(verbatim: VehicleSettingsStrings.string(
                    "vehicleSettings.actions.setDateTime", "Set date & time"
                ))
                .font(Font.TS.body)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.accent)
            .modifier(VehicleSettingFieldChrome())
            .accessibilityLabel(Text(verbatim: VehicleSettingsStrings.string(
                "vehicleSettings.actions.setDateTime", "Set date & time"
            )))
        }
    }
}

// MARK: - Field chrome (token surface + rounded border)

/// Shared input chrome: a token surface with a rounded border, matching the web
/// `Input` / `Select` control affordance.
private struct VehicleSettingFieldChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: three skeleton rows so the panel keeps its shape while the
/// resolver feed resolves (web 3-skeleton short-circuit).
struct VehicleSettingsLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSSkeleton(width: 140, height: 12)
                    TSSkeleton(height: 36, cornerRadius: TSRadius.md)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: VehicleSettingsStrings.string(
            "vehicleSettings.loading", "Loading vehicle settings…"
        )))
    }
}

/// The empty render (no supported keys resolved): a friendly state, never a blank panel.
struct VehicleSettingsEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: VehicleSettingsStrings.string(
                    "vehicleSettings.empty", "No vehicle settings are available right now."
                ))
            } icon: {
                Image(systemName: "slider.horizontal.3")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `ErrorDisplay` peer) with a retry affordance.
struct VehicleSettingsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: VehicleSettingsStrings.string(
                "vehicleSettings.error", "Could not load vehicle settings."
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: VehicleSettingsStrings.string("vehicleSettings.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: VehicleSettingsStrings.string("vehicleSettings.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
