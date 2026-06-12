//
//  SortControl.Views.swift
//  TeslaSync — P4 shared surface · 0159 · SortControl (Apple)
//
//  The presentational pieces of the list sort control — the native peers of the web elements: the field
//  dropdown (web `<Select size="sm">` → a SwiftUI `Menu`, the HIG-idiomatic pop-up selector), the direction
//  toggle (web `<button>` → an SF Symbol `Button` flipping ascending / descending), the friendly
//  empty-field chip, and the composed row (web `inline-flex items-center gap-1`). All chrome is token-driven
//  (P1/S9); no raw hex, no Tailwind ports. The decorative SF Symbols are hidden from VoiceOver; the menu
//  carries the "Sort by" accessible name with the selected field as its value, each menu item is a real
//  `Button` with a checkmark on the chosen field (web `<option selected>`), and the direction `Button`
//  carries the resolved "Sort direction: …" accessible name (web `aria-label`). The arrow swap animates with
//  the standard token unless the user has Reduce Motion on.
//

import SwiftUI

// MARK: - Layout constants (web control metrics)

/// The control's precise metrics — the native peers of the web Tailwind utilities (`gap-1` = 4pt, the
/// direction button `h-8 w-8` = 32pt, the glyph `h-3.5 w-3.5` = 14pt, `ring-2` = 2pt, the field `<select
/// size="sm">` `px-2 py-1.5` = 8/6pt). Kept as named constants so the small, control-specific values are
/// documented rather than scattered magic numbers.
enum SortControlLayout {
    /// Gap between the field dropdown and the direction button (web `gap-1`).
    static let rowSpacing: CGFloat = 4
    /// The square direction button's side (web `h-8 w-8`).
    static let directionButtonSide: CGFloat = 32
    /// Glyph size for the direction arrow (web `h-3.5 w-3.5`).
    static let iconSize: CGFloat = 14
    /// Focus-ring stroke width (web `focus-visible:ring-2`).
    static let focusRingWidth: CGFloat = 2
    /// Vertical inset of the field trigger (web `py-1.5`).
    static let fieldPaddingV: CGFloat = 6
}

// MARK: - Field dropdown (web `<Select size="sm">`)

/// The sort-field dropdown — the native parity of the web `<Select>`. A SwiftUI `Menu` whose label reads
/// like a compact select (the selected field's label + an up/down chevron) and whose items are one `Button`
/// per option, the chosen field carrying a checkmark (web `<option selected>`). VoiceOver announces it as a
/// pop-up button named "Sort by" with the selected field as its value.
struct SortControlFieldMenu: View {
    let projection: SortControlProjection
    let onSelect: (String) -> Void

    var body: some View {
        Menu {
            ForEach(projection.options) { option in
                Button {
                    onSelect(option.value)
                } label: {
                    if option.value == projection.field {
                        Label(option.label, systemImage: "checkmark")
                    } else {
                        Text(verbatim: option.label)
                    }
                }
            }
        } label: {
            SortControlFieldTriggerLabel(title: projection.fieldTriggerLabel)
        }
        .accessibilityLabel(Text(verbatim: projection.fieldMenuLabel))
        .accessibilityValue(Text(verbatim: projection.fieldTriggerLabel))
        .accessibilityIdentifier(projection.fieldIdentifier)
    }
}

/// The dropdown trigger's chrome — the selected field's label plus the up/down chevron that marks it as a
/// selector, on the bordered translucent surface the web `<select>` uses (`bg-[var(--surface-1)]`,
/// `border-[var(--glass-border)]`, `rounded-md`, compact `size="sm"` padding + `text-xs`).
private struct SortControlFieldTriggerLabel: View {
    let title: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: title)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, SortControlLayout.fieldPaddingV)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }
}

// MARK: - Direction toggle (web `<button>` + ArrowUp/ArrowDown)

/// The ascending / descending toggle — the native parity of the web direction `<button>`: a square SF
/// Symbol button (`arrow.up` for ascending, `arrow.down` for descending) that flips the direction on tap.
/// It is a real `Button`, so tap, VoiceOver, Switch Control, and Full Keyboard Access all work; the glyph
/// is decorative (hidden from VoiceOver) since the resolved "Sort direction: …" label already names the
/// state. The arrow swap animates unless Reduce Motion is on, and a focus ring mirrors the web
/// `focus-visible:ring-2`.
struct SortControlDirectionButton: View {
    let projection: SortControlProjection
    let reduceMotion: Bool
    let action: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        Button(action: action) {
            Image(systemName: projection.directionSystemImage)
                .font(.system(size: SortControlLayout.iconSize, weight: .medium))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(
                    width: SortControlLayout.directionButtonSide,
                    height: SortControlLayout.directionButtonSide
                )
                .background(
                    Color.TS.surface.opacity(0.4),
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(
                            isFocused ? Color.TS.accent : Color.TS.border,
                            lineWidth: isFocused ? SortControlLayout.focusRingWidth : 1
                        )
                )
                .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .accessibilityHidden(true)
        }
        .buttonStyle(.plain)
        .focused($isFocused)
        .animation(
            reduceMotion ? nil : .easeInOut(duration: TSMotion.fastDuration),
            value: projection.directionSystemImage
        )
        .accessibilityLabel(Text(verbatim: projection.directionAccessibilityLabel))
        .accessibilityIdentifier(projection.directionIdentifier)
    }
}

// MARK: - Empty field chip (native — never a bare box)

/// The friendly empty state shown in place of the dropdown when no field options are supplied. The web
/// would render an empty `<select>`; the native HIG calls for a labelled empty state rather than a bare
/// box, so the control still reads as a sort field with nothing to choose (the direction toggle keeps
/// rendering alongside it, matching the web button which is not gated on the options).
struct SortControlEmptyFieldView: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: SortControlStrings.empty)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, SortControlLayout.fieldPaddingV)
        .background(
            Color.TS.surface.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Row (web `inline-flex items-center gap-1`)

/// The composed control — the native parity of the web `<div className="inline-flex items-center gap-1">`:
/// the field dropdown (or the empty chip when there are no options) followed by the direction toggle, hugging
/// its content. Pure composition over the resolved projection; the routing closures come from the holder.
struct SortControlRow: View {
    let projection: SortControlProjection
    let reduceMotion: Bool
    let onSelectField: (String) -> Void
    let onToggleDirection: () -> Void

    var body: some View {
        HStack(spacing: SortControlLayout.rowSpacing) {
            if projection.hasNoOptions {
                SortControlEmptyFieldView()
            } else {
                SortControlFieldMenu(projection: projection, onSelect: onSelectField)
            }
            SortControlDirectionButton(
                projection: projection,
                reduceMotion: reduceMotion,
                action: onToggleDirection
            )
        }
        .fixedSize()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(projection.resolvedIdentifier)
    }
}
