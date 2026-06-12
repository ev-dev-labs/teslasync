//
//  VehiclePaintPicker.Views.swift
//  TeslaSync — P4 shared surface · 0234 · VehiclePaintPicker (Apple)
//
//  The presentational pieces of the picker — the native peers of the web elements: the section caption
//  (web `<span class="uppercase tracking-wider text-secondary">`), the labelled radiogroup swatch row
//  (web `role="radiogroup"` div + the `PAINT_PALETTE_LIST.map` of swatch `<button role="radio">`s), one
//  swatch dot (the `h-7 w-7 rounded-full` disc, its selected ring + checkmark, the Auto-detected hint),
//  the status row (the live current-paint name + the Reset affordance), and the friendly empty leaf (the
//  native "never a blank box" peer of a degenerate catalog with no palettes). All chrome is token-driven
//  (P1/S9); swatch fills resolve through `Color(vehiclePaintHex:)`. Decorative glyphs are hidden from
//  VoiceOver; each swatch is one labelled, selectable tap target carrying its name + selected value +
//  hint.
//

import SwiftUI

// MARK: - Section caption (web uppercase tracking label)

/// The section caption — the native peer of the web `<span class="text-xs uppercase tracking-wider
/// text-secondary">`. Marked as a header so VoiceOver users can navigate by section.
struct VehiclePaintSectionLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(TSTypeMetrics.labelTracking)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Swatch header (web `role="radiogroup"` row)

/// The section caption beside the radiogroup of swatches — the native peer of the web
/// `role="radiogroup"` row. The group carries the picker label so VoiceOver announces "Vehicle paint
/// color" and contains the radio swatches. The swatches reflow with Dynamic Type rather than porting the
/// web's fixed `gap` classes.
struct VehiclePaintSwatchHeader: View {
    let sectionLabel: String
    let pickerLabel: String
    let swatches: [VehiclePaintSwatch]
    let layout: VehiclePaintLayout
    let onSelect: (VehiclePaintPaletteID) -> Void

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: layout.swatchDiameter + 8), spacing: layout.swatchSpacing)]
    }

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            VehiclePaintSectionLabel(text: sectionLabel)
            LazyVGrid(columns: columns, alignment: .leading, spacing: layout.swatchSpacing) {
                ForEach(swatches) { swatch in
                    VehiclePaintSwatchButton(swatch: swatch, layout: layout) { onSelect(swatch.paletteID) }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: pickerLabel))
    }
}

// MARK: - Swatch dot (web swatch `<button role="radio">`)

/// One paint swatch — the native peer of the web swatch `<button>`: a filled disc tinted by the palette's
/// opaque colour, a selected ring + white checkmark (web `border-white scale-110` + the check SVG), and a
/// hairline border otherwise. One labelled, selectable radio carrying the name, the spoken selected
/// value, and the Auto-detected / selects hint.
struct VehiclePaintSwatchButton: View {
    let swatch: VehiclePaintSwatch
    let layout: VehiclePaintLayout
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            dot
                .scaleEffect(swatch.isSelected ? layout.selectedScale : 1)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: swatch.displayName))
        .accessibilityValue(Text(verbatim: swatch.isSelected ? VehiclePaintPickerStrings.selectedValue : ""))
        .accessibilityHint(Text(verbatim: hint))
        .accessibilityAddTraits(swatch.isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private var hint: String {
        swatch.isInferred ? VehiclePaintPickerStrings.detected : VehiclePaintPickerStrings.swatchHint
    }

    private var dot: some View {
        Circle()
            .fill(Color(vehiclePaintHex: swatch.swatchHex))
            .frame(width: layout.swatchDiameter, height: layout.swatchDiameter)
            .overlay(ring)
            .overlay { if swatch.isSelected { checkmark } }
            .shadow(
                color: swatch.isSelected ? Color.TS.accent.opacity(0.25) : .clear,
                radius: swatch.isSelected ? 4 : 0
            )
    }

    private var ring: some View {
        Circle()
            .strokeBorder(
                swatch.isSelected ? Color.white : Color.TS.border,
                lineWidth: 2
            )
    }

    private var checkmark: some View {
        Image(systemName: "checkmark")
            .font(.system(size: layout.swatchDiameter * 0.45, weight: .bold))
            .foregroundStyle(Color.white)
            .shadow(color: Color.black.opacity(0.6), radius: 1, y: 1)
            .accessibilityHidden(true)
    }
}

// MARK: - Status row (web live name + Reset)

/// The live current-paint name beside the Reset affordance — the native peers of the web `aria-live`
/// span (`t(paint.labelKey, …)`) and the `{isOverridden && <button>Reset…</button>}`. The name announces
/// politely when the selection changes; the Reset button appears only while a local override is active.
struct VehiclePaintStatusRow: View {
    let currentPaintName: String
    let showsReset: Bool
    let resetLabel: String
    let onReset: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: currentPaintName)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityAddTraits(.updatesFrequently)
            if showsReset {
                VehiclePaintResetButton(label: resetLabel, action: onReset)
            }
            Spacer(minLength: 0)
        }
    }
}

/// The Reset affordance — the native peer of the web underlined `<button>` (`t('paint.reset', …)`). A
/// borderless accent-tinted text button.
struct VehiclePaintResetButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.accent)
                .underline()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Empty leaf (native — never a blank box)

/// The friendly leaf shown when a degenerate catalog exposes no palettes at all — a labelled card rather
/// than a bare box (native HIG). Copy via the P1/S10 facade; combined into one VoiceOver element.
struct VehiclePaintPickerEmptyState: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "paintpalette")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: VehiclePaintPickerStrings.emptyTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: VehiclePaintPickerStrings.emptyMessage)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(VehiclePaintPickerStrings.emptyTitle). \(VehiclePaintPickerStrings.emptyMessage)")
        )
    }
}
