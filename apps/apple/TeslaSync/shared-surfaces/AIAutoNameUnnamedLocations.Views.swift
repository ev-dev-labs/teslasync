//
//  AIAutoNameUnnamedLocations.Views.swift
//  TeslaSync — P4 shared surface · 0006 · AIAutoNameUnnamedLocations (Apple)
//
//  The presentational subviews composed by `AIAutoNameUnnamedLocations`: the
//  `AIFeatureCard` scaffold parts (header + Helix badge + description + the universal
//  "Ask Helix" action), the captured-proposal box (web `draft` children), the streamed
//  `AiOutputPanel` (thinking indicator / error / text), and the gate loading / error
//  chrome. All consume the P1/S10 facade and the shared P1/S9 tokens — no networking,
//  no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web Helix accent on this card is
//  cyan-300 (badge pill, proposal box, "Proposed name" label) → the brand cyan
//  `Color.TS.accent`; the validator-rejected line (web rose-300) → `statusDanger`.
//

import SwiftUI

// MARK: - Header (web `AIFeatureCard` title + badge + description + emptyHint)

/// The card header: the title, the cyan Helix badge, the one-paragraph description, and
/// the optional empty hint shown when the action cannot start (web `!canStart && emptyHint`).
struct AINameDraftHeader: View {
    let canStart: Bool

    private var title: String {
        AIAutoNameStrings.string("locations.aiAutoName.title", "Suggest a name for this location")
    }

    private var description: String {
        AIAutoNameStrings.string(
            "locations.aiAutoName.description",
            """
            Propose a concise, human-readable name for this visited location based on its \
            visit pattern. Review only — Helix never saves the name; you confirm and save \
            via the existing baseline form.
            """
        )
    }

    private var emptyHint: String {
        AIAutoNameStrings.string("locations.aiAutoName.emptyHint", "Select a location to name first.")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                AIHelixBadge()
            }
            Text(verbatim: description)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if !canStart {
                Text(verbatim: emptyHint)
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
struct AIHelixBadge: View {
    private var label: String {
        AIAutoNameStrings.string("locations.aiAutoName.badge", "Helix")
    }

    private var tooltip: String {
        AIAutoNameStrings.string(
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
        .accessibilityLabel(Text(verbatim: AIAutoNameStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Action button (web universal "Ask Helix" CTA)

/// The universal Helix action — visible "Ask Helix" when idle and "Helix is thinking…"
/// while streaming (web `AIThinkingDots`), with the per-feature verb folded into the
/// accessibility label ("Ask Helix · Suggest name"). Disabled (computed, never literal)
/// from the stream lifecycle + connectivity. Placed on its own trailing row (web
/// `buttonPlacement="below"`).
struct AINameDraftActionButton: View {
    let isStreaming: Bool
    let disabled: Bool
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var askLabel: String {
        AIAutoNameStrings.string("helix.askHelix", "Ask Helix")
    }

    private var thinkingLabel: String {
        AIAutoNameStrings.string("helix.thinking", "Helix is thinking…")
    }

    private var verb: String {
        AIAutoNameStrings.string("locations.aiAutoName.suggestButton", "Suggest name")
    }

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(variant: .secondary, size: .small, action: onTap) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                        .aiAutoNameSymbolPulse(active: isStreaming && !reduceMotion)
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

// MARK: - Current label (web `currentName` context line)

/// The "Current label: …" context line (web optional `currentName`), so the user sees
/// the original coordinate-shaped name next to the proposal.
struct AINameDraftCurrentLabel: View {
    let currentName: String

    private var label: String {
        AIAutoNameStrings.string("locations.aiAutoName.currentLabel", "Current label")
    }

    var body: some View {
        (
            Text(verbatim: "\(label): ").foregroundStyle(Color.TS.textMuted)
                + Text(verbatim: currentName).foregroundStyle(Color.TS.textSecondary)
        )
        .font(Font.TS.caption)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(currentName)"))
    }
}

// MARK: - Proposal box (web `draft` children)

/// The captured-proposal box (web `draft`): the "Proposed name" label, the proposed
/// name, the optional validator reason, the "rejected by validator" line for a
/// non-`ok` verdict, and the "Apply to form" action (disabled unless `ok`).
struct AINameDraftProposal: View {
    let draft: LocationNameDraft
    let onApply: () -> Void

    private var proposedLabel: String {
        AIAutoNameStrings.string("locations.aiAutoName.proposalLabel", "Proposed name")
    }

    private var rejectedLabel: String {
        AIAutoNameStrings.string("locations.aiAutoName.rejectedLabel", "Proposal rejected by validator")
    }

    private var applyLabel: String {
        AIAutoNameStrings.string("locations.aiAutoName.applyButton", "Apply to form")
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: proposedLabel)
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.accent)
                Text(verbatim: draft.proposedName)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                if let reason = draft.reason, !reason.isEmpty {
                    Text(verbatim: reason)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !draft.isOK {
                    Text(verbatim: rejectedLabel)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.statusDanger)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            TSButton(variant: .secondary, size: .small, action: onApply) {
                Text(verbatim: applyLabel).font(Font.TS.label)
            }
            .disabled(!draft.isOK)
            .accessibilityLabel(Text(verbatim: applyLabel))
        }
        .padding(TSSpacing.md)
        .background(Color.TS.accent.opacity(0.05), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.accent.opacity(0.30), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}
