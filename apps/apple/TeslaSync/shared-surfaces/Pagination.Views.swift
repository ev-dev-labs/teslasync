//
//  Pagination.Views.swift
//  TeslaSync — P4 shared surface · 0221 · Pagination (Apple)
//
//  The presentational pieces of the table pagination controls — the native peers of the web elements: the
//  visible-window summary (web the `<span aria-live="polite">`), the page-size selector (web the
//  `<select>`), the four navigation buttons (web the `<button aria-label>` cluster), and the page indicator
//  (web the `<span aria-current="page">`). All chrome is token-driven (P1/S9): the copy is muted, the
//  navigation glyphs brighten on hover (web `text-muted` → `hover:text-primary`) and dim to
//  `disabledOpacity` when disabled (web `disabled:opacity-30`), and the selector sits on the glass surface
//  with a hairline border (web `bg-white/[0.04] ring-1 ring-white/[0.08]`). No raw hex, no Tailwind ports.
//  Each navigation button is one VoiceOver button named by its resolved label (web `aria-label`); the glyphs
//  are decorative (web `aria-hidden`); the glyph scales with Dynamic Type via `@ScaledMetric`.
//

import SwiftUI

// MARK: - PaginationButton (web first / prev / next / last `<button aria-label>`)

/// One navigation button — the native peer of a web `<button aria-label disabled>` with a chevron glyph: a
/// plain button that tints the glyph muted, brightens it on hover while enabled (web `text-muted` →
/// `hover:text-primary`), dims to ``PaginationLayout/disabledOpacity`` and stops responding when disabled
/// (web `disabled:opacity-30 disabled:pointer-events-none`), and exposes its resolved accessible name (web
/// `aria-label`). The glyph is decorative — the button carries the name — so it is hidden from VoiceOver
/// (web `aria-hidden`) and scales with Dynamic Type via `@ScaledMetric`.
struct PaginationButton: View {
    let symbol: String
    let label: String
    let isEnabled: Bool
    let action: () -> Void

    @State private var isHovering = false
    @ScaledMetric(relativeTo: .body) private var glyphSide: CGFloat = PaginationLayout.iconSide

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: glyphSide, weight: .regular))
                .foregroundStyle(foreground)
                .padding(PaginationLayout.buttonPadding)
                .contentShape(Rectangle())
                .accessibilityHidden(true)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : PaginationLayout.disabledOpacity)
        .onHover { isHovering = $0 && isEnabled }
        .accessibilityLabel(Text(verbatim: label))
        .help(Text(verbatim: label))
    }

    private var foreground: Color {
        guard isEnabled else { return Color.TS.textMuted }
        return isHovering ? Color.TS.textPrimary : Color.TS.textMuted
    }
}

// MARK: - PaginationPageIndicator (web `<span aria-current="page">`)

/// The current-page indicator — the native peer of the web `<span aria-current="page">{page} / {totalPages}`:
/// the visible `page / totalPages` text in the secondary color, named for VoiceOver by the resolved "Page X
/// of Y" copy (web `aria-label`). `monospacedDigit` keeps the glyph metrics stable as the numbers change.
struct PaginationPageIndicator: View {
    let text: String
    let accessibilityLabel: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, PaginationLayout.indicatorPadding)
            .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - PaginationShowingLabel (web `<span aria-live="polite">`)

/// The visible-window summary — the native peer of the web `<span aria-live="polite" aria-atomic="true">`:
/// the muted "Showing X–Y of Z" copy. `monospacedDigit` stabilizes the numbers; the polite live-region
/// re-announcement on change is owned by the root ``PaginationView`` (an announcement keyed on this copy).
struct PaginationShowingLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - PaginationPageSizeMenu (web `<select>`)

/// The rows-per-page selector — the native peer of the web `<select aria-label>`: a `Menu` whose label shows
/// the current "N / page" choice with a trailing dropdown chevron, listing every option (the selected one
/// carries a checkmark). Sits on the glass surface with a hairline border (web `bg-white/[0.04] ring-1
/// ring-white/[0.08]`) and is named for VoiceOver by the resolved "Rows per page" copy (web `aria-label`).
struct PaginationPageSizeMenu: View {
    let selected: Int
    let options: [Int]
    let accessibilityLabel: String
    let optionLabel: (Int) -> String
    let onSelect: (Int) -> Void

    var body: some View {
        Menu {
            ForEach(options, id: \.self) { option in
                Button {
                    onSelect(option)
                } label: {
                    if option == selected {
                        Label(optionLabel(option), systemImage: "checkmark")
                    } else {
                        Text(verbatim: optionLabel(option))
                    }
                }
            }
        } label: {
            menuLabel
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityValue(Text(verbatim: optionLabel(selected)))
    }

    private var menuLabel: some View {
        HStack(spacing: PaginationLayout.controlSpacing) {
            Text(verbatim: optionLabel(selected))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Image(systemName: "chevron.down")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, PaginationLayout.pageSizeHorizontalPadding)
        .padding(.vertical, PaginationLayout.pageSizeVerticalPadding)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}
