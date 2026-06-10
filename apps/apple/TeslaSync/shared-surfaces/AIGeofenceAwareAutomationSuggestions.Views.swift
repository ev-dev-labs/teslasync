//
//  AIGeofenceAwareAutomationSuggestions.Views.swift
//  TeslaSync — P4 shared surface · 0020 · AIGeofenceAwareAutomationSuggestions (Apple)
//
//  The presentational subviews composed by `AIGeofenceAwareAutomationSuggestions`: the
//  `AIFeatureCard` scaffold parts (header + Helix badge + description + the universal
//  "Ask Helix" action), the prompt input (web `inputSlot` `Textarea`), and the captured-
//  proposal box (web `draft` children — name, description, the trigger/condition/action
//  counts, the validator reason, the "rejected by validator" line, and "Apply to form").
//  All consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind
//  ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web Helix accent on this card is
//  cyan-300 (badge pill, proposal box, "Proposed automation" label) → the brand cyan
//  `Color.TS.accent`; the validator-rejected line (web rose-300) → `statusDanger`.
//

import SwiftUI

// MARK: - Header (web `AIFeatureCard` title + badge + description + emptyHint)

/// The card header: the title, the cyan Helix badge, the one-paragraph description, and
/// the optional contextual hint shown when the action cannot start (web `!canStart &&
/// emptyHint`) — telling the user whether to pick a vehicle or describe the automation.
struct GeofenceAutomationHeader: View {
    let hint: GeofenceAutomationHint?

    private var title: String {
        GeofenceAutomationStrings.string(
            "automations.builder.aiGeofenceAware.title", "Suggest a geofence-aware automation"
        )
    }

    private var description: String {
        GeofenceAutomationStrings.string(
            "automations.builder.aiGeofenceAware.description",
            """
            Describe an automation that uses one of your existing geofences. Helix proposes a \
            typed graph anchored to a place_id you already have — review and apply to the form \
            below before saving.
            """
        )
    }

    private var hintText: String? {
        switch hint {
        case .selectVehicle:
            GeofenceAutomationStrings.string(
                "automations.builder.aiGeofenceAware.emptyHintVehicle",
                "Select a vehicle to scope the automation."
            )
        case .describeAutomation:
            GeofenceAutomationStrings.string(
                "automations.builder.aiGeofenceAware.emptyHintPrompt",
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
                GeofenceAutomationHelixBadge()
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
struct GeofenceAutomationHelixBadge: View {
    private var label: String {
        GeofenceAutomationStrings.string("automations.builder.aiGeofenceAware.badge", "Helix")
    }

    private var tooltip: String {
        GeofenceAutomationStrings.string(
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
        .accessibilityLabel(Text(verbatim: GeofenceAutomationStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Prompt field (web `inputSlot` Textarea)

/// The free-form prompt input — the native parity of the web `Textarea`, with the same
/// hint shown until the user types. Tokenised chrome (no raw hex); the hint is decorative
/// (a11y-hidden) and the field exposes its own VoiceOver label + value so the editor reads
/// correctly.
struct GeofenceAutomationPromptField: View {
    @Binding var text: String

    private var promptHint: String {
        GeofenceAutomationStrings.string(
            "automations.builder.aiGeofenceAware.promptHint",
            "e.g. when I arrive home on a weekday after sunset, turn on cabin overheat protection"
        )
    }

    private var fieldLabel: String {
        GeofenceAutomationStrings.string(
            "automations.builder.aiGeofenceAware.promptLabel", "Automation prompt"
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

/// The universal Helix action — visible "Ask Helix" when idle and "Helix is thinking…"
/// while streaming (web `AIThinkingDots`), with the per-feature verb folded into the
/// accessibility label ("Ask Helix · Suggest automation"). Disabled (computed, never
/// literal) from the prompt / stream lifecycle / connectivity. Placed on its own trailing
/// row (web `inputSlot` implies `buttonPlacement="below"`).
struct GeofenceAutomationActionButton: View {
    let isStreaming: Bool
    let disabled: Bool
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var askLabel: String {
        GeofenceAutomationStrings.string("helix.askHelix", "Ask Helix")
    }

    private var thinkingLabel: String {
        GeofenceAutomationStrings.string("helix.thinking", "Helix is thinking…")
    }

    private var verb: String {
        GeofenceAutomationStrings.string(
            "automations.builder.aiGeofenceAware.suggestButton", "Suggest automation"
        )
    }

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(variant: .secondary, size: .small, action: onTap) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                        .geofenceAutomationSymbolPulse(active: isStreaming && !reduceMotion)
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

/// The captured-proposal box (web `draft`): the "Proposed automation" label, the proposed
/// name (or "(unnamed)"), the optional description, the trigger/condition/action counts,
/// the optional validator reason, the "rejected by validator" line for a non-`ok` verdict,
/// and the "Apply to form" action (disabled unless `ok`).
struct GeofenceAutomationProposal: View {
    let draft: GeofenceAutomationDraft
    let onApply: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: proposedLabel)
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.accent)
                Text(verbatim: displayName)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                if !draft.input.description.isEmpty {
                    Text(verbatim: draft.input.description)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                GeofenceAutomationCountsLine(input: draft.input)
                if let reason = draft.validationError, !reason.isEmpty {
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

    private var displayName: String {
        draft.input.name.isEmpty
            ? GeofenceAutomationStrings.string("automations.builder.aiGeofenceAware.unnamed", "(unnamed)")
            : draft.input.name
    }

    private var proposedLabel: String {
        GeofenceAutomationStrings.string(
            "automations.builder.aiGeofenceAware.proposalLabel", "Proposed automation"
        )
    }

    private var rejectedLabel: String {
        GeofenceAutomationStrings.string(
            "automations.builder.aiGeofenceAware.rejectedLabel", "Proposal rejected by validator"
        )
    }

    private var applyLabel: String {
        GeofenceAutomationStrings.string(
            "automations.builder.aiGeofenceAware.applyButton", "Apply to form"
        )
    }
}

// MARK: - Counts line (web "Triggers: N · Conditions: N · Actions: N")

/// The graph-shape summary line: trigger / condition / action counts joined by `·`, each
/// count voiced as part of the proposal's combined VoiceOver element.
struct GeofenceAutomationCountsLine: View {
    let input: GeofenceAutomationInput

    private var triggersLabel: String {
        GeofenceAutomationStrings.string("automations.builder.aiGeofenceAware.triggersLabel", "Triggers")
    }

    private var conditionsLabel: String {
        GeofenceAutomationStrings.string("automations.builder.aiGeofenceAware.conditionsLabel", "Conditions")
    }

    private var actionsLabel: String {
        GeofenceAutomationStrings.string("automations.builder.aiGeofenceAware.actionsLabel", "Actions")
    }

    private var text: String {
        "\(triggersLabel): \(input.triggers.count) · "
            + "\(conditionsLabel): \(input.conditions.count) · "
            + "\(actionsLabel): \(input.actions.count)"
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
