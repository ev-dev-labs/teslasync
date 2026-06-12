//
//  StickyChipBar.Views.swift
//  TeslaSync — P4 shared surface · 0200 · StickyChipBar (Apple)
//
//  The presentational pieces of the in-page section nav — the native peers of the web elements: one
//  pill-shaped chip (web `<button>` capsule, with the active / inactive styling) and the friendly empty
//  view (native — the web renders a bare empty nav, which natively would be a blank box). All chrome is
//  token-driven (P1/S9): the active pill uses the brand accent tint + ring (web `bg-cyan-400/15
//  text-cyan-200 ring-cyan-400/30`), the inactive pill uses the surface fill + hairline border (web
//  `bg-[var(--surface-2)] text-[var(--text-secondary)]`). No raw hex, no Tailwind ports. Each chip is one
//  VoiceOver button labelled by its section name, carries the "selected" trait when active (web
//  `aria-current`), and exposes the jump hint; the decorative empty glyph is hidden from VoiceOver.
//

import SwiftUI

// MARK: - SectionChipView (web pill `<button>`)

/// One jump-to-section pill — the native peer of the web chip `<button>`. Tapping it routes to the
/// surface's ``StickyChipBarModel/select(_:)`` (web `onClick={() => handleClick(chip.id)}`). The active
/// pill is tinted with the brand accent + an accent ring (web `bg-cyan-400/15 ring-cyan-400/30`); the
/// inactive pill uses the surface fill + the hairline border (web `bg-[var(--surface-2)]`). The pill is a
/// single VoiceOver button: its label is the section name, it gains the `.isSelected` trait when active
/// (web `aria-current`), and it carries the jump hint.
struct SectionChipView: View {
    let chip: SectionChip
    let isActive: Bool
    let hint: String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text(verbatim: chip.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .lineLimit(1)
                .foregroundStyle(isActive ? Color.TS.accent : Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .frame(minHeight: 32)
                .background(fill)
                .overlay(
                    Capsule().strokeBorder(
                        isActive ? Color.TS.accent.opacity(0.4) : Color.TS.border,
                        lineWidth: 1
                    )
                )
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: chip.label))
        .accessibilityHint(Text(verbatim: hint))
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }

    private var fill: some View {
        Capsule().fill(isActive ? Color.TS.accent.opacity(0.15) : Color.TS.surface.opacity(0.5))
    }
}

// MARK: - Empty view (native — never a blank box)

/// The friendly body shown when there are no chips. The web renders a bare empty nav; the native HIG
/// calls for a labelled empty view rather than an empty bar. One combined VoiceOver element; the leading
/// glyph is decorative and hidden from assistive technology.
struct StickyChipBarEmptyView: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "list.bullet")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: StickyChipBarStrings.empty)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
    }
}
