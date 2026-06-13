//
//  BottomTabBar.Views.swift
//  TeslaSync — P4 shared surface · 0165 · BottomTabBar (Apple)
//
//  The presentational pieces of the bottom tab bar — the native peers of the web elements: the tab item (web
//  `<PrefetchLink>` — the glyph, the label, the active tint, the icon glow, and the bottom accent bar) and the
//  friendly empty-catalog leaf (the native "never a blank box" peer of a tab list with nothing to show). All
//  chrome is token-driven (P1/S9); no raw hex, no Tailwind ports. The glyph is hidden from VoiceOver; the item
//  carries an explicit label + the selected trait when active (the spoken peer of the web `aria-current`).
//

import SwiftUI

// MARK: - BottomTabBarItem (web tab `<PrefetchLink>`)

/// One tab — the native peer of the web `<PrefetchLink>`: an SF Symbol glyph over a short label, tinted with
/// the theme accent when active (web `text-[var(--theme-primary)]`) or muted otherwise (web
/// `text-[var(--text-muted)]`), with an icon glow (web `drop-shadow`) and a bottom accent pill (web the
/// `absolute -bottom-0.5` bar) on the active tab. The whole cell is one ≥44pt tap target that triggers
/// `onSelect`, labelled for VoiceOver with the tab title + the selected trait when active.
struct BottomTabBarItem: View {
    let tab: BottomTabBarTabState
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: TSSpacing.xs) {
                icon
                Text(verbatim: tab.label)
                    .font(Font.TS.label)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .foregroundStyle(tab.isActive ? Color.TS.accent : Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.vertical, TSSpacing.xs)
            .overlay(alignment: .bottom) { activeIndicator }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: tab.label))
        .accessibilityAddTraits(tab.isActive ? [.isButton, .isSelected] : .isButton)
    }

    /// The tab glyph — the native peer of the web `lucide` icon. Active gets the theme accent + a soft glow
    /// (web `drop-shadow-[0_0_6px_currentColor]`); inactive is muted. Hidden from VoiceOver (the cell carries
    /// the label).
    private var icon: some View {
        Image(systemName: tab.symbol)
            .font(.system(size: 20, weight: tab.isActive ? .semibold : .regular))
            .foregroundStyle(tab.isActive ? Color.TS.accent : Color.TS.textMuted)
            .shadow(color: tab.isActive ? Color.TS.accent.opacity(0.6) : .clear, radius: tab.isActive ? 6 : 0)
            .accessibilityHidden(true)
    }

    /// The bottom accent pill shown only on the active tab — the native peer of the web
    /// `absolute -bottom-0.5 h-0.5 w-4 rounded-full bg-[var(--theme-primary)]` bar.
    @ViewBuilder
    private var activeIndicator: some View {
        if tab.isActive {
            Capsule(style: .continuous)
                .fill(Color.TS.accent)
                .frame(width: 16, height: 2)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - BottomTabBarEmptyState (native — never a blank box)

/// The friendly leaf shown when a host passes no tabs — a labelled row rather than a bare box (native HIG). The
/// web `TABS` constant is never empty, so this has no web peer; it satisfies the P4 always-render contract.
/// Token-driven (P1/S9); copy via the P1/S10 facade; combined into a single VoiceOver element.
struct BottomTabBarEmptyState: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "square.dashed")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .padding(.horizontal, TSSpacing.md)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }
}
