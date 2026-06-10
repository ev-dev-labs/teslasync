//
//  SignalConfigModal.Controls.swift
//  TeslaSync — P4 modal / dialog · 0016 · SignalConfigModal (Apple)
//
//  The pinned master controls `SignalConfigPopulatedView` shows above the signal list — the parity
//  of the web sticky control bar: the 8 one-tap presets, the master select-all toggle, the master
//  interval picker, and the search field. The presets apply a category-keyed configuration to the
//  whole draft, select-all flips every row, the master picker sets every row's cadence, and the
//  search filters the list. All copy resolves through P1/S10; the preset names render an SF Symbol in
//  place of the web emoji prefix. Binds through `SignalConfigModel` (P1/S8).
//

import SwiftUI

// MARK: - Control bar (web sticky control bar)

/// The pinned control bar: the presets row, the select-all + global-interval row, and the search
/// field (web master-controls block).
struct SignalConfigControlBar: View {
    @Bindable var model: SignalConfigModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            SignalConfigPresetsRow(model: model)
            HStack(spacing: TSSpacing.md) {
                SignalConfigSelectAllButton(model: model)
                SignalConfigGlobalIntervalPicker(model: model)
                Spacer(minLength: 0)
            }
            SignalConfigSearchField(model: model)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .background(Color.TS.surface)
    }
}

// MARK: - Presets row (web preset buttons)

/// The horizontally-scrolling row of the 8 configuration presets (web `PRESETS.map`).
struct SignalConfigPresetsRow: View {
    @Bindable var model: SignalConfigModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.sm) {
                ForEach(SignalConfigPreset.allCases) { preset in
                    SignalConfigPresetButton(preset: preset, model: model)
                }
            }
            .padding(.vertical, 2)
        }
    }
}

/// One preset chip (web preset `<button>`): an SF Symbol + the preset name; applies the preset to the
/// whole draft on tap, with the description as the help / VoiceOver hint.
struct SignalConfigPresetButton: View {
    let preset: SignalConfigPreset
    @Bindable var model: SignalConfigModel

    var body: some View {
        Button {
            model.applyPreset(preset)
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: preset.iconSystemName)
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: model.localize(preset.nameKey, preset.nameFallback))
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
            }
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surfaceGlass, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help(Text(verbatim: model.localize(preset.descKey, preset.descFallback)))
        .accessibilityLabel(Text(verbatim: model.presetAccessibilityLabel(preset)))
    }
}

// MARK: - Select-all toggle (web master toggle)

/// The master select-all / deselect-all control (web select-all `<button>`): a checkbox glyph + the
/// state-aware label, flipping every row on tap.
struct SignalConfigSelectAllButton: View {
    @Bindable var model: SignalConfigModel

    var body: some View {
        Button {
            model.toggleAll()
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: model.allSelected ? "checkmark.square.fill" : "square")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(model.allSelected ? Color.TS.accent : Color.TS.textMuted)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surfaceGlass, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(model.allSelected ? .isSelected : [])
    }

    private var label: String {
        SignalConfigAccessibility.selectAllToggleLabel(allSelected: model.allSelected, localize: model.localize)
    }
}

// MARK: - Global interval picker (web master `<Select>`)

/// The global-interval picker (web "Master Interval" `<Select>`): sets every row's cadence to the
/// chosen interval via a native menu picker.
struct SignalConfigGlobalIntervalPicker: View {
    @Bindable var model: SignalConfigModel

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: SignalConfigStrings.string("signals.config.masterInterval", "Master Interval"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Picker(selection: selection) {
                ForEach(SignalConfigCatalog.intervals) { option in
                    Text(verbatim: optionLabel(option)).tag(option.value)
                }
            } label: {
                EmptyView()
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: SignalConfigStrings.string(
                "signals.config.masterIntervalA11y", "Master streaming interval"
            )))
        }
    }

    private var selection: Binding<Int> {
        Binding(get: { model.globalInterval }, set: { model.setGlobalInterval($0) })
    }

    private func optionLabel(_ option: SignalConfigInterval) -> String {
        "\(option.label) · \(model.localize(option.descKey, option.descFallback))"
    }
}

// MARK: - Search field (web search `<Input>`)

/// The signal search field (web search `<Input>` with the magnifier icon): filters the list by a
/// case-insensitive name query, with a clear button once non-empty.
struct SignalConfigSearchField: View {
    @Bindable var model: SignalConfigModel

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField(text: query, prompt: prompt) {
                Text(verbatim: SignalConfigStrings.string("signals.config.searchLabel", "Search signals"))
            }
            .labelsHidden()
            .textFieldStyle(.plain)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
            .modifier(SignalConfigSearchInputTraits())
            if !model.search.isEmpty {
                Button {
                    model.setSearch("")
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: SignalConfigStrings.string(
                    "signals.config.clearSearch", "Clear search"
                )))
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var query: Binding<String> {
        Binding(get: { model.search }, set: { model.setSearch($0) })
    }

    private var prompt: Text {
        Text(verbatim: SignalConfigStrings.string("signals.config.searchPrompt", "Search signals…"))
    }
}

/// Platform-specific text-input traits for the search field (no autocapitalization / autocorrection
/// on iOS; a no-op on macOS).
private struct SignalConfigSearchInputTraits: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
            content
                .autocorrectionDisabled(true)
                .textInputAutocapitalization(.never)
        #else
            content
        #endif
    }
}
