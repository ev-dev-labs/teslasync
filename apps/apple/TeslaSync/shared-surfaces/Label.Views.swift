//
//  Label.Views.swift
//  TeslaSync — P4 shared surface · 0218 · Label (Apple)
//
//  The presentational pieces of the form label — the native peers of the web elements: the label text (web
//  `<label>{children}`), the decorative required marker (web `<span aria-hidden="true"
//  className="text-rose-300">*</span>`, hidden from VoiceOver), and the composed body that carries the
//  accessible name (the native peer of the web visually-hidden ` ${t('form.required')}` folded into the
//  control's accessible name). All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports. The
//  marker is hidden from VoiceOver; the body exposes one explicit label + the optional control-association
//  identifier (web `htmlFor`). A blank caller content renders the muted fallback leaf (never a blank box).
//

import SwiftUI

// MARK: - Required marker (web `<span aria-hidden>*</span>`)

/// The decorative required marker — the native peer of the web `<span aria-hidden="true"
/// className="text-rose-300">*</span>`. Rendered in the design system's danger color (P1/S9, the native
/// peer of `text-rose-300`) and hidden from VoiceOver, since the spoken "required" is carried by the body's
/// accessible name rather than the glyph.
struct LabelRequiredMarker: View {
    let glyph: String

    var body: some View {
        Text(verbatim: glyph)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.statusDanger)
            .accessibilityHidden(true)
    }
}

// MARK: - Body (web `<label>` content + accessible name)

/// The label body — the native peer of the web `<label>`: the visible text followed by the optional
/// required marker, exposed to VoiceOver as ONE element whose accessible name is the composed
/// `accessibilityLabel` (the web `children` + the visually-hidden ` required`). The text uses the design
/// system's label role (P1/S9); a blank caller content renders the muted fallback (the native "never a
/// blank box" leaf). The optional `fieldIdentifier` (web `htmlFor`) becomes the accessibility identifier so
/// the label↔control association survives.
struct LabelBody: View {
    let projection: LabelProjection

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(verbatim: projection.displayText)
                .font(Font.TS.label)
                .foregroundStyle(projection.isEmpty ? Color.TS.textMuted : Color.TS.textSecondary)
            if projection.showsRequiredMarker {
                LabelRequiredMarker(glyph: projection.requiredMarkerGlyph)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: projection.accessibilityLabel))
        .accessibilityIdentifier(projection.fieldIdentifier ?? "")
    }
}
