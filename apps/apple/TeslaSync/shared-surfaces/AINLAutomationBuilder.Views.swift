//
//  AINLAutomationBuilder.Views.swift
//  TeslaSync — P4 shared surface · 0030 · AINLAutomationBuilder (Apple)
//
//  The presentational subviews composed by `AINLAutomationBuilder`: the `AIFeatureCard`
//  scaffold parts (header + cyan Helix badge + description + the optional contextual hint) and
//  the prompt input (web `inputSlot` `Textarea`) + the universal "Ask Helix" action. All
//  consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports,
//  no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web Helix accent on this card is cyan-300
//  (badge pill) → the brand cyan `Color.TS.accent`.
//

import SwiftUI

// MARK: - Header (web `AIFeatureCard` title + badge + description + emptyHint)

/// The card header: the title, the cyan Helix badge, the one-paragraph description, and the
/// optional contextual hint shown when the action cannot start (web `!canStart && emptyHint`) —
/// telling the user whether to pick a vehicle or describe the automation.
struct NLAutomationBuilderHeader: View {
    let hint: NLAutomationBuilderHint?

    private var title: String {
        NLAutomationBuilderStrings.string(
            "automations.builder.aiBuilder.title", "Draft from natural language"
        )
    }

    private var description: String {
        NLAutomationBuilderStrings.string(
            "automations.builder.aiBuilder.description",
            """
            Describe the automation you want and get a typed graph draft you can review and save \
            below.
            """
        )
    }

    private var hintText: String? {
        switch hint {
        case .selectVehicle:
            NLAutomationBuilderStrings.string(
                "automations.builder.aiBuilder.emptyHintVehicle",
                "Select a vehicle to scope the automation."
            )
        case .describeAutomation:
            NLAutomationBuilderStrings.string(
                "automations.builder.aiBuilder.emptyHintPrompt",
                "Describe the automation you want Helix to draft."
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
                NLAutomationBuilderHelixBadge()
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
struct NLAutomationBuilderHelixBadge: View {
    private var label: String {
        NLAutomationBuilderStrings.string("automations.builder.aiBuilder.badge", "Helix")
    }

    private var tooltip: String {
        NLAutomationBuilderStrings.string(
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
        .accessibilityLabel(Text(verbatim: NLAutomationBuilderStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Prompt field (web `inputSlot` Textarea)

/// The free-form prompt input — the native parity of the web `Textarea`, with the same hint
/// shown until the user types. Tokenised chrome (no raw hex); the hint is decorative
/// (a11y-hidden) and the field exposes its own VoiceOver label + value so the editor reads
/// correctly.
struct NLAutomationBuilderPromptField: View {
    @Binding var text: String

    private var promptHint: String {
        NLAutomationBuilderStrings.string(
            "automations.builder.aiBuilder.promptHint",
            "e.g. precondition the cabin to 22°C when I leave work on weekdays"
        )
    }

    private var fieldLabel: String {
        NLAutomationBuilderStrings.string(
            "automations.builder.aiBuilder.promptLabel", "Automation prompt"
        )
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(verbatim: promptHint)
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
                .frame(minHeight: 76)
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
        .accessibilityValue(Text(verbatim: text.isEmpty ? promptHint : text))
    }
}

// MARK: - Action button (web universal "Ask Helix" CTA)

/// The universal Helix action — visible "Ask Helix" when idle and "Helix is thinking…" while
/// streaming (web `AIThinkingDots`), with the per-feature verb ("Draft automation") folded into
/// the accessibility label ("Ask Helix · Draft automation"). Disabled (computed, never literal)
/// from the prompt / stream lifecycle / connectivity. Placed on its own trailing row (web
/// `inputSlot` implies `buttonPlacement="below"`).
struct NLAutomationBuilderActionButton: View {
    let isStreaming: Bool
    let disabled: Bool
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var askLabel: String {
        NLAutomationBuilderStrings.string("helix.askHelix", "Ask Helix")
    }

    private var thinkingLabel: String {
        NLAutomationBuilderStrings.string("helix.thinking", "Helix is thinking…")
    }

    private var verb: String {
        NLAutomationBuilderStrings.string(
            "automations.builder.aiBuilder.draftButton", "Draft automation"
        )
    }

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(variant: .secondary, size: .small, action: onTap) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                        .nlAutomationBuilderSymbolPulse(active: isStreaming && !reduceMotion)
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
