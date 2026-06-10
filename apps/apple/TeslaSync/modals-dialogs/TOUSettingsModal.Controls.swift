//
//  TOUSettingsModal.Controls.swift
//  TeslaSync — P4 modal / dialog · 0021 · TOUSettingsModal (Apple)
//
//  The interactive form controls for the populated TOUSettingsModal, ported from the web `@/components/ui`
//  primitives the source composes: the `Tabs` segmented control (Preset Tariff / Custom JSON), the
//  preset `Select` (a native menu over the three rate plans), and the Custom-JSON `Textarea` (a
//  monospaced editor with the web JSON-skeleton prompt). Each binds through `TOUSettingsModel`, resolves
//  copy through P1/S10, carries a VoiceOver label, and is token-styled (P1/S9) — no web Tailwind ports.
//

import SwiftUI

// MARK: - Tabs (web `Tabs`)

/// The two-segment tab control (web `<Tabs tabs activeTab onChange>`). Each segment is a real button
/// carrying `.isSelected` for VoiceOver; the active one is filled with the accent.
struct TOUSettingsTabBar: View {
    @Bindable var model: TOUSettingsModel

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(TOUSettingsTab.allCases) { tab in
                segment(tab)
            }
        }
        .padding(TSSpacing.xs)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
    }

    @ViewBuilder
    private func segment(_ tab: TOUSettingsTab) -> some View {
        let isSelected = tab == model.activeTab
        Button {
            model.activeTab = tab
        } label: {
            Text(verbatim: model.tabTitle(tab))
                .font(Font.TS.bodySm)
                .fontWeight(isSelected ? .semibold : .regular)
                .foregroundStyle(isSelected ? Color.white : Color.TS.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, TSSpacing.sm)
                .background(isSelected ? Color.TS.accent : Color.clear, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.tabAccessibilityLabel(tab)))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Preset picker (web `Select`)

/// The rate-plan picker (web `<Select label options value onChange>`) as a native menu. The
/// trigger shows the selected option's label or the prompt copy; choosing one sets `selectedPreset`.
struct TOUSettingsPresetPicker: View {
    @Bindable var model: TOUSettingsModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TOUSettingsFieldLabel(text: model.localize("energy.tou.selectPlan", "Rate Plan"))
            Menu {
                ForEach(model.presetOptions) { option in
                    Button {
                        model.selectedPreset = option.id
                    } label: {
                        optionLabel(option)
                    }
                }
            } label: {
                trigger
            }
            .accessibilityLabel(Text(verbatim: model.presetAccessibilityLabel))
        }
    }

    @ViewBuilder
    private func optionLabel(_ option: TOUSettingsPresetOption) -> some View {
        if option.id == model.selectedPreset {
            Label { Text(verbatim: option.label) } icon: { Image(systemName: "checkmark") }
        } else {
            Text(verbatim: option.label)
        }
    }

    private var trigger: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: model.selectedPresetDisplay)
                .font(Font.TS.body)
                .foregroundStyle(model.hasPresetSelected ? Color.TS.textPrimary : Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Custom JSON editor (web `Textarea`)

/// The Custom-JSON editor (web `<Textarea label value onChange rows=12 mono>`). A monospaced
/// `TextEditor` over token chrome, with the web JSON-skeleton prompt shown while empty.
struct TOUSettingsJSONEditor: View {
    @Bindable var model: TOUSettingsModel

    /// The web `Textarea` prompt — the `tou_settings` skeleton shown while the field is empty.
    private static let promptSkeleton = """
    {
      "tou_settings": {
        "optimization_strategy": "economics",
        "tariff_content_v2": { ... }
      }
    }
    """

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TOUSettingsFieldLabel(text: model.localize("energy.tou.customLabel", "TOU Settings JSON"))
            ZStack(alignment: .topLeading) {
                if model.customJSON.isEmpty {
                    Text(verbatim: Self.promptSkeleton)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(Color.TS.textMuted)
                        .padding(.horizontal, TSSpacing.sm + 1)
                        .padding(.vertical, TSSpacing.sm + 2)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                TextEditor(text: $model.customJSON)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 200)
                    .padding(.horizontal, TSSpacing.xs)
                    .padding(.vertical, TSSpacing.xs)
                    .accessibilityLabel(
                        Text(verbatim: model.localize("energy.tou.customLabel", "TOU Settings JSON"))
                    )
            }
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
    }
}
