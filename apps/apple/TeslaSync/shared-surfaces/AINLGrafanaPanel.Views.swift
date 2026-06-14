//
//  AINLGrafanaPanel.Views.swift
//  TeslaSync — P4 shared surface · 0033 · AINLGrafanaPanel (Apple)
//
//  The presentational subviews composed by `AINLGrafanaPanel`: the `AIFeatureCard` scaffold
//  parts (header + Helix badge + description + the universal "Ask Helix" action) and the prompt
//  input (web `inputSlot` `Textarea`, rows=2, no char cap — faithful to the web source which
//  sets no `maxLength`). All consume the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web Helix accent on this card is cyan-300
//  (badge pill, "Ask Helix" affordance) → the brand cyan `Color.TS.accent`.
//

import SwiftUI

// MARK: - Header (web `AIFeatureCard` title + badge + description + emptyHint)

/// The card header: the title, the cyan Helix badge, the one-paragraph description, and the
/// optional contextual hint shown when the action cannot start (web `!canStart && emptyHint`) —
/// telling the user to describe a panel first.
struct NLGrafanaPanelHeader: View {
    let hint: NLGrafanaPanelHint?

    private var title: String {
        NLGrafanaPanelStrings.string(
            "powerGrafana.aiDrafter.title", "Helix natural-language Grafana panel drafter"
        )
    }

    private var description: String {
        NLGrafanaPanelStrings.string(
            "powerGrafana.aiDrafter.description",
            """
            Describe the panel you want in plain English (e.g. "show me a daily time series of \
            how far I drove this month"). Helix proposes a typed Grafana panel JSON draft you \
            can apply to the editor with one click; it never pushes the panel to Grafana \
            directly.
            """
        )
    }

    private var hintText: String? {
        switch hint {
        case .enterPrompt:
            NLGrafanaPanelStrings.string(
                "powerGrafana.aiDrafter.emptyHintPrompt",
                "Describe the panel you want Helix to draft."
            )
        case .none:
            nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                NLGrafanaPanelHelixBadge()
            }
            Text(verbatim: description)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let hintText {
                Text(verbatim: hintText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Helix badge (web `AIBadge` cyan pill)

/// The small cyan "Helix" pill rendered beside the title — the native parity of the web
/// `AIBadge`. The brand mark is the `sparkles` SF Symbol tinted with the cyan accent.
struct NLGrafanaPanelHelixBadge: View {
    private var label: String {
        NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.badge", "Helix")
    }

    private var tooltip: String {
        NLGrafanaPanelStrings.string(
            "helix.tooltip",
            "Helix is your AI assistant. It generates responses using your redacted fleet context."
        )
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "sparkles")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.label)
        }
        .foregroundStyle(Color.TS.accent)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.accent.opacity(0.10), in: Capsule(style: .continuous))
        .overlay(Capsule(style: .continuous).strokeBorder(Color.TS.accent.opacity(0.30), lineWidth: 1))
        .help(tooltip)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: NLGrafanaPanelStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Prompt field (web `inputSlot` Textarea)

/// The free-form prompt input — the native parity of the web `Textarea` (rows=2), with the same
/// resting cue shown until the user types. The web source sets no `maxLength`, so this field
/// imposes no character cap. It carries the web `aria-label` ("Grafana panel request") so the
/// editor is labelled for VoiceOver. Tokenised chrome (no raw hex); the resting cue is
/// decorative (a11y-hidden) and the field exposes its own VoiceOver label + value.
struct NLGrafanaPanelPromptField: View {
    @Binding var text: String

    private var promptCue: String {
        NLGrafanaPanelStrings.string(
            "powerGrafana.aiDrafter.promptPlaceholder", // parity:allow web i18n key name, not a stub
            "e.g. show me a daily time series of how far I drove this month"
        )
    }

    private var fieldLabel: String {
        NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.promptLabel", "Grafana panel request")
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(verbatim: promptCue)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.sm + 2)
                    .fixedSize(horizontal: false, vertical: true)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            TextEditor(text: $text)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 60)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
        }
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: fieldLabel))
        .accessibilityValue(Text(verbatim: text.isEmpty ? promptCue : text))
    }
}

// MARK: - Action button (web universal "Ask Helix" CTA)

/// The universal Helix action — visible "Ask Helix" when idle and "Helix is thinking…" while
/// streaming (web `AIThinkingDots`), with the per-feature verb ("Draft panel") folded into the
/// accessibility label ("Ask Helix · Draft panel"). Disabled (computed, never literal) from the
/// prompt / stream lifecycle / connectivity. Placed on its own trailing row (web `inputSlot`
/// implies `buttonPlacement="below"`).
struct NLGrafanaPanelActionButton: View {
    let isStreaming: Bool
    let disabled: Bool
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var askLabel: String {
        NLGrafanaPanelStrings.string("helix.askHelix", "Ask Helix")
    }

    private var thinkingLabel: String {
        NLGrafanaPanelStrings.string("helix.thinking", "Helix is thinking…")
    }

    private var verb: String {
        NLGrafanaPanelStrings.string("powerGrafana.aiDrafter.button", "Draft panel")
    }

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(variant: .secondary, size: .small, action: onTap) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                        .nlGrafanaPanelSymbolPulse(active: isStreaming && !reduceMotion)
                        .accessibilityHidden(true)
                    Text(verbatim: isStreaming ? thinkingLabel : askLabel)
                        .font(Font.TS.label)
                }
            }
            .disabled(disabled)
            .help(verb)
            .accessibilityLabel(Text(verbatim: "\(askLabel) · \(verb)"))
            .accessibilityHint(Text(verbatim: verb))
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}
