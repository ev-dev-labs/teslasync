//
//  ThemePicker.AccentViews.swift
//  TeslaSync — P4 shared surface · 0228 · ThemePicker (Apple)
//
//  The presentational pieces of the Accent-Colour half of the picker — the native peers of the web
//  elements: the accent section (web Accent-Colour block — the always-present grid of preset swatches
//  plus the optional Custom swatch), one theme swatch (web theme `<Button>` — the primary→accent
//  gradient disc, the localized name, and the corner checkmark when active), and the Custom RGB builder
//  (web `themeId === 'custom'` panel — a native colour well per channel with its live hex). The wells
//  bridge a picked `Color` back to a `#RRGGBB` string through `ThemePickerColorBridge` and write it via
//  the model. All chrome is token-driven (P1/S9); the decorative gradient is hidden from VoiceOver.
//

import SwiftUI

// MARK: - Accent section (web Accent-Colour block)

/// The Accent-Colour section — the section label over a responsive grid of preset swatches plus the
/// optional Custom swatch, with the Custom RGB builder revealed below when the Custom theme is active.
/// Binds taps + colour edits straight to the model (the web `handleTheme` / `handleCustom`).
struct ThemePickerAccentSection: View {
    let model: ThemePickerModel
    let projection: ThemePickerProjection
    let layout: ThemePickerLayout

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: layout.themeMinItemWidth), spacing: layout.gridSpacing)]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ThemePickerSectionLabel(text: projection.accentSectionTitle)
            LazyVGrid(columns: columns, alignment: .leading, spacing: layout.gridSpacing) {
                ForEach(projection.themeOptions) { option in
                    ThemePickerThemeSwatch(option: option) { model.selectTheme(option.id) }
                }
                if let custom = projection.customOption {
                    ThemePickerThemeSwatch(option: custom) { model.selectCustom() }
                }
            }
            if let builder = projection.customBuilder {
                ThemePickerCustomBuilderView(builder: builder, primary: primaryBinding, accent: accentBinding)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var primaryBinding: Binding<Color> {
        Binding(
            get: { Color(themePickerHex: model.customPrimaryHex) },
            set: { model.updateCustomPrimary(ThemePickerColorBridge.hexString(from: $0)) }
        )
    }

    private var accentBinding: Binding<Color> {
        Binding(
            get: { Color(themePickerHex: model.customAccentHex) },
            set: { model.updateCustomAccent(ThemePickerColorBridge.hexString(from: $0)) }
        )
    }
}

// MARK: - Theme swatch (web theme `<Button>` + Custom button)

/// One Accent-Colour swatch — the native peer of the web theme `<Button>`: a primary→accent gradient
/// disc (web `linear-gradient(135deg, …)`), the localized name, and a corner checkmark tinted by the
/// theme's primary when active. One labelled, selectable tap target.
struct ThemePickerThemeSwatch: View {
    let option: ThemePickerThemeOption
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                gradientDisc
                Text(verbatim: option.displayName)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(
            option.isSelected ? Color.TS.surfaceGlass : Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(border)
        .overlay(alignment: .topTrailing) {
            if option.isSelected { checkmark }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: option.displayName))
        .accessibilityValue(Text(verbatim: option.isSelected ? ThemePickerStrings.selectedValue : ""))
        .accessibilityHint(Text(verbatim: ThemePickerStrings.themeHint))
        .accessibilityAddTraits(option.isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private var gradientDisc: some View {
        Circle()
            .fill(
                LinearGradient(
                    colors: [
                        Color(themePickerHex: option.gradientStartHex),
                        Color(themePickerHex: option.gradientEndHex)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .frame(width: 26, height: 26)
            .overlay(Circle().strokeBorder(Color.TS.border, lineWidth: 0.5))
            .accessibilityHidden(true)
    }

    private var border: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .strokeBorder(
                option.isSelected ? Color(themePickerHex: option.gradientStartHex) : Color.TS.border,
                lineWidth: option.isSelected ? 2 : 1
            )
    }

    private var checkmark: some View {
        Image(systemName: "checkmark.circle.fill")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Color(themePickerHex: option.gradientStartHex))
            .padding(TSSpacing.sm)
            .accessibilityHidden(true)
    }
}

// MARK: - Custom builder (web `themeId === 'custom'` panel)

/// The Custom RGB editor — a token-bordered panel with a colour well per channel (web Primary / Accent
/// `<input type="color">`), each showing its live `#RRGGBB`. Revealed only while the Custom theme is
/// active (web `showCustom && themeId === 'custom'`).
struct ThemePickerCustomBuilderView: View {
    let builder: ThemePickerCustomBuilder
    let primary: Binding<Color>
    let accent: Binding<Color>

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ThemePickerColorWell(
                label: builder.primaryLabel,
                hex: builder.primaryHex,
                voiceOverLabel: ThemePickerStrings.customPrimaryLabel,
                selection: primary
            )
            ThemePickerColorWell(
                label: builder.accentLabel,
                hex: builder.accentHex,
                voiceOverLabel: ThemePickerStrings.customAccentLabel,
                selection: accent
            )
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

/// One labelled colour well — the channel label, a native `ColorPicker`, and the live `#RRGGBB`.
struct ThemePickerColorWell: View {
    let label: String
    let hex: String
    let voiceOverLabel: String
    let selection: Binding<Color>

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
            ColorPicker("", selection: selection, supportsOpacity: false)
                .labelsHidden()
                .accessibilityLabel(Text(verbatim: voiceOverLabel))
            Text(verbatim: hex)
                .font(Font.TS.caption.monospaced())
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
    }
}
