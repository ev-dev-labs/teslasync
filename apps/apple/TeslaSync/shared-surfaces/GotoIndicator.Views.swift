//
//  GotoIndicator.Views.swift
//  TeslaSync — P4 shared surface · 0121 · GotoIndicator (Apple)
//
//  The presentational subviews composed by the surface: the floating "Go to…" hint (the native parity
//  of the web `GotoIndicator` — a frosted, bottom-anchored pill carrying the prompt and the `g` / `?`
//  key caps), the key cap itself (web `<kbd>`), and the freshness chip (P4 connectivity axis). All
//  consume the P1/S10 facade and the shared P1/S9 tokens / components — no networking, no Tailwind
//  ports, no raw hex.
//
//  Composition parity: the web pill is `bg-[var(--surface-overlay)] backdrop-blur-xl` with a subtle
//  border + heavy shadow, the prompt in `--text-muted`, and two `<kbd>` caps (`--surface-2`, mono,
//  `--text-secondary`) separated by a muted `+`. The native pill maps the blur to `TSMaterial.overlay`
//  (`.thinMaterial`), the border/shadow to the tokens, and the caps to `GotoKeyCap`. The entrance
//  matches the web `slide-in-from-bottom + fade-in`, gated by Reduce Motion.
//
//  Accessibility note: the data pill is a single VoiceOver element — its label is the prompt ("Go to…")
//  and its hint explains the chord ("Press g then ? to jump to a section."), so the individual cap
//  glyphs are not spoken one character at a time. The freshness chip stays separately focusable with its
//  own label.
//

import SwiftUI

// MARK: - Key cap (web `<kbd>`)

/// One keyboard key cap — the native parity of the web `<kbd>`: a small rounded chip with the glyph in a
/// monospaced face over the elevated surface tone. Decorative on its own (the parent pill carries the
/// spoken label), so it is hidden from VoiceOver.
struct GotoKeyCap: View {
    let glyph: String

    var body: some View {
        Text(verbatim: glyph)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .frame(minWidth: 22)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Goto hint (web `GotoIndicator` data render)

/// The floating "Go to…" hint — the native parity of the web `GotoIndicator` body. Renders the muted
/// prompt followed by the `g` / `?` key caps over a frosted, bottom-anchored pill, as a single spoken
/// element with a descriptive hint.
public struct GotoHintView: View {
    private let hint: GotoIndicatorHint
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(hint: GotoIndicatorHint) {
        self.hint = hint
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: hint.prompt)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .padding(.trailing, TSSpacing.xs)

            ForEach(Array(hint.keys.enumerated()), id: \.offset) { index, glyph in
                if index > 0 {
                    Text(verbatim: hint.separator)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
                GotoKeyCap(glyph: glyph)
            }
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .background(TSMaterial.overlay, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.25), radius: 16, y: 8)
        .transition(
            reduceMotion
                ? .opacity
                : .move(edge: .bottom).combined(with: .opacity)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isStaticText)
        .accessibilityLabel(Text(verbatim: hint.prompt))
        .accessibilityHint(Text(verbatim: hint.accessibilityHint))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the hint when the shortcut controller is not live — a coloured dot +
/// a label (`Stale` / `Offline`). A button so VoiceOver and pointer users can re-request the snapshot,
/// with an explicit label.
struct GotoFreshnessChip: View {
    let connection: GotoConnection
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
        case .live: GotoStrings.string("shortcuts.live", "Live")
        case .stale: GotoStrings.string("shortcuts.stale", "Stale")
        case .offline: GotoStrings.string("shortcuts.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            GotoStrings.string("shortcuts.staleA11y", "Stale — tap to refresh")
        case .offline:
            GotoStrings.string("shortcuts.offlineA11y", "Offline — showing the last shortcut hint")
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
