//
//  ColorConverter.swift
//  TeslaSync — P4 feature view · 0013 · ColorConverter (Apple)
//
//  The SwiftUI parity of
//  features/admin/components/devtools/tools/ColorConverter.tsx — a devtools tool
//  that parses a hex color into its RGB and HSL channels. Binds through
//  `ColorConverterModel` (no networking in the view); renders the web `ToolCard`
//  chrome, the hex input + live swatch, and both states (a parseable hex → the
//  RGB/HSL/HEX result cards with copy buttons; an unparseable hex → a friendly
//  hint). Built from design tokens (P1/S9) + shared components.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension ColorConverterStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in
    /// the model file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - ColorConverter (the devtools feature view)

/// The composable color-converter devtools surface — SwiftUI parity of
/// `ColorConverter.tsx`. Renders the `ToolCard` shell, the hex input with a live
/// swatch, and the converted RGB/HSL/HEX cards (or a friendly hint when the hex
/// is not a six-digit value), binding through `ColorConverterModel`.
public struct ColorConverter: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ColorConverterSurface.slug

    @State private var model: ColorConverterModel

    public init(model: ColorConverterModel = ColorConverterModel()) {
        _model = State(initialValue: model)
    }

    /// Two-way binding the hex field uses, routing every edit through the model so
    /// the projection re-derives.
    private var hexBinding: Binding<String> {
        Binding(
            get: { model.hex },
            set: { newValue in model.hex = newValue }
        )
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    inputRow
                    content
                }
            }
        }
        .onAppear { model.start() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web `ToolCard` icon + title + description)

extension ColorConverter {
    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ColorConverterStrings.text("Color Converter", "Color Converter")
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                ColorConverterStrings.text("Color Converter Desc", "Color Converter Desc")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    /// The web `ICON_COLOR_MAP.purple` chip: a tinted palette glyph in a rounded,
    /// ringed square (neon-purple → the `chartSeriesPower` token, the design
    /// system's purple, matching the sibling purple devtools surfaces).
    private var iconChip: some View {
        Image(systemName: "paintpalette.fill")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(Color.TS.chartSeriesPower)
            .frame(width: 40, height: 40)
            .background(
                Color.TS.chartSeriesPower.opacity(0.1),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.chartSeriesPower.opacity(0.2), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Input row (web `Input` + color swatch)

extension ColorConverter {
    private var inputRow: some View {
        HStack(alignment: .bottom, spacing: TSSpacing.md) {
            hexField
            swatch
        }
    }

    private var hexField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ColorConverterStrings.text("Hex Color", "Hex Color")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "paintpalette")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                hexTextField
            }
            .padding(.horizontal, TSSpacing.sm)
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
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ColorConverterStrings.text("Hex Color", "Hex Color"))
        .accessibilityValue(Text(verbatim: model.hex))
    }

    private var hexTextField: some View {
        TextField(text: hexBinding, prompt: Text(verbatim: "#3b82f6")) {
            ColorConverterStrings.text("Hex Color", "Hex Color")
        }
        .labelsHidden()
        .textFieldStyle(.plain)
        .font(.system(.body, design: .monospaced))
        .foregroundStyle(Color.TS.textPrimary)
        .autocorrectionDisabled(true)
        #if os(iOS)
            .textInputAutocapitalization(.never)
        #endif
    }

    /// The live color swatch (web `<div style={{ backgroundColor: hex }}>`): fills
    /// with the parsed color when the hex is valid, otherwise a neutral, ringed
    /// fill so the control never collapses to an empty box.
    private var swatch: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(swatchFill)
            .frame(width: 40, height: 40)
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(ColorConverterStrings.text("Color Swatch", "Color swatch"))
            .accessibilityValue(Text(verbatim: model.hex))
    }

    private var swatchFill: Color {
        guard let breakdown = model.projection?.breakdown else { return Color.TS.surfaceGlass }
        return Self.color(for: breakdown)
    }

    /// Builds a display `Color` from the decoded channels, clamping each to the
    /// valid 0–1 range (the web CSS engine clamps out-of-range `rgb()` too).
    static func color(for breakdown: ColorBreakdown) -> Color {
        func channel(_ value: Int) -> Double {
            min(max(Double(value) / 255, 0), 1)
        }
        return Color(
            .sRGB,
            red: channel(breakdown.red),
            green: channel(breakdown.green),
            blue: channel(breakdown.blue),
            opacity: 1
        )
    }
}

// MARK: - Content states (web `parsed ? grid : null`)

extension ColorConverter {
    @ViewBuilder
    private var content: some View {
        if let projection = model.projection {
            channelGrid(projection)
        } else {
            emptyHint
        }
    }

    private var gridColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.sm)]
    }

    /// The RGB / HSL / HEX result cards (web `grid sm:grid-cols-3`), each with a
    /// copy button. Lays out three-up on regular width and reflows on compact.
    private func channelGrid(_ projection: ColorConverterProjection) -> some View {
        LazyVGrid(columns: gridColumns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(projection.channels) { channel in
                ColorChannelCard(channel: channel)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ColorConverterAccessibility.summary(for: projection)))
    }

    /// Friendly inline hint shown when the hex is not a six-digit value — the grid
    /// is hidden in the web source; native shows guidance instead of a blank box.
    private var emptyHint: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "paintpalette")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            ColorConverterStrings.text(
                "Color Converter Empty Hint",
                "Enter a 6-digit hex color (for example, #3b82f6) to see its RGB and HSL values."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Channel card

/// One result card: the channel label (`RGB`/`HSL`/`HEX`) over its formatted
/// value with a copy button (web `rounded bg-surface-overlay` card + `CopyButton`).
private struct ColorChannelCard: View {
    let channel: ColorChannel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: channel.kind.rawValue)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: channel.value)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                TSCopyButton(value: channel.value)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: channel.kind.rawValue))
        .accessibilityValue(Text(verbatim: channel.value))
    }
}
