//
//  AccordionSection.Views.swift
//  TeslaSync — P4 feature view · 0236 · AccordionSection (Apple)
//
//  Presentational subviews composed by `AccordionSection`: the accent-tinted leading icon
//  (web `text-cyan-400` glyph), the rotating disclosure chevron (web `ChevronDown` with
//  `rotate-180`), and the bordered, fade-in body region (web
//  `<FadeIn><div className="border-t … px-5 py-4 space-y-4">`). The icon + chevron are
//  decorative — their meaning is carried by the header title + the surface's
//  accessibility value — so both are hidden from VoiceOver. All chrome uses P1/S9 tokens.
//

import SwiftUI

// MARK: - Leading icon (web `text-cyan-400 shrink-0`)

/// The header's accent-tinted leading icon. Sizing applies to SF Symbols; the tint mirrors
/// the web `text-cyan-400`. Decorative — the title conveys the meaning to VoiceOver.
struct AccordionSectionIcon<IconContent: View>: View {
    @ViewBuilder let icon: () -> IconContent

    var body: some View {
        icon()
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(minWidth: 20, minHeight: 20)
            .accessibilityHidden(true)
    }
}

// MARK: - Disclosure chevron (web `ChevronDown` + `rotate-180`)

/// The trailing disclosure chevron. Rotates to point up when the section is open (web
/// `open && 'rotate-180'`); the parent animates the change with the standard motion token.
struct AccordionSectionChevron: View {
    let rotationDegrees: Double

    var body: some View {
        Image(systemName: "chevron.down")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Color.TS.textMuted)
            .rotationEffect(.degrees(rotationDegrees))
            .accessibilityHidden(true)
    }
}

// MARK: - Body region (web `<FadeIn>` over the bordered content)

/// The revealed body: a top hairline divider (web `border-t`) over the padded content,
/// stacked with the section spacing (web `space-y-4`), faded in on appear (web `<FadeIn>`).
struct AccordionSectionBody<BodyContent: View>: View {
    @ViewBuilder let content: () -> BodyContent

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: 0) {
                Rectangle()
                    .fill(Color.TS.border)
                    .frame(height: 1)
                    .frame(maxWidth: .infinity)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    content()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, TSSpacing.xl)
                .padding(.vertical, TSSpacing.lg)
            }
        }
    }
}
