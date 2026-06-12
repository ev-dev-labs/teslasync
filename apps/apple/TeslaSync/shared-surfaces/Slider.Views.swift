//
//  Slider.Views.swift
//  TeslaSync — P4 shared surface · 0226 · Slider (Apple)
//
//  The presentational subviews composed by `SliderField`, reproducing the web `components/ui/
//  Slider.tsx` output: the optional label row (web `showLabel` block — the `<label>` on the leading
//  edge, the live `display` readout on the trailing edge with tabular figures) and the track row (the
//  native `Slider`, the idiomatic parity of `<input type="range">`). Copy arrives pre-resolved
//  through the projection (P1/S10); colour, type, spacing, and the accent tint come from the P1/S9
//  tokens. No networking lives here — the track binds to the value the model owns, and adjustments
//  flow back through the supplied command + value handlers.
//

import SwiftUI

// MARK: - Label row (web `showLabel && <div class="flex justify-between"> … </div>`)

/// The label + live-readout row — shown only when `showLabel`. The label is the form-control label
/// (web `text-sm font-medium text-secondary`); the readout is the muted, tabular-figure value (web
/// `text-xs text-muted tabular-nums`). The whole row is decorative for VoiceOver — the slider itself
/// carries the accessible name + value — so it is hidden from assistive tech to avoid a duplicate
/// announcement.
struct SliderLabelRow: View {
    let labelText: String
    let displayText: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: labelText)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: displayText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Track (web `<input type="range">`)

/// The slider track — the native `Slider`, the idiomatic parity of the web range input. Binds to the
/// model's value, tints with the brand accent (web `accent-cyan-500`), dims + disables when
/// `disabled` (web `disabled:opacity-50`), and carries the accessible name (web `<label>` /
/// `aria-label`), the spoken value (web `aria-valuetext`), and the native adjust hint. The VoiceOver
/// adjustable action and the PageUp/PageDown + Home/End key commands service the WAI-ARIA APG slider
/// pattern the web JSDoc documents (the arrow-key + increment/decrement stepping is native to
/// `Slider(step:)`).
struct SliderTrackView: View {
    let resolved: SliderResolved
    @Binding var value: Double
    let onCommand: (SliderCommand) -> Void

    var body: some View {
        Slider(
            value: $value,
            in: resolved.controlLowerBound ... resolved.controlUpperBound,
            step: resolved.step
        )
        .tint(Color.TS.accent)
        .disabled(resolved.isDisabled)
        .opacity(resolved.isDisabled ? 0.5 : 1)
        .accessibilityLabel(Text(verbatim: resolved.accessibilityLabel))
        .accessibilityValue(Text(verbatim: resolved.accessibilityValue))
        .accessibilityHint(Text(verbatim: resolved.accessibilityHint))
        .accessibilityIdentifier(resolved.accessibilityIdentifier)
        .accessibilityAdjustableAction { direction in
            guard !resolved.isDisabled else { return }
            switch direction {
            case .increment: onCommand(.stepUp)
            case .decrement: onCommand(.stepDown)
            @unknown default: break
            }
        }
        .onKeyPress(.pageUp) { dispatch(.pageUp) }
        .onKeyPress(.pageDown) { dispatch(.pageDown) }
        .onKeyPress(.home) { dispatch(.toMinimum) }
        .onKeyPress(.end) { dispatch(.toMaximum) }
    }

    /// Routes a key command to the handler, swallowing it only when the control is enabled so a
    /// disabled slider leaves the key for the responder chain.
    private func dispatch(_ command: SliderCommand) -> KeyPress.Result {
        guard !resolved.isDisabled else { return .ignored }
        onCommand(command)
        return .handled
    }
}
