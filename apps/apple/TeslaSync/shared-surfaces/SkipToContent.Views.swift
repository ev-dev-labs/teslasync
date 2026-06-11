//
//  SkipToContent.Views.swift
//  TeslaSync — P4 shared surface · 0139 · SkipToContent (Apple)
//
//  The presentational subviews composed by `SkipToContent`: the skip-link button (the visible
//  parity of the web `<VisuallyHidden as="a" focusable>` that reveals a styled pill on focus),
//  the skip-target list (the hero "Skip to main content" link over any secondary landmarks),
//  the bypass-blocks explainer, the data body, and the freshness chip (P4 connectivity axis).
//  All consume the P1/S10 facade and the shared P1/S9 tokens / components — no networking, no
//  Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Skip-link button (visible parity of the web `focus:` styled anchor)

/// One skip link rendered as an actionable pill — the native parity of the web anchor that is
/// visually hidden until focused, then shows a ringed pill. The whole control is a button whose
/// VoiceOver label reads the destination and whose hint explains the jump. Keyboard focus adds an
/// accent ring (web `focus:ring-2`); on touch the link is always visible and reachable first.
struct SkipLinkButton: View {
    let text: String
    let hint: String
    let isPrimary: Bool
    let onActivate: () -> Void

    @FocusState private var focused: Bool

    private var tint: Color {
        isPrimary ? Color.TS.accent : Color.TS.textSecondary
    }

    private var fill: Color {
        isPrimary ? Color.TS.accent.opacity(0.12) : Color.TS.surface
    }

    private var systemImage: String {
        isPrimary ? "arrow.down.to.line" : "arrow.turn.down.right"
    }

    var body: some View {
        Button(action: onActivate) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tint)
                    .accessibilityHidden(true)
                Text(verbatim: text)
                    .font(isPrimary ? Font.TS.body : Font.TS.caption)
                    .fontWeight(isPrimary ? .semibold : .regular)
                    .foregroundStyle(isPrimary ? Color.TS.textPrimary : Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: Capsule())
            .overlay(
                Capsule().strokeBorder(
                    focused ? Color.TS.accent : Color.TS.border,
                    lineWidth: focused ? 2 : 1
                )
            )
        }
        .buttonStyle(.plain)
        .focused($focused)
        .accessibilityLabel(Text(verbatim: text))
        .accessibilityHint(Text(verbatim: hint))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Skip-target list (the hero link + secondary landmarks)

/// The web anchor's native peer — the hero "Skip to main content" link (the verbatim web string)
/// over any secondary landmark links, with the bypass-blocks explainer caption beneath.
struct SkipTargetList: View {
    let primary: SkipTarget
    let secondary: [SkipTarget]
    let onSkip: (SkipTarget) -> Void

    private var hint: String {
        SkipToContentStrings.string("a11y.skipToContentHint", "Jumps past the navigation to the main content")
    }

    private var namedFormat: String {
        SkipToContentStrings.string("skip.toNamed", "Skip to %@")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            SkipLinkButton(
                text: SkipToContentStrings.string("a11y.skipToContent", "Skip to main content"),
                hint: hint,
                isPrimary: true,
                onActivate: { onSkip(primary) }
            )
            ForEach(secondary) { target in
                SkipLinkButton(
                    text: SkipToContentAccessibility.namedSkipLabel(format: namedFormat, destination: target.label),
                    hint: hint,
                    isPrimary: false,
                    onActivate: { onSkip(target) }
                )
            }
            Text(verbatim: SkipToContentStrings.string(
                "skip.explainer",
                "Jump straight to a landmark, bypassing the navigation (WCAG 2.4.1 Bypass Blocks)."
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Data body (hero link + secondary landmarks)

/// The data render — the skip-target list wrapped in the shared fade-in for entrance polish.
struct SkipToContentDataView: View {
    let resolved: SkipToContentResolved
    let onSkip: (SkipTarget) -> Void

    var body: some View {
        TSFadeIn {
            if let primary = resolved.primary {
                TSCard {
                    SkipTargetList(primary: primary, secondary: resolved.secondary, onSkip: onSkip)
                }
            }
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the body when the feed is not live — a coloured dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the
/// snapshot, with an explicit label.
struct SkipFreshnessChip: View {
    let connection: SkipConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: SkipToContentStrings.string("skip.live", "Live")
        case .stale: SkipToContentStrings.string("skip.stale", "Stale")
        case .offline: SkipToContentStrings.string("skip.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            SkipToContentStrings.string("skip.staleA11y", "Stale — tap to refresh")
        case .offline:
            SkipToContentStrings.string("skip.offlineA11y", "Offline — showing last known landmarks")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
