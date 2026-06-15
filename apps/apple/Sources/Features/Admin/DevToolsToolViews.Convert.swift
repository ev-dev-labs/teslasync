import SwiftUI

// MARK: - Byte size converter (web `ByteSizeConverterTool`)

struct DevToolsBytesTool: View {
    @State private var value = ""
    @State private var unit = "B"

    private let columns = [GridItem(.adaptive(minimum: 90), spacing: TSSpacing.sm)]

    private var unitOptions: [TSSelectOption<String>] {
        DevToolsReferenceData.byteUnits.map { TSSelectOption($0, LocalizedStringKey($0)) }
    }

    private var conversions: [DevToolsUtilities.ByteConversion]? {
        guard let number = Double(value) else { return nil }
        return DevToolsUtilities.convertBytes(value: number, unit: unit)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .bottom, spacing: TSSpacing.md) {
                TSTextField("devtools.field.bytesHint", text: $value, label: "devtools.field.value")
                TSSelect(selection: $unit, options: unitOptions, label: "devtools.field.unit")
                    .frame(maxWidth: 120)
            }
            if let conversions {
                LazyVGrid(columns: columns, spacing: TSSpacing.sm) {
                    ForEach(conversions, id: \.unit) { conversion in
                        conversionCell(conversion)
                    }
                }
            }
        }
    }

    private func conversionCell(_ conversion: DevToolsUtilities.ByteConversion) -> some View {
        let isCurrent = conversion.unit == unit
        return VStack(spacing: 2) {
            Text(verbatim: conversion.unit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: conversion.value)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(isCurrent ? Color.TS.accent : Color.TS.textPrimary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .background(
            isCurrent ? Color.TS.accent.opacity(0.12) : Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Color converter (web `ColorConverterTool`)

struct DevToolsColorTool: View {
    @State private var hex = "#3b82f6"

    private var rgb: DevToolsUtilities.RGB? {
        DevToolsUtilities.hexToRGB(hex)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .bottom, spacing: TSSpacing.md) {
                TSTextField("devtools.field.hexHint", text: $hex, label: "devtools.field.hexColor")
                swatch
            }
            if let rgb {
                let hsl = DevToolsUtilities.rgbToHSL(rgb)
                formatRow("RGB", "rgb(\(rgb.red), \(rgb.green), \(rgb.blue))")
                formatRow("HSL", "hsl(\(hsl.hue), \(hsl.saturation)%, \(hsl.lightness)%)")
                formatRow("HEX", hex)
            }
        }
    }

    @ViewBuilder
    private var swatch: some View {
        let color = rgb.map { Color(
            .sRGB,
            red: Double($0.red) / 255,
            green: Double($0.green) / 255,
            blue: Double($0.blue) / 255
        ) }
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(color ?? Color.TS.surface)
            .frame(width: 40, height: 40)
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private func formatRow(_ name: String, _ value: String) -> some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: name)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 44, alignment: .leading)
            Text(verbatim: value)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
            Spacer(minLength: 0)
            DevToolsCopyButton(value: value)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Unix permission (web `UnixPermissionTool`)

struct DevToolsUnixPermTool: View {
    @State private var octal = "755"

    private var presetOptions: [TSSelectOption<String>] {
        [
            TSSelectOption("755", "755 (rwxr-xr-x)"),
            TSSelectOption("644", "644 (rw-r--r--)"),
            TSSelectOption("700", "700 (rwx------)"),
            TSSelectOption("600", "600 (rw-------)"),
            TSSelectOption("777", "777 (rwxrwxrwx)"),
            TSSelectOption("444", "444 (r--r--r--)")
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .bottom, spacing: TSSpacing.md) {
                TSTextField("devtools.field.octalHint", text: $octal, label: "devtools.field.octalPerm")
                TSSelect(selection: $octal, options: presetOptions, label: "devtools.field.presets")
            }
            if let permission = DevToolsUtilities.decodePermission(octal) {
                HStack(spacing: TSSpacing.sm) {
                    permCell("devtools.field.owner", permission.owner)
                    permCell("devtools.field.group", permission.group)
                    permCell("devtools.field.other", permission.other)
                }
                DevToolsResultRow(label: "devtools.field.symbolic", value: permission.symbolic, tone: .success)
            }
        }
    }

    private func permCell(_ label: LocalizedStringKey, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: value)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}
