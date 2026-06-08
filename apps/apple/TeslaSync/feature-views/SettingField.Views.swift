//
//  SettingField.Views.swift
//  TeslaSync — P4 feature view · 0213 · SettingField (Apple)
//
//  The presentational subviews composed by ``SettingField``: the label row (web
//  `<div class="mb-1.5 flex items-center gap-1">` holding the `<label>` and optional
//  `<HelpIcon>`) and the field-level help trigger that reproduces the web `<HelpIcon>`
//  contract. All styling comes from the shared P1/S9 tokens and all wording from the
//  P1/S10 facade — no Tailwind ports, no raw hex, no English literals.
//
//  The web distinguishes the field-level `<HelpIcon>` (a small "(?)" sized to sit inline
//  next to a `<label>`, with a per-field accessibility label "Help for {field}") from the
//  page-level `HelpTooltip`. This surface therefore renders its own field-level trigger
//  rather than the shared page-level `TSHelpTooltip`, so the per-field accessibility label
//  and inline sizing match the source.
//

import SwiftUI

// MARK: - Label row (web `mb-1.5 flex items-center gap-1`)

/// The label row: the uppercase, wide-tracked, muted field label (web
/// `text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]`) followed by
/// the optional inline help trigger.
struct SettingFieldLabelRow: View {
    let label: LocalizedStringKey
    let help: SettingFieldHelp?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(label)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(TSTypeMetrics.labelTracking)
                .foregroundStyle(Color.TS.textMuted)
            if let help {
                SettingFieldHelpButton(help: help)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Help trigger (web `<HelpIcon>`)

/// The field-level help trigger — the SwiftUI parity of the web `<HelpIcon>`: a small
/// "(?)" button that reveals the help text in a popover (and as a native hover tooltip on
/// macOS). It renders nothing when there is no help text (web `if (!text) return null`)
/// and carries a per-field accessibility label ("Help for {field}") plus the help text as
/// its accessibility hint, the native analogue of the web `aria-describedby` wiring.
struct SettingFieldHelpButton: View {
    let help: SettingFieldHelp

    @State private var isShowing = false

    private var projection: SettingFieldHelpProjection {
        SettingFieldHelpResolver.resolve(help)
    }

    var body: some View {
        let resolved = projection
        if resolved.rendersTrigger {
            Button {
                isShowing.toggle()
            } label: {
                Image(systemName: "questionmark.circle")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(width: 16, height: 16)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: resolved.accessibilityLabel))
            .accessibilityHint(Text(verbatim: resolved.helpText))
            .help(Text(verbatim: resolved.helpText))
            .popover(isPresented: $isShowing) {
                SettingFieldHelpContent(text: resolved.helpText, describedByID: resolved.describedByID)
            }
        }
    }
}

/// The popover body for the help trigger: the resolved help text on the inverted popover
/// surface. The text is already resolved (dynamic data), so it is rendered verbatim with
/// the body typography + primary text role tokens.
struct SettingFieldHelpContent: View {
    let text: String
    let describedByID: String?

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(TSSpacing.md)
            .frame(maxWidth: 280)
            .accessibilityIdentifier(describedByID ?? "")
    }
}
