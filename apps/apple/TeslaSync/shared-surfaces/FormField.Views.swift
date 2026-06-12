//
//  FormField.Views.swift
//  TeslaSync — P4 shared surface · 0154 · FormField (Apple)
//
//  The presentational subviews composed by `FormField`: the label row (web
//  `<label>` + the required asterisk) and the single inline message row (web's
//  `error ? <p role="alert"> : hint ? <p> : null`). Both consume the shared P1/S9
//  tokens and the P1/S10 facade — no Tailwind ports, no raw hex, no networking.
//
//  Token parity (ADR-006, semantic not literal): the web `text-[var(--text-secondary)]`
//  label → `Color.TS.textSecondary`; the web `text-rose-300` required asterisk and
//  error text → the semantic `Color.TS.statusDanger`; the web `text-[var(--text-muted)]`
//  hint → `Color.TS.textMuted`. The 12pt scale matches the web `text-xs`.
//

import SwiftUI

// MARK: - Label row (web `<label htmlFor> {label}{required ? * : null}`)

/// The field's label row: the always-visible label and, when required, a trailing
/// asterisk. The asterisk is hidden from VoiceOver and the required state is folded
/// into the element's single spoken label ("{label}, required") so assistive tech
/// announces it once instead of reading a bare glyph (web `aria-label="required"`).
/// `fixedSize(vertical)` lets the label wrap at large Dynamic Type sizes.
struct FormFieldLabelView: View {
    let label: String
    let isRequired: Bool
    let requiredWord: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            if isRequired {
                Text(verbatim: "*")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FormFieldAccessibility.fieldLabel(
            label: label,
            required: isRequired,
            requiredWord: requiredWord
        )))
    }
}

// MARK: - Message row (web `error ? <p role="alert"> : hint ? <p> : null`)

/// The single inline message beneath the control. The error case maps to the
/// semantic danger token and carries the static-text trait so VoiceOver reads it as
/// the field's validation message (web `role="alert"`); the hint case maps to the
/// muted token. The `none` case renders nothing, matching the web `null` branch.
struct FormFieldMessageView: View {
    let message: FormFieldMessage

    var body: some View {
        switch message {
        case .none:
            EmptyView()
        case let .hint(text):
            messageText(text, color: Color.TS.textMuted)
        case let .error(text):
            messageText(text, color: Color.TS.statusDanger)
                .accessibilityAddTraits(.isStaticText)
        }
    }

    private func messageText(_ text: String, color: Color) -> some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
