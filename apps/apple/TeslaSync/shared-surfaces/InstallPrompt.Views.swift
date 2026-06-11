//
//  InstallPrompt.Views.swift
//  TeslaSync — P4 shared surface · 0125 · InstallPrompt (Apple)
//
//  The presentational subviews composed by `InstallPrompt`: the active install-prompt card (the native
//  parity of the web bottom card — the gradient install glyph, the title + subtitle, the "Install"
//  action, and the dismiss affordance) and the freshness chip (P4 connectivity axis). All consume the
//  P1/S10 facade and the shared P1/S9 tokens / components (`TSButton` ← web `Button`) — no detection,
//  no persistence, no Tailwind ports, no raw hex (the web `#00f0ff → #10b981` gradient maps to the
//  brand `accent → statusSuccess` tokens, which resolve to those values).
//
//  Accessibility note: the icon + copy are combined into one VoiceOver element carrying the
//  title + subtitle; the "Install" and dismiss controls stay individually focusable, the dismiss
//  carrying the web `installPrompt.dismiss` ("Dismiss install prompt") label.
//

import SwiftUI

// MARK: - Active install prompt (web bottom card)

/// The active install prompt — the data render of the surface. Reproduces the web card: the gradient
/// install glyph (web `bg-gradient-to-br from-[#00f0ff] to-[#10b981]` → `accent → statusSuccess`
/// tokens), the title (web `installPrompt.title`) + subtitle (web `installPrompt.subtitle`), the
/// "Install" action (web `handleInstall`), and the dismiss affordance (web `handleDismiss`, labelled
/// `installPrompt.dismiss`). Fades + lifts in on appear (web framer-motion spring), honouring Reduce
/// Motion via `TSFadeIn`.
struct InstallPromptCard: View {
    let onInstall: () -> Void
    let onDismiss: () -> Void

    private var titleText: String {
        InstallPromptStrings.string(InstallPromptCopy.titleKey, InstallPromptCopy.titleFallback)
    }

    private var subtitleText: String {
        InstallPromptStrings.string(InstallPromptCopy.subtitleKey, InstallPromptCopy.subtitleFallback)
    }

    private var installText: String {
        InstallPromptStrings.string(InstallPromptCopy.installKey, InstallPromptCopy.installFallback)
    }

    private var dismissText: String {
        InstallPromptStrings.string(InstallPromptCopy.dismissKey, InstallPromptCopy.dismissFallback)
    }

    private var accessibilityText: String {
        InstallPromptAccessibility.cardLabel(title: titleText, subtitle: subtitleText)
    }

    var body: some View {
        TSFadeIn {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                iconTile
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: titleText)
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: subtitleText)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: accessibilityText))

                Spacer(minLength: TSSpacing.sm)

                TSButton(variant: .primary, size: .small, action: onInstall) {
                    Text(verbatim: installText)
                }
                .accessibilityLabel(Text(verbatim: installText))

                TSButton(variant: .ghost, size: .small, action: onDismiss) {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .semibold))
                }
                .accessibilityLabel(Text(verbatim: dismissText))
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: 460, alignment: .leading)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.18), radius: 16, x: 0, y: 8)
        }
    }

    /// The gradient install glyph — the native parity of the web rounded gradient tile + white
    /// download icon. The gradient uses the brand `accent → statusSuccess` tokens (the web
    /// `#00f0ff → #10b981`), so it stays themable rather than a raw hex port.
    private var iconTile: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(LinearGradient(
                colors: [Color.TS.accent, Color.TS.statusSuccess],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ))
            .frame(width: 40, height: 40)
            .overlay {
                Image(systemName: "square.and.arrow.down.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the surface when the availability snapshot is not live — a
/// coloured dot + a label (`Stale` / `Offline`). A button so VoiceOver and pointer users can
/// re-request the probe, with an explicit label. Hidden while live.
struct InstallPromptFreshnessChip: View {
    let connection: InstallPromptConnection
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
        case .live: InstallPromptStrings.string("installPrompt.live", "Live")
        case .stale: InstallPromptStrings.string("installPrompt.stale", "Stale")
        case .offline: InstallPromptStrings.string("installPrompt.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            InstallPromptStrings.string("installPrompt.staleA11y", "Stale — tap to re-check install options")
        case .offline:
            InstallPromptStrings.string("installPrompt.offlineA11y", "Offline — showing the last install check")
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
