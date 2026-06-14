//
//  AILifetimeStatsQA.Views.swift
//  TeslaSync — P4 shared surface · 0024 · AILifetimeStatsQA (Apple)
//
//  The presentational subviews composed by `AILifetimeStatsQA`: the `AIFeatureCard` scaffold
//  parts (header + Helix badge + description + the universal "Ask Helix" action) and the
//  question input (web `inputSlot` `Textarea` with the 1024-char cap + the "Your question"
//  label). All consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no
//  Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web Helix accent on this card is
//  cyan-300 (badge pill, "Ask Helix" affordance) → the brand cyan `Color.TS.accent`.
//

import SwiftUI

// MARK: - Header (web `AIFeatureCard` title + badge + description + emptyHint)

/// The card header: the title, the cyan Helix badge, the one-paragraph description, and the
/// optional contextual hint shown when the action cannot start (web `!canStart && emptyHint`)
/// — telling the user whether to pick a vehicle or type a question.
struct LifetimeStatsQAHeader: View {
    let hint: LifetimeStatsQAHint?

    private var title: String {
        LifetimeStatsQAStrings.string("lifetime.aiQA.title", "Ask about your lifetime stats")
    }

    private var description: String {
        LifetimeStatsQAStrings.string(
            "lifetime.aiQA.description",
            """
            Ask Helix a natural-language question about your all-time stats — total distance, \
            charging savings, achievements, personal records. Answers are grounded in the same \
            deterministic envelope the dashboard below shows; the narrator never invents numbers.
            """
        )
    }

    private var hintText: String? {
        switch hint {
        case .selectVehicle:
            LifetimeStatsQAStrings.string(
                "lifetime.aiQA.emptyHintVehicle",
                "Select a vehicle to ask about its lifetime stats."
            )
        case .askQuestion:
            LifetimeStatsQAStrings.string(
                "lifetime.aiQA.emptyHintQuestion",
                "Type a question about your all-time stats."
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
                LifetimeStatsQAHelixBadge()
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
struct LifetimeStatsQAHelixBadge: View {
    private var label: String {
        LifetimeStatsQAStrings.string("lifetime.aiQA.badge", "Helix")
    }

    private var tooltip: String {
        LifetimeStatsQAStrings.string(
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
        .accessibilityLabel(Text(verbatim: LifetimeStatsQAStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Question field (web `inputSlot` Textarea)

/// The free-form question input — the native parity of the web `Textarea`, with the same
/// placeholder shown until the user types, the 1024-char cap enforced (web // parity:allow ui
/// `maxLength={MaxQuestionChars}`), and the "Your question" accessibility label (web
/// `aria-label`). Tokenised chrome (no raw hex); the placeholder is decorative (a11y-hidden) // parity:allow ui
/// and the field exposes its own VoiceOver label + value so the editor reads correctly.
struct LifetimeStatsQAQuestionField: View {
    @Binding var text: String

    private var placeholder: String { // parity:allow ui
        LifetimeStatsQAStrings.string(
            "lifetime.aiQA.placeholder", // parity:allow ui
            "e.g. How far have I driven in total? How much have I saved on fuel?"
        )
    }

    private var fieldLabel: String {
        LifetimeStatsQAStrings.string("lifetime.aiQA.inputLabel", "Your question")
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(verbatim: placeholder) // parity:allow ui
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
                .onChange(of: text) { _, newValue in
                    // Web `maxLength={MaxQuestionChars}` — cap typed input so a 400 can never
                    // be provoked. Truncate by characters (matches the validity gate's count).
                    let cap = LifetimeStatsQAConstants.maxQuestionChars
                    if newValue.count > cap {
                        text = String(newValue.prefix(cap))
                    }
                }
        }
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: fieldLabel))
        .accessibilityValue(Text(verbatim: text.isEmpty ? placeholder : text)) // parity:allow ui
    }
}

// MARK: - Action button (web universal "Ask Helix" CTA)

/// The universal Helix action — visible "Ask Helix" when idle and "Helix is thinking…" while
/// streaming (web `AIThinkingDots`), with the per-feature verb ("Ask") folded into the
/// accessibility label ("Ask Helix · Ask"). Disabled (computed, never literal) from the
/// question / stream lifecycle / connectivity. Placed on its own trailing row (web `inputSlot`
/// implies `buttonPlacement="below"`).
struct LifetimeStatsQAActionButton: View {
    let isStreaming: Bool
    let disabled: Bool
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var askLabel: String {
        LifetimeStatsQAStrings.string("helix.askHelix", "Ask Helix")
    }

    private var thinkingLabel: String {
        LifetimeStatsQAStrings.string("helix.thinking", "Helix is thinking…")
    }

    private var verb: String {
        LifetimeStatsQAStrings.string("lifetime.aiQA.askButton", "Ask")
    }

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(variant: .secondary, size: .small, action: onTap) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                        .lifetimeStatsQASymbolPulse(active: isStreaming && !reduceMotion)
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
