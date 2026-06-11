//
//  AIQuietHoursSuggestion.Views.swift
//  TeslaSync — P4 shared surface · 0041 · AIQuietHoursSuggestion (Apple)
//
//  The presentational subviews composed by `AIQuietHoursSuggestion`: the `AIFeatureCard` scaffold
//  parts (header + cyan Helix badge + description + the friendly idle hint + the universal "Ask Helix"
//  action), and the captured-proposal box (the web `proposal` children — the "Apply to form" action
//  plus the reviewable window preview: the window / weekday bitmask / bypass severities lines and the
//  insufficient-history + existing-count notes). All consume the P1/S10 facade and the shared P1/S9
//  tokens — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web Helix badge is cyan-300 → the brand cyan
//  `Color.TS.accent`; the web proposal box is emerald-300 (a positive/success accent) →
//  `Color.TS.statusSuccess`; the web insufficient-history note is amber-300 → `Color.TS.statusWarning`.
//  The web "Apply to form" Button is `variant="primary"` → `TSButton(variant: .primary)`.
//

import SwiftUI

// MARK: - Header (web `AIFeatureCard` title + badge + description + idle hint)

/// The card header: the title, the cyan Helix badge, the one-paragraph description, and the friendly
/// idle hint shown while nothing has been proposed yet (P4 empty contract) — so the resting card is
/// never a blank/confusing surface.
struct QuietHoursSuggestionHeader: View {
    let showIdleHint: Bool

    private var title: String {
        QuietHoursSuggestionStrings.string(
            "notifications.quietHours.aiSuggestion.title",
            "Suggest a quiet-hours window from your notification history"
        )
    }

    private var description: String {
        QuietHoursSuggestionStrings.string(
            "notifications.quietHours.aiSuggestion.description",
            """
            Ask Helix to recommend ONE quiet-hours window based on the trailing 30 days of your \
            notification cadence. Helix never reads individual notification titles or messages — it \
            consults a per-hour aggregate of non-critical events to find the sparsest interval. Apply \
            the recommendation to seed the form below; you remain in control of the Save button.
            """
        )
    }

