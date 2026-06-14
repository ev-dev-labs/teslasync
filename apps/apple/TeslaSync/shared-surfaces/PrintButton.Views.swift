//
//  PrintButton.Views.swift
//  TeslaSync — P4 shared surface · 0223 · PrintButton (Apple)
//
//  The presentational subview composed by `PrintButton`: the button's label content — a leading SF
//  Symbol (mirroring the web lucide `Printer` glyph) plus the optional localised title (web "Print",
//  or a caller override; dropped entirely for `iconOnly`). It is a pure function of the resolved
//  visible label; it consumes the shared P1/S9 tokens for spacing — no networking, no Tailwind ports,
//  no raw hex. The web component has no transient / animated state (it does not change appearance
//  while the dialog is open), so there is no glyph swap to motion-gate here. The spoken label is
//  supplied by the parent control, so this content is hidden from VoiceOver to avoid a duplicate
//  announcement.
//

import SwiftUI

// MARK: - Button label (web `<Button icon={<Printer/>}>{printLabel}</Button>` content)

/// The print button's label — the leading `Printer` glyph plus the optional localised title (web
/// "Print" / a caller override). A `nil` `visibleLabel` is the `iconOnly` dense variant (glyph only).
struct PrintButtonLabel: View {
    let visibleLabel: String?

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: PrintButtonLogic.iconSystemImage())
                .font(.system(size: 14, weight: .medium))
            if let visibleLabel {
                Text(verbatim: visibleLabel)
            }
        }
        .accessibilityHidden(true)
    }
}
