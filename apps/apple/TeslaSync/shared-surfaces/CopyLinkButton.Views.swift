//
//  CopyLinkButton.Views.swift
//  TeslaSync — P4 shared surface · 0168 · CopyLinkButton (Apple)
//
//  The presentational subview composed by `CopyLinkButton`: the button's label content — a leading
//  SF Symbol (mirroring the web lucide `Check` / `Link2` glyph) plus the localised title (web
//  "Copied" / "Copy link"). It is a pure function of the `copied` flag + the reduce-motion
//  preference; it consumes the P1/S10 facade for its title and the shared P1/S9 tokens for spacing —
//  no networking, no Tailwind ports, no raw hex. The icon / title swap animates with a symbol-aware
//  content transition that collapses to an instant change when Reduce Motion is on.
//

import SwiftUI

// MARK: - Button label (web `<Button icon={…}>{…}</Button>` content)

/// The copy-link button's label — the leading glyph + the localised title, swapping between the
/// resting "Copy link" + `Link2` and the transient "Copied" + `Check` on the `copied` flag (web
/// `copied ? <Check/> "Copied" : <Link2/> "Copy link"`). The spoken label is supplied by the parent
/// control, so this content is hidden from VoiceOver to avoid a duplicate announcement.
struct CopyLinkButtonLabel: View {
    let copied: Bool
    let reduceMotion: Bool

    private var title: String {
        CopyLinkButtonStrings.label(copied: copied)
    }

    private var iconName: String {
        CopyLinkButtonLogic.iconSystemImage(copied: copied)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: iconName)
                .font(.system(size: 14, weight: .medium))
                .contentTransition(.symbolEffect(.replace))
            Text(verbatim: title)
                .contentTransition(.opacity)
        }
        .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: copied)
        .accessibilityHidden(true)
    }
}
