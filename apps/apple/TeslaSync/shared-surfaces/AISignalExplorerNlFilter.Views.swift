//
//  AISignalExplorerNlFilter.Views.swift
//  TeslaSync — P4 shared surface · 0046 · AISignalExplorerNlFilter (Apple)
//
//  The presentational subviews composed by `AISignalExplorerNlFilter`: the `AIFeatureCard` scaffold
//  parts (header + Helix badge + description + the universal "Ask Helix" action), the prompt input
//  (web `inputSlot` `Textarea`, rows=2), and the captured-proposal box (the web `draft` children —
//  the "Apply to filters" action, plus a concise native summary of the proposed signals/range/
//  per-page so the proposal is a non-blank, informative surface per the P4 leaf empty contract).
//  All consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports, no
//  raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web Helix accent on this card is cyan-300
//  (badge pill, proposal box, "Proposed filter" label) → the brand cyan `Color.TS.accent`. The web
//  "Apply to filters" Button is `variant="primary"` → `TSButton(variant: .primary)`.
//

import SwiftUI

// MARK: - Header (web `AIFeatureCard` title + badge + description + emptyHint)

/// The card header: the title, the cyan Helix badge, the one-paragraph description, and the optional
/// contextual hint shown when the action cannot start (web `!canStart && emptyHint`) — telling the
/// user whether to pick a vehicle or describe the filter.
struct SignalExplorerFilterHeader: View {
    let hint: SignalExplorerFilterHint?

    private var title: String {
        SignalExplorerFilterStrings.string(
            "signalExplorer.aiFilter.title", "Helix natural-language filter"
        )
    }

    private var description: String {
        SignalExplorerFilterStrings.string(
            "signalExplorer.aiFilter.description",
            """
            Describe the filter in plain English (e.g. "battery level for yesterday"). The LLM \
            proposes a typed filter you can apply with one click; it never edits the form directly.
            """
        )
    }

    private var hintText: String? {
        switch hint {
        case .selectVehicle:
            SignalExplorerFilterStrings.string(
                "signalExplorer.aiFilter.emptyHintVehicle",
                "Select a vehicle to scope the filter."
            )
        case .describeFilter:
            SignalExplorerFilterStrings.string(
                "signalExplorer.aiFilter.emptyHintPrompt",
                "Describe the filter you want Helix to draft."
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
                SignalExplorerFilterHelixBadge()
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

/// The small cyan "Helix" pill rendered beside the title — the native parity of the web `AIBadge`.
/// The brand mark is the `sparkles` SF Symbol tinted with the cyan accent.
struct SignalExplorerFilterHelixBadge: View {
    private var label: String {
        SignalExplorerFilterStrings.string("signalExplorer.aiFilter.badge", "Helix")
    }

    private var tooltip: String {
        SignalExplorerFilterStrings.string(
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
        .accessibilityLabel(Text(verbatim: SignalExplorerFilterStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Prompt field (web `inputSlot` Textarea, rows=2)

/// The free-form prompt input — the native parity of the web `Textarea` (rows=2), with the same hint
/// shown until the user types. Tokenised chrome (no raw hex); the hint is decorative (a11y-hidden)
/// and the field exposes its own VoiceOver label + value (web `aria-label="Filter request"`) so the
/// editor reads correctly.
struct SignalExplorerFilterPromptField: View {
    @Binding var text: String

    private var promptHint: String {
        SignalExplorerFilterStrings.string(
            "signalExplorer.aiFilter.promptHint",
            "e.g. show me battery level for yesterday"
        )
    }

    private var fieldLabel: String {
        SignalExplorerFilterStrings.string("signalExplorer.aiFilter.promptLabel", "Filter request")
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
                .frame(minHeight: 56)
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
/// streaming (web `AIThinkingDots`), with the per-feature verb folded into the accessibility label
/// ("Ask Helix · Draft filter"). Disabled (computed, never literal) from the prompt / stream
/// lifecycle / connectivity. Placed on its own trailing row (web `inputSlot` implies
/// `buttonPlacement="below"`).
struct SignalExplorerFilterActionButton: View {
    let isStreaming: Bool
    let disabled: Bool
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var askLabel: String {
        SignalExplorerFilterStrings.string("helix.askHelix", "Ask Helix")
    }

    private var thinkingLabel: String {
        SignalExplorerFilterStrings.string("helix.thinking", "Helix is thinking…")
    }

    private var verb: String {
        SignalExplorerFilterStrings.string("signalExplorer.aiFilter.button", "Draft filter")
    }

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(variant: .secondary, size: .small, action: onTap) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                        .signalExplorerFilterSymbolPulse(active: isStreaming && !reduceMotion)
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

// MARK: - Proposal box (web `draft` children)

/// The captured-proposal box (web `draft`): a concise "Proposed filter" summary of what the LLM
/// proposes (signal count, range preset, page size — all read from the captured draft) plus the web
/// "Apply to filters" action (a `primary` button, disabled while streaming). The web renders only
/// the button; the summary is the native non-blank, informative rendering of the same draft payload
/// (P4 leaf empty contract) and is voiced as part of the card's combined VoiceOver element.
struct SignalExplorerFilterProposal: View {
    let draft: SignalExplorerFilterDraft
    let canApply: Bool
    let onApply: () -> Void

    private var proposedLabel: String {
        SignalExplorerFilterStrings.string("signalExplorer.aiFilter.proposalLabel", "Proposed filter")
    }

    private var applyLabel: String {
        SignalExplorerFilterStrings.string("signalExplorer.aiFilter.applyButton", "Apply to filters")
    }

    private var applyTooltip: String {
        SignalExplorerFilterStrings.string(
            "signalExplorer.aiFilter.applyTooltip",
            "Copy the proposed filter into the form above. You can still edit it before clicking Explore."
        )
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: proposedLabel)
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.accent)
                SignalExplorerFilterSummaryLine(draft: draft)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            TSButton(variant: .primary, size: .small, action: onApply) {
                Text(verbatim: applyLabel).font(Font.TS.label)
            }
            .disabled(!canApply)
            .help(applyTooltip)
            .accessibilityLabel(Text(verbatim: applyLabel))
            .accessibilityHint(Text(verbatim: applyTooltip))
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.accent.opacity(0.05),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.accent.opacity(0.30), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Summary line (web draft payload → "Signals: N · Range: r · Per page: n")

/// The proposed-filter shape summary: the signal count, the range preset, and the page size joined
/// by `·`, voiced as a single combined VoiceOver element.
struct SignalExplorerFilterSummaryLine: View {
    let draft: SignalExplorerFilterDraft

    private var signalsLabel: String {
        SignalExplorerFilterStrings.string("signalExplorer.aiFilter.signalsLabel", "Signals")
    }

    private var rangeLabel: String {
        SignalExplorerFilterStrings.string("signalExplorer.aiFilter.rangeLabel", "Range")
    }

    private var perPageLabel: String {
        SignalExplorerFilterStrings.string("signalExplorer.aiFilter.perPageLabel", "Per page")
    }

    private var text: String {
        "\(signalsLabel): \(draft.signals.count) · "
            + "\(rangeLabel): \(draft.rangePreset) · "
            + "\(perPageLabel): \(draft.perPage)"
    }

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: text))
    }
}
