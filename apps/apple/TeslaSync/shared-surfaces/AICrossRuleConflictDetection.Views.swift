//
//  AICrossRuleConflictDetection.Views.swift
//  TeslaSync — P4 shared surface · 0014 · AICrossRuleConflictDetection (Apple)
//
//  The presentational subviews composed by `AICrossRuleConflictDetection`: the `AIFeatureCard`
//  scaffold parts (header + Helix badge + description + the universal "Ask Helix" action) and
//  the captured-conflicts list (web `conflicts` children) — each row's kind label, the "Rule A
//  ↔ Rule B · signal" relationship line, the optional reason, the structural-mismatch chips,
//  and the two "Review rule" actions. All consume the P1/S10 facade and the shared P1/S9
//  tokens — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web conflict card accent is amber-300
//  (kind label, the amber box, the `subsumes` chip) → the brand `statusWarning`; the three
//  `*Mismatch` chips (web rose-300) → `statusDanger`; the Helix badge cyan → `accent`.
//

import SwiftUI

// MARK: - Header (web `AIFeatureCard` title + badge + description + emptyHint)

/// The card header: the title, the cyan Helix badge, the one-paragraph description, and the
/// optional empty hint shown when the action cannot start (web `!canStart && emptyHint`).
struct RuleConflictHeader: View {
    let canStart: Bool

    private var title: String {
        RuleConflictStrings.string("notifications.alertStudio.aiConflicts.title", "Detect cross-rule conflicts")
    }

    private var description: String {
        RuleConflictStrings.string(
            "notifications.alertStudio.aiConflicts.description",
            """
            Surface structural overlaps between your alert rule definitions. Review only — \
            Helix never edits, merges, or deletes rules.
            """
        )
    }

    private var emptyHint: String {
        RuleConflictStrings.string(
            "notifications.alertStudio.aiConflicts.emptyHint",
            "Select at least two rules to compare."
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
                RuleConflictHelixBadge()
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
struct RuleConflictHelixBadge: View {
    private var label: String {
        RuleConflictStrings.string("notifications.alertStudio.aiConflicts.badge", "Helix")
    }

    private var tooltip: String {
        RuleConflictStrings.string(
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
        .accessibilityLabel(Text(verbatim: RuleConflictStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Action button (web universal "Ask Helix" CTA)

/// The universal Helix action — visible "Ask Helix" when idle and "Helix is thinking…" while
/// streaming (web `AIThinkingDots`), with the per-feature verb folded into the accessibility
/// label ("Ask Helix · Detect conflicts"). Disabled (computed, never literal) from the stream
/// lifecycle + connectivity. Placed on its own trailing row (web `buttonPlacement="below"`).
struct RuleConflictActionButton: View {
    let isStreaming: Bool
    let disabled: Bool
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var askLabel: String {
        RuleConflictStrings.string("helix.askHelix", "Ask Helix")
    }

    private var thinkingLabel: String {
        RuleConflictStrings.string("helix.thinking", "Helix is thinking…")
    }

    private var verb: String {
        RuleConflictStrings.string("notifications.alertStudio.aiConflicts.detectButton", "Detect conflicts")
    }

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(variant: .secondary, size: .small, action: onTap) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                        .ruleConflictSymbolPulse(active: isStreaming && !reduceMotion)
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

// MARK: - Conflict list (web `conflicts.map(...)`)

/// The captured-conflicts list (web `<ul>`). Renders one `RuleConflictRow` per conflict in the
/// tool's order; the kind label is resolved here through the P1/S10 facade so the row stays
/// presentational.
struct RuleConflictList: View {
    let conflicts: [RuleConflict]
    let onReview: (Int64) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(conflicts) { conflict in
                RuleConflictRow(
                    conflict: conflict,
                    kindLabel: RuleConflictRow.label(for: conflict.kind),
                    onReview: onReview
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Conflict row (web `<li>` content)

/// One conflict row: the kind label, the "Rule A ↔ Rule B · signal" relationship line, the
/// optional reason, the structural-mismatch chips, and the two "Review rule {id}" actions —
/// the web `onSelectRule` hand-off for each offending rule.
struct RuleConflictRow: View {
    let conflict: RuleConflict
    let kindLabel: String
    let onReview: (Int64) -> Void

    /// Resolves a conflict kind to its localised label, falling back to the raw kind string for
    /// an unknown kind (web `labelForKind`'s `return kind`).
    static func label(for kind: String) -> String {
        guard let loc = RuleConflictKind.localization(for: kind) else { return kind }
        return RuleConflictStrings.string(loc.key, loc.fallback)
    }

    private var rulePrefix: String {
        RuleConflictStrings.string("notifications.alertStudio.aiConflicts.rulePrefix", "Rule")
    }

    private var reviewLabel: String {
        RuleConflictStrings.string("notifications.alertStudio.aiConflicts.reviewButton", "Review rule")
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: kindLabel)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.statusWarning)
                    .fixedSize(horizontal: false, vertical: true)
                Text(verbatim: conflict.relationDescription(rulePrefix: rulePrefix))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let reason = conflict.reason, !reason.isEmpty {
                    Text(verbatim: reason)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                let flags = conflict.activeFlags()
                if !flags.isEmpty {
                    RuleConflictFlowLayout(spacing: TSSpacing.xs) {
                        ForEach(flags, id: \.self) { flag in
                            RuleConflictFlagChip(flag: flag)
                        }
                    }
                    .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            reviewButtons
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusWarning.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.30), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var reviewButtons: some View {
        VStack(spacing: TSSpacing.xs) {
            reviewButton(for: conflict.ruleAID)
            reviewButton(for: conflict.ruleBID)
        }
        .fixedSize()
    }

    private func reviewButton(for ruleID: Int64) -> some View {
        let label = "\(reviewLabel) \(ruleID)"
        return TSButton(
            variant: .secondary,
            size: .small,
            action: { onReview(ruleID) },
            label: { Text(verbatim: label).font(Font.TS.label) }
        )
        .accessibilityLabel(Text(verbatim: label))
    }
}
