//
//  AIAlertTuningSuggestions.Projection.swift
//  TeslaSync — P4 shared surface · 0004 · AIAlertTuningSuggestions (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard` header /
//  description / Suggest button, the `canStart = !!ruleId && state !== 'paused-confirm'` rule, the
//  `AiOutputPanel` branches, and the captured-proposal `proposal && (...)` block with its "Apply to
//  form" button + preview list) plus the P4 leaf contract stay unit testable in isolation (no store,
//  no SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIAlertTuningSuggestions` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart` rule, the Suggest label flip, every
/// `AiOutputPanel` branch, and the captured-proposal preview + Apply button.
public enum AlertTuningProjection {
    public static func resolve(
        _ input: AlertTuningInput,
        locale: Locale = .current
    ) -> AlertTuningResolved {
        switch input.availability {
        case .loading:
            return AlertTuningResolved(phase: .loading)
        case let .failed(message):
            return AlertTuningResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return AlertTuningResolved(phase: .gated) }
            return AlertTuningResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output + proposal)

    private static func ready(for input: AlertTuningInput, locale _: Locale) -> AlertTuningReady {
        let state = input.stream.state
        let canStart = AlertTuningBusy.canStart(ruleID: input.ruleID, state: state)
        let action = AlertTuningAction.derive(canStart: canStart, state: state)

        let buttonContext = AlertTuningStrings.string(
            "notifications.alertStudio.aiTuning.suggestButton",
            "Suggest tuning"
        )
        let askHelix = AlertTuningStrings.string("helix.askHelix", "Ask Helix")
        let thinking = AlertTuningStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return AlertTuningReady(
            title: AlertTuningStrings.string(
                "notifications.alertStudio.aiTuning.title",
                "Suggest lower-noise tuning"
            ),
            description: AlertTuningStrings.string(
                "notifications.alertStudio.aiTuning.description",
                "Review recent firings and propose a typed AlertRule patch. "
                    + "Descriptive replay only — review before saving."
            ),
            badge: AlertTuningStrings.string("notifications.alertStudio.aiTuning.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: AlertTuningAccessibility.actionLabel(ask: askHelix, context: buttonContext),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, hasRule: input.ruleID != nil),
            proposal: proposal(for: input.stream)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `AlertTuningOutputKind` into the view-ready output. The friendly empty
    /// hint distinguishes the no-rule case (web button disabled, `!ruleId`) from the rule-selected
    /// idle case, keeping the P4 "never a blank box" rule while preserving the web `canStart`
    /// semantics.
    private static func output(for snapshot: AlertTuningStreamSnapshot, hasRule: Bool) -> AlertTuningResolvedOutput {
        let title = AlertTuningStrings.string("notifications.alertStudio.aiTuning.title", "Suggest lower-noise tuning")
        switch AlertTuningOutput.derive(snapshot) {
        case .empty:
            let hint = hasRule
                ? AlertTuningStrings.string(
                    "alertTuning.output.emptyHint",
                    "No suggestion yet — ask Helix to propose a tuning patch."
                )
                : AlertTuningStrings.string(
                    "alertTuning.output.noRuleHint",
                    "Select an alert rule to suggest tuning."
                )
            return AlertTuningResolvedOutput(kind: .empty, body: hint, accessibilityLabel: hint)
        case .thinking:
            let label = AlertTuningStrings.string("helix.thinking", "Helix is thinking…")
            return AlertTuningResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return AlertTuningResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: AlertTuningAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = AlertTuningStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? AlertTuningStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return AlertTuningResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }

    // MARK: Captured-proposal region (web `proposal && (...)`)

    /// Localizes the captured-proposal block — the "Apply to form" action + the "Proposed patch
    /// (review before saving):" preview list. Withdrawn entirely when no patch has been captured (web
    /// renders nothing when `proposal` is null). The Apply button's disabled rule mirrors web
    /// `disabled={proposal == null || isBusy}`.
    private static func proposal(for snapshot: AlertTuningStreamSnapshot) -> AlertTuningResolvedProposal {
        guard let patch = snapshot.proposal else { return .absent }
        let rows = patch.rows().map { row in
            AlertTuningProposalRow(
                field: row.field,
                value: row.value,
                accessibilityLabel: AlertTuningAccessibility.proposalRow(field: row.field, value: row.value)
            )
        }
        let applyTitle = AlertTuningStrings.string("notifications.alertStudio.aiTuning.applyButton", "Apply to form")
        return AlertTuningResolvedProposal(
            isPresent: true,
            previewLabel: AlertTuningStrings.string(
                "notifications.alertStudio.aiTuning.previewLabel",
                "Proposed patch (review before saving):"
            ),
            rows: rows,
            applyTitle: applyTitle,
            applyDisabled: AlertTuningBusy.applyDisabled(hasProposal: true, state: snapshot.state),
            applyAccessibilityLabel: applyTitle
        )
    }
}
