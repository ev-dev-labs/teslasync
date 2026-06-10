//
//  AINLDriveSearch.Views.swift
//  TeslaSync — P4 shared surface · 0032 · AINLDriveSearch (Apple)
//
//  The presentational subviews composed by `AINLDriveSearch`: the `AIFeatureCard` scaffold
//  parts (header + Helix badge + description + the universal "Ask Helix" action) and the prompt
//  input (web `inputSlot` `Textarea`, rows=3, no char cap — faithful to the web source which
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
/// telling the user to describe a drive first.
struct NLDriveSearchHeader: View {
    let hint: NLDriveSearchHint?

    private var title: String {
        NLDriveSearchStrings.string("drives.aiSearch.title", "Find a drive in natural language")
    }

    private var description: String {
        NLDriveSearchStrings.string(
            "drives.aiSearch.description",
            """
            Describe a drive (for example "last Friday's trip to the coast") and jump straight \
            to its replay — the assistant only narrates your own drives.
            """
        )
    }

    private var hintText: String? {
        switch hint {
        case .enterPrompt:
            NLDriveSearchStrings.string(
                "drives.aiSearch.emptyHintPrompt",
                "Describe a drive to search for it."
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
                NLDriveSearchHelixBadge()
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
struct NLDriveSearchHelixBadge: View {
    private var label: String {
        NLDriveSearchStrings.string("drives.aiSearch.badge", "Helix")
    }

    private var tooltip: String {
        NLDriveSearchStrings.string(
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
        .accessibilityLabel(Text(verbatim: NLDriveSearchStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Prompt field (web `inputSlot` Textarea)

/// The free-form prompt input — the native parity of the web `Textarea` (rows=3), with the same
/// placeholder shown until the user types. The web source sets no `maxLength`, so this field
/// imposes no character cap. It carries a "Drive search prompt" accessibility label (the web
/// `Textarea` has no `aria-label`, so this is a native a11y addition to keep the editor
/// labelled for VoiceOver). Tokenised chrome (no raw hex); the placeholder is decorative
/// (a11y-hidden) and the field exposes its own VoiceOver label + value.
struct NLDriveSearchPromptField: View {
    @Binding var text: String

    private var placeholder: String {
        NLDriveSearchStrings.string(
            "drives.aiSearch.placeholder",
            "e.g. last Friday's trip to the coast"
        )
    }

    private var fieldLabel: String {
        NLDriveSearchStrings.string("drives.aiSearch.inputLabel", "Drive search prompt")
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(verbatim: placeholder)
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
        .accessibilityValue(Text(verbatim: text.isEmpty ? placeholder : text))
    }
}

// MARK: - Action button (web universal "Ask Helix" CTA)

/// The universal Helix action — visible "Ask Helix" when idle and "Helix is thinking…" while
/// streaming (web `AIThinkingDots`), with the per-feature verb ("Search with Helix") folded
/// into the accessibility label ("Ask Helix · Search with Helix"). Disabled (computed, never
/// literal) from the prompt / stream lifecycle / connectivity. Placed on its own trailing row
/// (web `inputSlot` implies `buttonPlacement="below"`).
struct NLDriveSearchActionButton: View {
    let isStreaming: Bool
    let disabled: Bool
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var askLabel: String {
        NLDriveSearchStrings.string("helix.askHelix", "Ask Helix")
    }

    private var thinkingLabel: String {
        NLDriveSearchStrings.string("helix.thinking", "Helix is thinking…")
    }

    private var verb: String {
        NLDriveSearchStrings.string("drives.aiSearch.searchButton", "Search with Helix")
    }

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(variant: .secondary, size: .small, action: onTap) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                        .nlDriveSearchSymbolPulse(active: isStreaming && !reduceMotion)
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
