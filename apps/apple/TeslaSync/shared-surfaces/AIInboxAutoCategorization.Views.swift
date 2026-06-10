//
//  AIInboxAutoCategorization.Views.swift
//  TeslaSync — P4 shared surface · 0021 · AIInboxAutoCategorization (Apple)
//
//  The presentational subviews composed by `AIInboxAutoCategorization`: the `AIFeatureCard`
//  scaffold parts (header + cyan Helix badge + description + the universal "Ask Helix" action) and
//  the captured-proposal block (web `proposal` children) — the right-aligned "Apply categories as
//  filter" button and the wrapping list of "{category} · {count}" chips. All consume the P1/S10
//  facade and the shared P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web proposal accent is emerald-300 (the box,
//  the chips, the preview label) → the brand `statusSuccess`; the Helix badge cyan → `accent`.
//

import SwiftUI

// MARK: - Header (web `AIFeatureCard` title + badge + description)

/// The card header: the title, the cyan Helix badge, and the one-paragraph description (web
/// `AIFeatureCard` `title` / `badgeLabel` / `description`).
struct InboxCategoryHeader: View {
    private var title: String {
        InboxCategoryStrings.string("notifications.inbox.aiCategorize.title", "Suggest inbox categories")
    }

    private var description: String {
        InboxCategoryStrings.string(
            "notifications.inbox.aiCategorize.description",
            """
            Bucket recent alerts into categories from your inbox history. Descriptive replay only — \
            review before applying.
            """
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                InboxCategoryHelixBadge()
            }
            Text(verbatim: description)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Helix badge (web `AIBadge` cyan pill)

/// The small cyan "Helix" pill rendered beside the title — the native parity of the web `AIBadge`.
/// The brand mark is the `sparkles` SF Symbol tinted with the cyan accent.
struct InboxCategoryHelixBadge: View {
    private var label: String {
        InboxCategoryStrings.string("notifications.inbox.aiCategorize.badge", "Helix")
    }

    private var tooltip: String {
        InboxCategoryStrings.string(
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
        .accessibilityLabel(Text(verbatim: InboxCategoryStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Suggest action (web universal "Ask Helix" CTA)

/// The universal Helix action — visible "Ask Helix" when idle and "Helix is thinking…" while
/// streaming (web `AIThinkingDots`), with the per-feature verb folded into the accessibility label
/// ("Ask Helix · Suggest categories"). Disabled (computed, never literal) from the stream lifecycle
/// + connectivity. Placed on its own trailing row (web `buttonPlacement="below"`).
struct InboxCategorySuggestButton: View {
    let isStreaming: Bool
    let disabled: Bool
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var askLabel: String {
        InboxCategoryStrings.string("helix.askHelix", "Ask Helix")
    }

    private var thinkingLabel: String {
        InboxCategoryStrings.string("helix.thinking", "Helix is thinking…")
    }

    private var verb: String {
        InboxCategoryStrings.string("notifications.inbox.aiCategorize.suggestButton", "Suggest categories")
    }

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(variant: .secondary, size: .small, action: onTap) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                        .inboxCategorySymbolPulse(active: isStreaming && !reduceMotion)
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

// MARK: - Proposal block (web `proposal` children: Apply button + chip list)

/// The captured-proposal block (web `proposal && proposal.length > 0`): the right-aligned "Apply
/// categories as filter" button over a tinted box holding the preview label and the wrapping list
/// of category chips.
struct InboxCategoryProposalView: View {
    let buckets: [InboxCategoryBucket]
    let applyDisabled: Bool
    let onApply: () -> Void

    private var previewLabel: String {
        InboxCategoryStrings.string(
            "notifications.inbox.aiCategorize.previewLabel",
            "Proposed categories (review before applying):"
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack {
                Spacer(minLength: 0)
                InboxCategoryApplyButton(disabled: applyDisabled, onTap: onApply)
            }
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: previewLabel)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.statusSuccess)
                    .fixedSize(horizontal: false, vertical: true)
                InboxCategoryFlowLayout(spacing: TSSpacing.sm) {
                    ForEach(buckets) { bucket in
                        InboxCategoryChip(bucket: bucket)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .background(
                Color.TS.statusSuccess.opacity(0.06),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.statusSuccess.opacity(0.30), lineWidth: 1)
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The "Apply categories as filter" action (web `<Button variant="primary">`) — disabled (computed,
/// never literal) when no rule ids were captured or a stream is busy. Forwards the captured rule-id
/// union to the parent; the AI panel never writes to the API itself.
struct InboxCategoryApplyButton: View {
    let disabled: Bool
    let onTap: () -> Void

    private var label: String {
        InboxCategoryStrings.string(
            "notifications.inbox.aiCategorize.applyButton",
            "Apply categories as filter"
        )
    }

    var body: some View {
        TSButton(variant: .primary, size: .small, action: onTap) {
            Text(verbatim: label)
                .font(Font.TS.label)
        }
        .disabled(disabled)
        .accessibilityLabel(Text(verbatim: label))
    }
}
