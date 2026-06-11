//
//  PlaybackSpeedMenu.Views.swift
//  TeslaSync — P4 shared surface · 0097 · PlaybackSpeedMenu (Apple)
//
//  The presentational subviews composed by `PlaybackSpeedMenu`: the compact trigger label (the
//  native parity of the web ghost `Button` showing `{speed}x` in a monospaced face) and the per-row
//  menu item (the parity of a discrete speed choice — a leading checkmark on the current speed and
//  the `{speed}x` value label). Both consume the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports, no raw hex. The web lucide `ChevronDown` maps to the native
//  `Menu`'s own disclosure indicator (HIG-idiomatic), so the label itself stays text-only.
//

import SwiftUI

// MARK: - Trigger label (web ghost `{speed}x` button)

/// The control's appearance — the current speed rendered as `{speed}x` in the small body face with
/// monospaced digits (the parity of the web `text-xs font-mono` ghost button), padded as a compact
/// tap target. The disclosure chevron (web lucide `ChevronDown`) is supplied by the parent `Menu`
/// indicator; the spoken label + value are attached on the `Menu` itself.
struct PlaybackSpeedMenuTriggerLabel: View {
    let speed: ReplaySpeed

    private var title: String {
        PlaybackSpeedMenuStrings.speedValueLabel(speed)
    }

    var body: some View {
        Text(verbatim: title)
            .font(Font.TS.bodySm.monospacedDigit())
            .foregroundStyle(Color.TS.textPrimary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .accessibilityHidden(true)
    }
}

// MARK: - Menu item row (one discrete speed choice)

/// One speed choice inside the menu — the `{speed}x` value label with a leading checkmark when it is
/// the current speed (the HIG-idiomatic selected-row affordance). Tapping it selects that speed; the
/// value label is the row's own VoiceOver content and the current row carries the selected trait.
struct PlaybackSpeedMenuItemButton: View {
    let speed: ReplaySpeed
    let isCurrent: Bool
    let onSelect: () -> Void

    private var title: String {
        PlaybackSpeedMenuStrings.speedValueLabel(speed)
    }

    var body: some View {
        Button(action: onSelect) {
            if isCurrent {
                Label {
                    Text(verbatim: title)
                } icon: {
                    Image(systemName: "checkmark")
                }
            } else {
                Text(verbatim: title)
            }
        }
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }
}
