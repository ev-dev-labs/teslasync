//
//  AppearanceSettings.Theme.swift
//  TeslaSync — P4 feature view · 0204 · AppearanceSettings (Apple)
//
//  The composed theme section — the native counterpart of the web
//  `<ThemePicker showMode showCustom />` slot. `showMode` maps to a HIG-idiomatic
//  System / Light / Dark appearance selector; `showCustom` maps to the accent-
//  preset swatch row. The rich multi-theme + custom-RGB picker remains the shared
//  component-library atom (out of scope for this feature-view prompt); this section
//  composes the mode + accent controls and writes through the model's theme seam.
//

import SwiftUI

/// The theme section: a Display Mode card group + an Accent Color swatch row, both
/// routing through the model so the device-local theme store stays the source of
/// truth (no direct theme mutation in the view).
struct AppearanceThemeSection: View {
    let mode: AppearanceThemeMode
    let accentID: String
    let onSelectMode: (AppearanceThemeMode) -> Void
    let onSelectAccent: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            AppearanceSectionHeader(
                systemImage: "paintbrush.pointed.fill",
                titleKey: "theme.displayMode",
                titleFallback: "Display Mode"
            )
            ForEach(AppearanceSettingsAdapter.themeModeChoices()) { choice in
                AppearanceChoiceCard(
                    label: choice.label,
                    help: choice.help,
                    isActive: mode == choice.value
                ) {
                    modeGlyph(choice.value)
                } action: {
                    onSelectMode(choice.value)
                }
            }

            AppearanceSectionHeader(
                systemImage: "drop.fill",
                titleKey: "theme.accentColor",
                titleFallback: "Accent Color"
            )
            accentRow
            AppearanceSettingsStrings.text(
                "theme.accentHelp",
                "Tints buttons, links, and active states across the app."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
    }

    private var accentRow: some View {
        HStack(spacing: TSSpacing.md) {
            ForEach(AppearanceAccent.presets()) { preset in
                AppearanceAccentSwatch(
                    preset: preset,
                    isActive: accentID == preset.id,
                    action: { onSelectAccent(preset.id) }
                )
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(AppearanceSettingsStrings.text("theme.accentColor", "Accent Color"))
    }

    private func modeGlyph(_ mode: AppearanceThemeMode) -> some View {
        Image(systemName: glyphName(mode))
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 32, height: 32)
            .background(
                Color.TS.accent.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .accessibilityHidden(true)
    }

    private func glyphName(_ mode: AppearanceThemeMode) -> String {
        switch mode {
        case .system: "circle.lefthalf.filled"
        case .light: "sun.max.fill"
        case .dark: "moon.fill"
        }
    }
}

/// One accent-preset swatch: a filled circle with a selection ring + checkmark.
struct AppearanceAccentSwatch: View {
    let preset: AppearanceAccentPreset
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Circle()
                .fill(appearanceHexColor(preset.hex))
                .frame(width: 28, height: 28)
                .overlay(
                    Circle().strokeBorder(Color.white.opacity(isActive ? 0.9 : 0.0), lineWidth: 2)
                )
                .overlay(
                    Circle().strokeBorder(Color.TS.border, lineWidth: 1)
                )
                .overlay {
                    if isActive {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color.white)
                    }
                }
                .padding(3)
                .background(
                    isActive ? Color.TS.accent.opacity(0.18) : Color.clear,
                    in: Circle()
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: preset.label))
        .accessibilityValue(isActive ? Text(verbatim: AppearanceSettingsAccessibility.selectedLabel()) : Text(""))
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }
}