    private var idleHint: String {
        QuietHoursSuggestionStrings.string(
            "notifications.quietHours.aiSuggestion.emptyHint",
            "No window suggested yet — ask Helix to propose one."
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
                QuietHoursSuggestionHelixBadge()
            }
            Text(verbatim: description)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if showIdleHint {
                Text(verbatim: idleHint)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Helix badge (web `AIBadge` cyan pill)

/// The small cyan "Helix" pill rendered beside the title — the native parity of the web `AIBadge`. The
/// brand mark is the `sparkles` SF Symbol tinted with the cyan accent.
struct QuietHoursSuggestionHelixBadge: View {
    private var label: String {
        QuietHoursSuggestionStrings.string("notifications.quietHours.aiSuggestion.badge", "Helix")
    }

    private var tooltip: String {
        QuietHoursSuggestionStrings.string(
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
        .accessibilityLabel(Text(verbatim: QuietHoursSuggestionStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Action button (web universal "Ask Helix" CTA)

/// The universal Helix action — visible "Ask Helix" when idle and "Helix is thinking…" while streaming
/// (web `AIThinkingDots`), with the per-feature verb ("Suggest quiet hours") folded into the
/// accessibility label ("Ask Helix · Suggest quiet hours"). Disabled (computed, never literal) from
/// the stream lifecycle / connectivity. Placed on its own trailing row (web `buttonPlacement="below"`).
struct QuietHoursSuggestionActionButton: View {
    let isStreaming: Bool
    let disabled: Bool
    let onTap: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var askLabel: String {
        QuietHoursSuggestionStrings.string("helix.askHelix", "Ask Helix")
    }

    private var thinkingLabel: String {
        QuietHoursSuggestionStrings.string("helix.thinking", "Helix is thinking…")
    }

    private var verb: String {
        QuietHoursSuggestionStrings.string(
            "notifications.quietHours.aiSuggestion.button", "Suggest quiet hours"
        )
    }

    var body: some View {
        HStack {
            Spacer(minLength: 0)
            TSButton(variant: .secondary, size: .small, action: onTap) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12, weight: .semibold))
                        .quietHoursSuggestionSymbolPulse(active: isStreaming && !reduceMotion)
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

// MARK: - Proposal box (web `proposal` children: Apply to form + reviewable preview)

/// The captured-proposal box (web `proposal`): the trailing "Apply to form" action (a `primary`
/// button, disabled while busy) above the reviewable preview card (the proposed window, the weekday
/// bitmask, the bypass severities, and the conditional insufficient-history / existing-count notes).
/// Voiced as a contained VoiceOver group.
struct QuietHoursSuggestionProposalBox: View {
    let proposal: QuietHoursDraftProposal
    let canApply: Bool
    let onApply: () -> Void

    private var applyLabel: String {
        QuietHoursSuggestionStrings.string(
            "notifications.quietHours.aiSuggestion.applyButton", "Apply to form"
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack {
                Spacer(minLength: 0)
                TSButton(variant: .primary, size: .small, action: onApply) {
                    Text(verbatim: applyLabel).font(Font.TS.label)
                }
                .disabled(!canApply)
                .accessibilityLabel(Text(verbatim: applyLabel))
            }
            QuietHoursSuggestionPreviewList(proposal: proposal)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Preview list (web `<ul>` of proposal lines)

/// The reviewable window preview — the native parity of the web emerald proposal box: the
/// "Proposed window (review before saving):" label, the window / weekday bitmask / bypass severities
/// bullet lines, and the conditional insufficient-history (amber) + existing-count notes.
struct QuietHoursSuggestionPreviewList: View {
    let proposal: QuietHoursDraftProposal

    private var previewLabel: String {
        QuietHoursSuggestionStrings.string(
            "notifications.quietHours.aiSuggestion.previewLabel", "Proposed window (review before saving):"
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: previewLabel)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.statusSuccess)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 4) {
                bullet(QuietHoursSuggestionFormat.windowLine(proposal), tone: Color.TS.textSecondary)
                bullet(QuietHoursSuggestionFormat.weekdaysLine(proposal), tone: Color.TS.textSecondary)
                bullet(QuietHoursSuggestionFormat.severitiesLine(proposal), tone: Color.TS.textSecondary)
                if proposal.hasInsufficientHistory {
                    bullet(QuietHoursSuggestionFormat.insufficientHistoryNote(), tone: Color.TS.statusWarning)
                }
                if proposal.hasExistingWindows {
                    bullet(QuietHoursSuggestionFormat.existingCountNote(proposal), tone: Color.TS.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusSuccess.opacity(0.05),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusSuccess.opacity(0.30), lineWidth: 1)
        )
    }

    private func bullet(_ text: String, tone: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(verbatim: "•")
                .font(Font.TS.caption)
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.caption)
                .foregroundStyle(tone)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Proposal formatting (web `t(key, vars)` interpolation of the proposal scalars)

/// Builds the localised, `{{token}}`-interpolated proposal lines from the captured window — shared by
/// the preview list (visible bullets) and the card's VoiceOver summary, so both read identically. Each
/// helper resolves the web key + default through the P1/S10 facade, then substitutes the runtime
/// scalars via `QuietHoursSuggestionLogic.interpolate` (the native `t(key, vars)`).
enum QuietHoursSuggestionFormat {
    /// Web `previewWindow`: "Window: {{start}} → {{end}} ({{tz}})".
    static func windowLine(_ proposal: QuietHoursDraftProposal) -> String {
        QuietHoursSuggestionLogic.interpolate(
            QuietHoursSuggestionStrings.string(
                "notifications.quietHours.aiSuggestion.previewWindow",
                "Window: {{start}} → {{end}} ({{tz}})"
            ),
            ["start": proposal.startLocal, "end": proposal.endLocal, "tz": proposal.timezone]
        )
    }

    /// Web `previewWeekdays`: "Weekday bitmask: {{weekdays}}".
    static func weekdaysLine(_ proposal: QuietHoursDraftProposal) -> String {
        QuietHoursSuggestionLogic.interpolate(
            QuietHoursSuggestionStrings.string(
                "notifications.quietHours.aiSuggestion.previewWeekdays", "Weekday bitmask: {{weekdays}}"
            ),
            ["weekdays": String(proposal.weekdays)]
        )
    }

    /// Web `previewBypass`: "Bypass severities: {{severities}}" (the joined, comma-separated list).
    static func severitiesLine(_ proposal: QuietHoursDraftProposal) -> String {
        QuietHoursSuggestionLogic.interpolate(
            QuietHoursSuggestionStrings.string(
                "notifications.quietHours.aiSuggestion.previewBypass", "Bypass severities: {{severities}}"
            ),
            ["severities": proposal.bypassSeverities.joined(separator: ", ")]
        )
    }

    /// Web `previewInsufficientHistory` note (shown when `status === 'insufficient_history'`).
    static func insufficientHistoryNote() -> String {
        QuietHoursSuggestionStrings.string(
            "notifications.quietHours.aiSuggestion.previewInsufficientHistory",
            "Helix had insufficient notification history; this is a conservative default."
        )
    }

    /// Web `previewExistingCount` note (shown when `existing_windows_count > 0`).
    static func existingCountNote(_ proposal: QuietHoursDraftProposal) -> String {
        QuietHoursSuggestionLogic.interpolate(
            QuietHoursSuggestionStrings.string(
                "notifications.quietHours.aiSuggestion.previewExistingCount",
                "You already have {{count}} quiet-hours window(s) configured."
            ),
            ["count": String(proposal.existingWindowsCount)]
        )
    }

    /// The concise, comma-joined window/weekday/severities summary the card's VoiceOver label reads.
    static func proposalSummary(_ proposal: QuietHoursDraftProposal) -> String {
        [windowLine(proposal), weekdaysLine(proposal), severitiesLine(proposal)]
            .joined(separator: ", ")
    }
}
