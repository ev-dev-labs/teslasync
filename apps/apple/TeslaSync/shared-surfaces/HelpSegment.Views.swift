//
//  HelpSegment.Views.swift
//  TeslaSync — P4 shared surface · 0179 · HelpSegment (Apple)
//
//  The presentational leaves composed by ``HelpSegment``, reproducing the web
//  `components/layout/status-bar/HelpSegment.tsx` body: one icon-led button per affordance (the native peer
//  of the web `<button>` wrapping a lucide icon) and the `?` key cap (the web `<kbd>`). Each button shows
//  the SF Symbol, optionally the key cap (shortcuts, expanded), and optionally the inline label (the wide
//  `xl:inline` tier); the muted glyph + label brighten on pointer hover (web
//  `hover:text-[var(--text-secondary)]`) over a subtle hover fill (web `hover:bg-white/[0.04]`). Every
//  string arrives pre-resolved through the P1/S10 facade; every color comes from the P1/S9 tokens — no
//  Tailwind ports, no raw hex. The icon + key cap are decorative for VoiceOver; the button carries the
//  single accessible element with the resolved `aria-label` as its label. No networking lives here.
//

import SwiftUI

// MARK: - Key cap (web `<kbd>?</kbd>`)

/// The `?` keyboard key cap shown next to the shortcuts icon — the native peer of the web `<kbd>`. A muted,
/// rounded chip; decorative for VoiceOver (the button owns the spoken label).
struct HelpSegmentKeyCap: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.xs)
            .background(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .fill(Color.TS.textPrimary.opacity(0.08))
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Affordance button (web `<button>` + lucide icon)

/// One icon-led help button — the native peer of the web `<button>`: the SF Symbol, optionally the `?` key
/// cap (shortcuts, expanded), and optionally the inline label (the wide `xl:inline` tier). Tapping invokes
/// the decoupled host action through the model (the native peer of the web window-event dispatch). The
/// whole control is one VoiceOver element with the resolved `aria-label`; the glyph + key cap are hidden
/// from VoiceOver. The muted foreground brightens on hover (web `hover:text-[var(--text-secondary)]`).
struct HelpSegmentButton: View {
    let projection: HelpSegmentActionProjection
    let model: HelpSegmentModel

    @State private var isHovering = false

    var body: some View {
        Button {
            model.perform(projection.action)
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: projection.systemImage)
                    .font(Font.TS.caption)
                    .accessibilityHidden(true)
                if let keyCap = projection.keyCap {
                    HelpSegmentKeyCap(text: keyCap)
                }
                if projection.showsInlineLabel {
                    Text(verbatim: projection.inlineLabel)
                        .font(Font.TS.caption)
                }
            }
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .fill(isHovering ? Color.TS.textPrimary.opacity(0.04) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(isHovering ? Color.TS.textSecondary : Color.TS.textMuted)
        .onHover { isHovering = $0 }
        .help(Text(verbatim: projection.tooltip))
        .accessibilityLabel(Text(verbatim: projection.accessibilityLabel))
        .accessibilityAddTraits(.isButton)
    }
}
