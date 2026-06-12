//
//  PillFilterBar.Views.swift
//  TeslaSync — P4 shared surface · 0156 · PillFilterBar (Apple)
//
//  The presentational pieces of the pill / tab filter row — the native peers of the web elements: the
//  accent → token colour map (web `ACCENT_PILL` / `ACCENT_TAB`), one pill or tab button (web `<button
//  role="tab">` — the rounded chip with the selected dot, or the underlined tab), and the friendly empty
//  empty state. All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports. Decorative glyphs (the
//  selected dot, the leading icon) are hidden from VoiceOver; each pill exposes the WAI-ARIA Tabs role as
//  the native `.isSelected` button trait, carries its localised label, surfaces its count as the
//  accessibility value, and handles Left / Right / Home / End to move selection + focus (web
//  `handleKeyDown`).
//

import SwiftUI

// MARK: - Accent → token colour map (web `ACCENT_PILL` / `ACCENT_TAB`)

/// Maps a ``PillAccent`` to its single brand tint, drawn from the design tokens (P1/S9) rather than ported
/// Tailwind palette classes. The web uses six tints (cyan / green / amber / red / purple / blue) for the
/// active fill, ring, dot, and underline; the native peer derives the fill / ring / text / dot opacities
/// from this one token so light, dark, and high-contrast themes all stay correct.
struct PillAccentStyle {
    let tint: Color

    init(_ accent: PillAccent) {
        tint = switch accent {
        case .cyan: Color.TS.accent
        case .green: Color.TS.statusSuccess
        case .amber: Color.TS.statusWarning
        case .red: Color.TS.statusDanger
        case .purple: Color.TS.chartSeriesPower
        case .blue: Color.TS.chartSeriesSpeed
        }
    }

    /// The active chip fill (web `bg-{accent}-500/15`).
    var activeFill: Color {
        tint.opacity(0.15)
    }

    /// The active chip ring (web `ring-1 ring-{accent}-400/40`).
    var activeRing: Color {
        tint.opacity(0.40)
    }
}

// MARK: - Pill / tab button (web `<button role="tab">`)

/// One pill or tab — the native peer of the web `<button role="tab">`. In `pills` it is a rounded chip
/// (selected → accent fill + ring + a leading dot); in `tabs` it is an underlined row item (selected →
/// accent text + a 2pt bottom border). The label/value text is one VoiceOver element exposing the
/// `.isSelected` trait; the row is keyboard-navigable with Left / Right (wrap, skipping disabled), Home,
/// and End — routed through the state-holder (web `handleKeyDown` → `moveFocus`).
struct PillFilterBarPill: View {
    let resolved: ResolvedPill
    let variant: PillVariant
    let model: PillFilterBarModel
    var focus: FocusState<String?>.Binding

    private var item: PillItem {
        resolved.item
    }

    private var style: PillAccentStyle {
        PillAccentStyle(item.accent)
    }

    var body: some View {
        Button {
            model.select(item.key)
        } label: {
            content
        }
        .buttonStyle(.plain)
        .disabled(item.disabled)
        .opacity(item.disabled ? 0.4 : 1)
        .focused(focus, equals: item.key)
        .accessibilityLabel(Text(verbatim: item.label))
        .accessibilityValue(Text(verbatim: resolved.formattedCount ?? ""))
        .accessibilityAddTraits(resolved.isSelected ? [.isButton, .isSelected] : .isButton)
        .onKeyPress(.leftArrow) { model.move(.backward); return .handled }
        .onKeyPress(.rightArrow) { model.move(.forward); return .handled }
        .onKeyPress(.home) { model.moveToFirst(); return .handled }
        .onKeyPress(.end) { model.moveToLast(); return .handled }
    }

    @ViewBuilder private var content: some View {
        switch variant {
        case .pills: pillContent
        case .tabs: tabContent
        }
    }

    /// The `pills` chip — a leading dot when selected (web `variant === 'pills' && selected`), the optional
    /// icon, the label, and the muted count suffix, inside a capsule with the active fill + ring.
    private var pillContent: some View {
        row(font: Font.TS.caption)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(resolved.isSelected ? style.activeFill : Color.clear, in: Capsule())
            .overlay {
                if resolved.isSelected {
                    Capsule().strokeBorder(style.activeRing, lineWidth: 1)
                }
            }
            .foregroundStyle(resolved.isSelected ? style.tint : Color.TS.textMuted)
    }

    /// The `tabs` item — the optional icon, the label, and the muted count suffix, with a 2pt accent
    /// bottom border when selected (web `border-b-2 border-{accent}-400`).
    private var tabContent: some View {
        row(font: Font.TS.body)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .foregroundStyle(resolved.isSelected ? style.tint : Color.TS.textMuted)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(resolved.isSelected ? style.tint : Color.clear)
                    .frame(height: 2)
            }
    }

    /// The shared dot / icon / label / count row used by both variants.
    private func row(font: Font) -> some View {
        HStack(spacing: TSSpacing.xs) {
            if variant == .pills, resolved.isSelected {
                Circle()
                    .fill(style.tint)
                    .frame(width: 6, height: 6)
                    .accessibilityHidden(true)
            }
            if let iconSystemName = item.iconSystemName {
                Image(systemName: iconSystemName)
                    .font(.system(size: 13))
                    .accessibilityHidden(true)
            }
            Text(verbatim: item.label)
                .font(font)
                .fontWeight(.medium)
                .lineLimit(1)
            if let formattedCount = resolved.formattedCount {
                Text(verbatim: "(\(formattedCount))")
                    .font(.system(size: 10))
                    .monospacedDigit()
                    .opacity(resolved.isSelected ? 0.8 : 0.6)
                    .accessibilityHidden(true)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }
}

// MARK: - Empty state (native — never a blank box)

/// The friendly empty state shown when there are no pills. The web renders an empty `role="tablist"`; the
/// native HIG calls for a labelled empty state rather than a bare box.
struct PillFilterBarEmptyView: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "line.3.horizontal.decrease.circle")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: PillFilterBarStrings.empty)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}
