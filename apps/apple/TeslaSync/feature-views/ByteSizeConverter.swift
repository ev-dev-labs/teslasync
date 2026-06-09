//
//  ByteSizeConverter.swift
//  TeslaSync — P4 feature view · 0012 · ByteSizeConverter (Apple)
//
//  The SwiftUI parity of
//  features/admin/components/devtools/tools/ByteSizeConverter.tsx — a devtools
//  tool that converts a value at one binary byte unit into all five units
//  (B/KB/MB/GB/TB). Binds through `ByteSizeConverterModel` (no networking in the
//  view); renders the web `ToolCard` chrome, the value input + unit selector, and
//  both states (parseable value → the highlighted five-cell conversion grid;
//  unparseable → a friendly hint). Built from design tokens (P1/S9) + shared
//  components.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension ByteSizeConverterStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in
    /// the model file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - ByteSizeConverter (the devtools feature view)

/// The composable byte-size devtools surface — SwiftUI parity of
/// `ByteSizeConverter.tsx`. Renders the `ToolCard` shell, the value input and
/// unit selector, and the converted breakdown (or a friendly hint when the value
/// is not a number), binding through `ByteSizeConverterModel`.
public struct ByteSizeConverter: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ByteSizeConverterSurface.slug

    @State private var model: ByteSizeConverterModel

    public init(model: ByteSizeConverterModel = ByteSizeConverterModel()) {
        _model = State(initialValue: model)
    }

    /// Two-way binding the value text field uses, routing every edit through the
    /// model so the projection re-derives.
    private var valueBinding: Binding<String> {
        Binding(
            get: { model.value },
            set: { newValue in model.value = newValue }
        )
    }

    /// Two-way binding the unit picker uses.
    private var unitBinding: Binding<ByteSizeUnit> {
        Binding(
            get: { model.unit },
            set: { newUnit in model.unit = newUnit }
        )
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    valueField
                    unitPicker
                    content
                }
            }
        }
        .onAppear { model.start() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web `ToolCard` icon + title + description)

extension ByteSizeConverter {
    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ByteSizeConverterStrings.text("Byte Size", "Byte Size")
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                ByteSizeConverterStrings.text("Byte Size Desc", "Byte Size Desc")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    /// The web `ICON_COLOR_MAP.cyan` chip: a tinted hard-drive glyph in a
    /// rounded, ringed square (neon-cyan → the `accent` token).
    private var iconChip: some View {
        Image(systemName: "internaldrive")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 40, height: 40)
            .background(
                Color.TS.accent.opacity(0.1),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.accent.opacity(0.2), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Inputs (web `Input` + `Select`)

extension ByteSizeConverter {
    private var valueField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ByteSizeConverterStrings.text("Value", "Value")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "internaldrive")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                valueTextField
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
        .accessibilityLabel(ByteSizeConverterStrings.text("Value", "Value"))
        .accessibilityValue(Text(verbatim: model.value))
    }

    private var valueTextField: some View {
        TextField(text: valueBinding, prompt: Text(verbatim: "1024")) {
            ByteSizeConverterStrings.text("Value", "Value")
        }
        .labelsHidden()
        .textFieldStyle(.plain)
        .font(.system(.body, design: .monospaced))
        .foregroundStyle(Color.TS.textPrimary)
        .autocorrectionDisabled(true)
        #if os(iOS)
            .keyboardType(.decimalPad)
            .textInputAutocapitalization(.never)
        #endif
    }

    private var unitPicker: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ByteSizeConverterStrings.text("Unit", "Unit")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Picker(selection: unitBinding) {
                ForEach(ByteSizeUnit.allCases) { unit in
                    Text(verbatim: unit.symbol).tag(unit)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(ByteSizeConverterStrings.text("Unit", "Unit"))
            .accessibilityValue(Text(verbatim: model.unit.symbol))
        }
    }
}

// MARK: - Content states (web `conversions ? grid : null`)

extension ByteSizeConverter {
    @ViewBuilder
    private var content: some View {
        if let projection = model.projection {
            conversionGrid(projection)
        } else {
            emptyHint
        }
    }

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: ByteSizeUnit.allCases.count)
    }

    /// The five `B/KB/MB/GB/TB` conversion cells (web `grid grid-cols-5`); the
    /// selected unit is highlighted with the cyan fill + ring, matching the web
    /// `bg-neon-cyan/10 ring-1 ring-neon-cyan/30`.
    private func conversionGrid(_ projection: ByteSizeProjection) -> some View {
        LazyVGrid(columns: gridColumns, spacing: TSSpacing.sm) {
            ForEach(projection.conversions) { conversion in
                ByteSizeConversionCell(conversion: conversion)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ByteSizeAccessibility.summary(for: projection)))
    }

    /// Friendly inline hint shown when the value is not a number — the grid is
    /// hidden in the web source; native shows guidance instead of a blank box.
    private var emptyHint: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "number")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            ByteSizeConverterStrings.text(
                "Byte Size Empty Hint",
                "Enter a number (for example, 1024) to convert it across every byte unit."
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

// MARK: - Conversion cell

/// One conversion tile: the unit symbol over its formatted value. The selected
/// unit gets the cyan fill + ring (web highlight); the value text stays primary
/// for every cell, exactly like the web `text-white` value.
private struct ByteSizeConversionCell: View {
    let conversion: ByteSizeConversion

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: conversion.unit.symbol)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: conversion.value)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, TSSpacing.sm)
        .background(background)
        .overlay(ring)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: conversion.unit.symbol))
        .accessibilityValue(Text(verbatim: conversion.value))
        .accessibilityAddTraits(conversion.isSelected ? [.isSelected] : [])
    }

    private var background: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(conversion.isSelected ? Color.TS.accent.opacity(0.1) : Color.TS.surfaceGlass)
    }

    @ViewBuilder
    private var ring: some View {
        if conversion.isSelected {
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.accent.opacity(0.3), lineWidth: 1)
        }
    }
}
