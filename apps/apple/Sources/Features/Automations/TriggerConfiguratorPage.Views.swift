//
//  TriggerConfiguratorPage.Views.swift
//  TeslaSync — P7 page · automations/TriggerConfigurator (Apple)
//
//  Token-driven presentational primitives for the TriggerConfigurator page, mapping the web
//  `@/components/ui` controls to native HIG counterparts: the field label, the labeled menu select
//  (web `Select`), the labeled text field (web `Input`), the weekday toggle row (web day buttons),
//  and the geofence picker that renders every loading / empty / error / success branch the
//  `useGeofences` query implies (web silently maps `geofences ?? []`; the native surface never renders
//  a blank control). Every literal resolves from `Localizable.xcstrings` with the web key names; all
//  surfaces use the P2 design tokens.
//

import SwiftUI

// MARK: - Field label (web control `label`)

/// The small field label (web `Input` / `Select` `label`).
struct TriggerConfiguratorPageFieldLabel: View {
    let key: String
    let fallback: String

    var body: some View {
        Text(verbatim: TriggerConfiguratorPageStrings.localize(key, fallback))
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
    }
}

// MARK: - Labeled menu select (web `Select`)

/// The web `Select` mapped to a native menu `Picker`. Option labels resolve through the page
/// localizer from the reused `TriggerOption` catalogs and render verbatim; an accessibility label is
/// always supplied.
struct TriggerConfiguratorPagePicker<Value: Hashable & Sendable>: View {
    let labelKey: String
    let labelFallback: String
    let options: [TriggerOption<Value>]
    @Binding var selection: Value

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TriggerConfiguratorPageFieldLabel(key: labelKey, fallback: labelFallback)
            Picker(selection: $selection) {
                ForEach(options) { option in
                    Text(verbatim: TriggerConfiguratorPageStrings.localize(option.labelKey, option.fallback))
                        .tag(option.value)
                }
            } label: {
                Text(verbatim: label)
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .tint(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .padding(.horizontal, TSSpacing.sm)
            .modifier(TriggerConfiguratorPageFieldChrome())
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var label: String {
        TriggerConfiguratorPageStrings.localize(labelKey, labelFallback)
    }
}

// MARK: - Field chrome (token surface + rounded border)

/// Shared input chrome mirroring the web `Input` / `Select` shell.
struct TriggerConfiguratorPageFieldChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.vertical, TSSpacing.sm)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Labeled text field (web `Input`)

/// The web `Input` mapped to a native `TextField` with the shared field chrome, an optional prompt +
/// hint, and an optional numeric keyboard (web `type="number"`). The value stays a string and is
/// coerced by the reused adapter. Label + prompt + hint resolve through the localizer.
struct TriggerConfiguratorPageField: View {
    let labelKey: String
    let labelFallback: String
    @Binding var text: String
    var promptKey: String?
    var promptFallback: String?
    var hintKey: String?
    var hintFallback: String?
    var numeric = false

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TriggerConfiguratorPageFieldLabel(key: labelKey, fallback: labelFallback)
            field
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .autocorrectionDisabled(true)
                .padding(.horizontal, TSSpacing.sm)
                .modifier(TriggerConfiguratorPageFieldChrome())
                .accessibilityLabel(Text(verbatim: label))
            if let hintKey, let hintFallback {
                Text(verbatim: TriggerConfiguratorPageStrings.localize(hintKey, hintFallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private var field: some View {
        TextField("", text: $text, prompt: prompt)
        #if os(iOS)
            .keyboardType(numeric ? .numbersAndPunctuation : .default)
        #endif
    }

    private var prompt: Text? {
        guard let promptKey, let promptFallback else { return nil }
        return Text(verbatim: TriggerConfiguratorPageStrings.localize(promptKey, promptFallback))
    }

    private var label: String {
        TriggerConfiguratorPageStrings.localize(labelKey, labelFallback)
    }
}

// MARK: - Weekday toggle row (web day buttons)

/// The simple-schedule weekday selector — seven toggle chips (web `DAYS.map(...)`). An empty selection
/// renders every day active (web `selectedDays.length === 0 || includes`).
struct TriggerConfiguratorPageDaysRow: View {
    let selectedDays: [Int]
    let onToggle: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TriggerConfiguratorPageFieldLabel(key: "automations.builder.days", fallback: "Days")
            HStack(spacing: TSSpacing.sm) {
                ForEach(0 ..< TriggerAdapter.weekdayCount, id: \.self) { index in
                    dayButton(index)
                }
            }
        }
    }

    private func dayButton(_ index: Int) -> some View {
        let active = TriggerAdapter.isDayActive(selectedDays, index)
        let title = TriggerConfiguratorPageStrings.localize(
            WeekdayCatalog.shortKey(index),
            WeekdayCatalog.shortFallbacks[index]
        )
        return Button {
            onToggle(index)
        } label: {
            Text(verbatim: title)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .frame(width: 40, height: 40)
                .background(
                    active ? Color.TS.accent.opacity(0.2) : Color.TS.surface,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(active ? Color.TS.accent.opacity(0.5) : Color.TS.border, lineWidth: 1)
                )
                .foregroundStyle(active ? Color.TS.accent : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: TriggerConfiguratorAccessibility.dayLabel(
            day: title,
            active: active,
            localize: TriggerConfiguratorPageStrings.localize
        )))
        .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Geofence picker (web geofence `Select` + the query states)

/// The geofence dropdown (web `geofenceOptions`) wired to the resolved geofence query state. The web
/// maps `geofences ?? []` silently; the native surface renders the loading / empty / error / success
/// branches distinctly, never a blank control.
struct TriggerConfiguratorPageGeofencePicker: View {
    let state: TriggerConfiguratorPageGeofenceState
    let geofences: [Geofence]
    @Binding var selection: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TriggerConfiguratorPageFieldLabel(key: "automations.builder.geofence", fallback: "Geofence")
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            loadingRow
        case let .error(message):
            errorRow(message)
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                picker
                Text(verbatim: TriggerConfiguratorPageStrings.localize(
                    "automations.builder.geofenceEmpty",
                    "No geofences defined yet."
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            }
        case .success:
            picker
        }
    }

    private var loadingRow: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            Text(verbatim: TriggerConfiguratorPageStrings.localize(
                "automations.builder.geofenceLoading",
                "Loading geofences…"
            ))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: TriggerConfiguratorPageStrings.localize(
            "automations.builder.geofenceLoading",
            "Loading geofences…"
        )))
    }

