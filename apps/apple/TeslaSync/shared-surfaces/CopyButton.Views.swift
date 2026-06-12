//
//  CopyButton.Views.swift
//  TeslaSync — P4 shared surface · 0207 · CopyButton (Apple)
//
//  The presentational subview composed by `CopyButton`: the button's label content — a leading SF
//  Symbol (mirroring the web lucide `Copy` / `CheckCircle` glyph) plus the optional localised title
//  (web "Copy" / "Copied", or a caller override; dropped entirely for `iconOnly`). It is a pure
//  function of the `copied` flag, the resolved visible label, and the reduce-motion preference; it
//  consumes the shared P1/S9 tokens for spacing — no networking, no Tailwind ports, no raw hex. The
//  icon / title swap animates with a symbol-aware content transition that collapses to an instant
//  change when Reduce Motion is on. The spoken label is supplied by the parent control, so this
//  content is hidden from VoiceOver to avoid a duplicate announcement.
//

import SwiftUI

// MARK: - Button label (web `<Button icon={…}>{visibleLabel}</Button>` content)

/// The copy button's label — the leading glyph + the optional localised title, swapping between the
/// resting "Copy" + `Copy` and the transient "Copied" + `CheckCircle` on the `copied` flag (web
/// `copied ? <CheckCircle/> : <Copy/>`). A `nil` `visibleLabel` is the `iconOnly` dense variant.
struct CopyButtonLabel: View {
    let copied: Bool
    let visibleLabel: String?
    let reduceMotion: Bool

    private var iconName: String {
        CopyButtonLogic.iconSystemImage(copied: copied)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: iconName)
                .font(.system(size: 14, weight: .medium))
                .contentTransition(.symbolEffect(.replace))
            if let visibleLabel {
                Text(verbatim: visibleLabel)
                    .contentTransition(.opacity)
            }
        }
        .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: copied)
        .accessibilityHidden(true)
    }
}
