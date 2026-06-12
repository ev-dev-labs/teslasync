//
//  ThemePicker.Views.swift
//  TeslaSync — P4 shared surface · 0228 · ThemePicker (Apple)
//
//  The presentational pieces of the Display-Mode half of the picker — the native peers of the web
//  elements: the section label (web `<p class="uppercase tracking-wider text-muted">`), the responsive
//  mode grid (web `grid grid-cols-…`), one mode card (web mode `<Button>` — the icon box, the name, the
//  four background→surface swatches, and the selected checkmark), and the friendly empty leaf (the
//  native "never a blank box" peer of a degenerate store with no themes). All chrome is token-driven
//  (P1/S9); colour swatches resolve their hex through `Color(themePickerHex:)`. The decorative icon +
//  swatches are hidden from VoiceOver; each card is one labelled, selectable tap target.
//

import SwiftUI

// MARK: - Section label (web uppercase tracking caption)

/// The section caption — the native peer of the web `<p class="text-xs uppercase tracking-wider
/// text-muted">`. Marked as a header so VoiceOver users can navigate by section.
struct ThemePickerSectionLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Mode section (web `{showMode && …}` grid)

/// The Display-Mode section — the section label over a responsive grid of mode cards. The adaptive
/// columns reflow across iPhone / iPad / Mac (HIG) instead of porting the web's fixed Tailwind columns.
struct ThemePickerModeSection: View {
    let title: String
    let options: [ThemePickerModeOption]
    let layout: ThemePickerLayout
    let onSelect: (String) -> Void

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: layout.modeMinItemWidth), spacing: layout.gridSpacing)]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ThemePickerSectionLabel(text: title)
            LazyVGrid(columns: columns, alignment: .leading, spacing: layout.gridSpacing) {
                ForEach(options) { option in
                    ThemePickerModeCard(option: option) { onSelect(option.id) }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Mode card (web mode `<Button>`)

/// One Display-Mode card — the native peer of the web mode `<Button>`: a leading icon box (its chrome
/// tinted by the mode's own `surface3` / `glassBorder` / `textPrimary`), the localized name over the
/// four background→surface preview swatches, and a trailing checkmark when active. The whole row is one
/// tap target carrying the name + selected value + a hint.
struct ThemePickerModeCard: View {
    let option: ThemePickerModeOption
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.md) {
                iconBox
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(verbatim: option.displayName)
                        .font(Font.TS.body)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    swatchRow
                }
                Spacer(minLength: 0)
                if option.isSelected { checkmark }
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(
            option.isSelected ? Color.TS.surfaceGlass : Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(border)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: option.displayName))
        .accessibilityValue(Text(verbatim: option.isSelected ? ThemePickerStrings.selectedValue : ""))
        .accessibilityHint(Text(verbatim: ThemePickerStrings.modeHint))
        .accessibilityAddTraits(option.isSelected ? [.isButton, .isSelected] : .isButton)
    }

    private var border: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .strokeBorder(
                option.isSelected ? Color.TS.accent : Color.TS.border,
                lineWidth: option.isSelected ? 2 : 1
            )
    }

    private var checkmark: some View {
        Image(systemName: "checkmark.circle.fill")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .accessibilityHidden(true)
    }

    private var iconBox: some View {
        Image(systemName: option.iconSystemName)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color(themePickerHex: option.iconForegroundHex))
            .frame(width: 32, height: 32)
            .background(
                Color(themePickerHex: option.iconBackgroundHex),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color(themePickerHex: option.iconBorderHex), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var swatchRow: some View {
        HStack(spacing: 3) {
            ForEach(option.swatchHexes.indices, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(Color(themePickerHex: option.swatchHexes[index]))
                    .frame(width: 16, height: 8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .strokeBorder(Color.TS.border, lineWidth: 0.5)
                    )
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Empty leaf (native — never a blank box)

/// The friendly leaf shown when a degenerate store exposes no themes at all — a labelled card rather
/// than a bare box (native HIG). Copy via the P1/S10 facade; combined into one VoiceOver element.
struct ThemePickerEmptyState: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "paintpalette")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: ThemePickerStrings.emptyTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: ThemePickerStrings.emptyMessage)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(ThemePickerStrings.emptyTitle). \(ThemePickerStrings.emptyMessage)")
        )
    }
}
