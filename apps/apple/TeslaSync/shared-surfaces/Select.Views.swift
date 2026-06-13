//
//  Select.Views.swift
//  TeslaSync — P4 shared surface · 0225 · Select (Apple)
//
//  The presentational pieces of the form select — the native peers of the web elements: the size scale
//  resolution (web `sizeClasses[size]` → a SwiftUI `controlSize` + token padding/font), the field chrome (web
//  `rounded-md border bg-surface-1`, reddened on error), the menu trigger (the collapsed `<select>` showing
//  the current value or the prompt + a disclosure chevron), the per-option rows honouring the `disabled` flag
//  (web `<option disabled>`) with a checkmark on the selected one, the error / hint captions (web `<p
//  className="text-xs …">`), and the "never a blank box" empty control. All chrome is token-driven (P1/S9);
//  no raw hex, no Tailwind ports. Each piece is a pure function of the projection so the public view stays a
//  thin composition and every branch renders.
//

import SwiftUI

// MARK: - Size scale (web `sizeClasses[size]`)

/// The native peer of the web `sizeClasses` map: each ``SelectSize`` resolves to a SwiftUI `controlSize`
/// (so the control scales natively) plus the token padding + font for the trigger box. The web `auto`
/// (density-driven) folds to the regular metrics here — the density is an app-level concern applied above
/// this presentational surface, documented rather than faked.
struct SelectSizeStyle {
    let controlSize: ControlSize
    let font: Font
    let horizontalPadding: CGFloat
    let verticalPadding: CGFloat

    static func resolve(for size: SelectSize) -> SelectSizeStyle {
        switch size {
        case .small:
            SelectSizeStyle(
                controlSize: .small,
                font: Font.TS.bodySm,
                horizontalPadding: TSSpacing.sm,
                verticalPadding: TSSpacing.xs
            )
        case .large:
            SelectSizeStyle(
                controlSize: .large,
                font: Font.TS.body,
                horizontalPadding: TSSpacing.lg,
                verticalPadding: TSSpacing.md
            )
        case .medium, .auto:
            SelectSizeStyle(
                controlSize: .regular,
                font: Font.TS.body,
                horizontalPadding: TSSpacing.md,
                verticalPadding: TSSpacing.sm
            )
        }
    }
}

// MARK: - Field chrome (web `rounded-md border bg-surface-1`, red on error)

/// The select's box chrome — the native peer of the web `w-full rounded-md border border-[glass-border]
/// bg-surface-1`, with the border reddened when errored (web `error && 'border-red-500'`). Token-driven; the
/// danger border is the P1/S9 `statusDanger` (the native peer of `border-red-500`).
struct SelectFieldChrome: ViewModifier {
    let isInvalid: Bool
    let horizontalPadding: CGFloat
    let verticalPadding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, verticalPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(
                        isInvalid ? Color.TS.statusDanger : Color.TS.border,
                        lineWidth: 1
                    )
            )
    }
}

// MARK: - Trigger (the collapsed `<select>` face)

/// The collapsed select face — the current value (or the unselected prompt, muted) plus a disclosure chevron.
/// The native peer of the closed `<select>` box. Muted when showing the prompt or the empty leaf (the native
/// peer of an unselected `<select>` rendering its prompt copy in a lighter tone).
struct SelectTriggerLabel: View {
    let title: String
    let isMuted: Bool
    let font: Font

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: title)
                .font(font)
                .foregroundStyle(isMuted ? Color.TS.textMuted : Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: TSSpacing.sm)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Captions (web `<p className="text-xs …">`)

/// The error / hint caption under the control — the native peer of the web `<p id="…-error"
/// className="text-xs text-red-500">` and `<p id="…-hint" className="text-xs text-muted">`. The error caption
/// uses the P1/S9 danger color; the hint uses the muted color. The element id (web `\(id)-error` / `-hint`)
/// is surfaced as the accessibility identifier so the described-by association survives.
struct SelectCaption: View {
    enum Kind {
        case error
        case hint
    }

    let text: String
    let kind: Kind
    let elementID: String?

    private var color: Color {
        switch kind {
        case .error: Color.TS.statusDanger
        case .hint: Color.TS.textMuted
        }
    }

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier(elementID ?? "")
    }
}

// MARK: - Menu rows (web `<option>` / `<option disabled>`)

/// One row inside the open menu — the native peer of a web `<option>`. The selected row carries a leading
/// checkmark (the native peer of the browser's selected-option highlight); the unselected rows are plain
/// text. Rendered verbatim (the labels are already localized by the caller).
struct SelectMenuRowLabel: View {
    let title: String
    let isSelected: Bool

    var body: some View {
        if isSelected {
            Label(title, systemImage: "checkmark")
        } else {
            Text(verbatim: title)
        }
    }
}

/// The open-menu body — the unselected prompt row (web `<option value="">`) when present, then one row per
/// option, each disabled per its `disabled` flag (web `<option disabled>`). Selecting a row forwards the
/// option value (or `""` for the prompt) to the holder.
struct SelectMenuContent: View {
    let projection: SelectProjection
    let selection: String
    let onSelect: (String) -> Void

    var body: some View {
        if projection.showsPrompt, let prompt = projection.prompt {
            Button {
                onSelect("")
            } label: {
                SelectMenuRowLabel(title: prompt, isSelected: selection.isEmpty)
            }
        }
        ForEach(projection.options) { option in
            Button {
                onSelect(option.value)
            } label: {
                SelectMenuRowLabel(title: option.label, isSelected: option.value == selection)
            }
            .disabled(option.isDisabled)
        }
    }
}

// MARK: - Empty leaf (native "never a blank box")

/// The empty control — the native peer of a web `<select>` with no options. Rather than render a bare,
/// tappable empty box, the native HIG peer shows a disabled, muted trigger carrying the localized empty copy,
/// so the surface never presents a blank box. A REAL "no rows" branch (the acceptance `empty`).
struct SelectEmptyControl: View {
    let projection: SelectProjection
    let style: SelectSizeStyle

    var body: some View {
        SelectTriggerLabel(title: projection.emptyText, isMuted: true, font: style.font)
            .modifier(SelectFieldChrome(
                isInvalid: projection.isInvalid,
                horizontalPadding: style.horizontalPadding,
                verticalPadding: style.verticalPadding
            ))
            .controlSize(style.controlSize)
            .opacity(0.6)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: projection.accessibilityLabel))
            .accessibilityValue(Text(verbatim: projection.emptyText))
            .accessibilityIdentifier(projection.resolvedID ?? "")
    }
}
