//
//  Toggle.Views.swift
//  TeslaSync — P4 shared surface · 0230 · Toggle (Apple)
//
//  The presentational subviews composed by `ToggleSwitch`, reproducing the web `components/ui/
//  Toggle.tsx` output: the native switch (the idiomatic parity of the web `role="switch"` button +
//  hand-drawn track / thumb) on the leading edge, and the optional trailing label (web
//  `{label && <span>…</span>}`) that also flips the switch on tap (web "clicking the label text also
//  toggles"). Copy arrives pre-resolved through the projection (P1/S10); the accent tint, type, and
//  spacing come from the P1/S9 tokens. No networking lives here — the switch binds to the state the
//  model owns, and changes flow back through the supplied handlers.
//

import SwiftUI

// MARK: - Size mapping (web Tailwind track dimensions → platform ControlSize)

extension ToggleSize {
    /// The platform control size for the variant — the native parity of the web `sm` / `md` track
    /// dimensions. The hand-drawn web track (`sm: h-5 w-9`, `md: h-6 w-11`) maps to the HIG switch
    /// sizes so the control stays idiomatic rather than a bespoke shape.
    var controlSize: ControlSize {
        switch self {
        case .small: .small
        case .medium: .regular
        }
    }
}

// MARK: - Switch (web `role="switch"` button + track / thumb)

/// The switch — the native `SwiftUI.Toggle` in the `.switch` style, the idiomatic parity of the web
/// `role="switch"` button. Binds to the model's state, tints the on-track with the brand accent (web
/// `bg-cyan-500`), sizes per the variant, and carries the accessible name (web `aria-labelledby`) +
/// element id. The switch trait, the spoken on / off value, and the "double tap to toggle" hint are
/// supplied natively by the switch style, so they are not re-declared here. `labelsHidden()` drops the
/// control's built-in leading label because this surface draws the label itself on the trailing edge,
/// matching the web order (switch, then label).
struct ToggleSwitchControl: View {
    let resolved: ToggleResolved
    @Binding var isOn: Bool

    var body: some View {
        SwiftUI.Toggle(isOn: $isOn) {
            Text(verbatim: resolved.accessibilityLabel)
        }
        .labelsHidden()
        .toggleStyle(.switch)
        .tint(Color.TS.accent)
        .controlSize(resolved.size.controlSize)
        .accessibilityLabel(Text(verbatim: resolved.accessibilityLabel))
        .accessibilityIdentifier(resolved.accessibilityIdentifier)
    }
}

// MARK: - Label (web `{label && <span>…</span>}`)

/// The trailing label — the web `<span class="text-sm font-medium text-secondary">`. Shown only when
/// the projection carries one. Tapping it flips the switch (web "clicking the label text also toggles
/// via the wrapper's onClick"). It is hidden from VoiceOver because the switch already carries the
/// name, so it is not announced twice.
struct ToggleLabel: View {
    let text: String
    let onTap: () -> Void

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .contentShape(Rectangle())
            .onTapGesture { onTap() }
            .accessibilityHidden(true)
    }
}