    private func errorRow(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: TriggerConfiguratorPageStrings.localize(
                    "automations.builder.geofenceError",
                    "Could not load geofences."
                ))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.statusDanger)
                .fixedSize(horizontal: false, vertical: true)
            }
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            TSButton("action.retry", variant: .secondary, size: .small, action: onRetry)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusDanger.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var picker: some View {
        Picker(selection: $selection) {
            Text(verbatim: TriggerConfiguratorPageStrings.localize(
                "automations.builder.selectGeofence",
                "Select geofence..."
            ))
            .tag("")
            ForEach(geofences) { geofence in
                Text(verbatim: geofence.name).tag(geofence.id)
            }
        } label: {
            Text(verbatim: TriggerConfiguratorPageStrings.localize("automations.builder.geofence", "Geofence"))
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .tint(Color.TS.textPrimary)
        .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .modifier(TriggerConfiguratorPageFieldChrome())
        .accessibilityLabel(Text(verbatim: TriggerConfiguratorPageStrings.localize(
            "automations.builder.geofence",
            "Geofence"
        )))
        .accessibilityValue(Text(verbatim: TriggerConfiguratorAccessibility.geofenceValue(
            selectedName: geofences.first { $0.id == selection }?.name,
            localize: TriggerConfiguratorPageStrings.localize
        )))
    }
}
