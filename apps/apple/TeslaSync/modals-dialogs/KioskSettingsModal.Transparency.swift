//
//  KioskSettingsModal.Transparency.swift
//  TeslaSync — P4 modal / dialog · 0025 · KioskSettingsModal (Apple)
//
//  The Transparency form section + the live preview swatch + the kiosk hint banner — the parity of
//  the web "Transparency" `FormSection` (the widget + background opacity sliders, the Transparent /
//  Solid axis captions, and the live preview that re-renders as the sliders move) plus the trailing
//  Monitor hint. The preview reproduces the web swatch math exactly: a dark page layer at the
//  background opacity behind a frosted widget panel whose white tint + blur track the widget opacity
//  (`KioskSettingsProjection`). Copy via P1/S10; chrome via P1/S9 tokens. Binds through
//  `KioskSettingsModel` (P1/S8).
//

import SwiftUI

// MARK: - Transparency section (web "Transparency" FormSection)

/// The transparency section: the widget-opacity + background-opacity sliders (each with the
/// Transparent / Solid axis captions) over the live preview swatch.
struct KioskTransparencySection: View {
    @Bindable var model: KioskSettingsModel

    var body: some View {
        KioskFormSection(
            title: KioskSettingsStrings.string("kiosk.transparency", "Transparency"),
            description: transparencyDescription
        ) {
            opacityControl(
                label: KioskSettingsStrings.string("kiosk.widgetOpacity", "Widget Opacity"),
                bounds: KioskCatalog.widgetOpacityBounds,
                value: model.widgetOpacityPercent,
                onChange: model.setWidgetOpacityPercent
            )
            opacityControl(
                label: KioskSettingsStrings.string("kiosk.bgOpacity", "Background Opacity"),
                bounds: KioskCatalog.backgroundOpacityBounds,
                value: model.backgroundOpacityPercent,
                onChange: model.setBackgroundOpacityPercent
            )
            KioskPreviewSwatch(model: model)
        }
    }

    private var transparencyDescription: String {
        KioskSettingsStrings.string(
            "kiosk.transparencyDesc",
            "Adjust widget and background opacity. Higher values are more solid and readable."
        )
    }

    /// One opacity slider over its Transparent / Solid axis captions (web slider + the `flex
    /// justify-between` caption row).
    private func opacityControl(
        label: String,
        bounds: KioskSliderBounds,
        value: Int,
        onChange: @escaping (Int) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            KioskSliderRow(
                label: label,
                bounds: bounds,
                value: value,
                onChange: onChange,
                format: percentLabel
            )
            axisCaptions
        }
    }

    /// The Transparent ↔ Solid axis labels under a slider (web caption row). Decorative — the slider
    /// already announces its value to VoiceOver.
    private var axisCaptions: some View {
        HStack {
            Text(verbatim: KioskSettingsStrings.string("kiosk.transparent", "Transparent"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer()
            Text(verbatim: KioskSettingsStrings.string("kiosk.solid", "Solid"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Live preview swatch (web preview `<div>`)

/// The live transparency preview (web preview swatch): a dark page layer at the background opacity
/// behind a frosted widget panel whose white tint + blur track the widget opacity. Re-renders as the
/// sliders move, so the operator sees exactly how kiosk widgets will read.
struct KioskPreviewSwatch: View {
    @Bindable var model: KioskSettingsModel

    private var previewLabel: String {
        KioskSettingsStrings.string("kiosk.preview", "Preview — this is how widgets will look")
    }

    var body: some View {
        ZStack {
            pageLayer
            widgetPanel
                .padding(TSSpacing.sm)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 88)
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: previewLabel))
    }

    /// The dark page background (web `rgba(10, 10, 20, backgroundOpacity)`).
    private var pageLayer: some View {
        Color(
            .sRGB,
            red: 10.0 / 255.0,
            green: 10.0 / 255.0,
            blue: 20.0 / 255.0,
            opacity: model.previewBackgroundOpacity
        )
    }

    /// The frosted widget panel (web inner swatch): a white tint at the computed alpha behind a
    /// blurred highlight, with the preview caption.
    private var widgetPanel: some View {
        Text(verbatim: previewLabel)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .padding(TSSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background { panelBackground }
            .clipShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }

    /// The widget-panel fill: the white tint (web `0.03 + widgetOpacity * 0.17` alpha) behind a
    /// blurred highlight whose radius tracks the widget opacity (web `blur(4 + widgetOpacity * 12)`).
    private var panelBackground: some View {
        ZStack {
            Color.white.opacity(model.previewWidgetOpacity)
            LinearGradient(
                colors: [Color.white.opacity(0.20), Color.white.opacity(0.02)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .blur(radius: model.previewWidgetBlur)
        }
    }
}

// MARK: - Kiosk hint banner (web hint row)

/// The trailing kiosk-mode hint (web Monitor-icon hint): how to enter / reveal the exit / leave kiosk
/// mode.
struct KioskHintBanner: View {
    private var hint: String {
        let fallback = "Kiosk mode enters fullscreen and hides all navigation. "
            + "Move the mouse or touch the screen to reveal the exit button. Press Esc to exit."
        return KioskSettingsStrings.string("kiosk.hint", fallback)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "display")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: hint)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.surfaceGlass.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}
