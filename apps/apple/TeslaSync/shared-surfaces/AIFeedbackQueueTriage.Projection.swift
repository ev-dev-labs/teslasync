//
//  AIFeedbackQueueTriage.Projection.swift
//  TeslaSync — P4 shared surface · 0019 · AIFeedbackQueueTriage (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Suggest-triage button, the `canStart = haveFeedback` rule, and the
//  `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation (no store,
//  no SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIFeedbackQueueTriage` render plus the `withAiFeature` gate and the P4 leaf contract. Unit tested
/// across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip, and every
/// `AiOutputPanel` branch.
public enum FeedbackTriageProjection {
    public static func resolve(
        _ input: FeedbackTriageInput,
        locale: Locale = .current
    ) -> FeedbackTriageResolved {
        switch input.availability {
        case .loading:
            return FeedbackTriageResolved(phase: .loading)
        case let .failed(message):
            return FeedbackTriageResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return FeedbackTriageResolved(phase: .gated) }
            return FeedbackTriageResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: FeedbackTriageInput, locale _: Locale) -> FeedbackTriageReady {
        // Web `canStart={haveFeedback}` where `haveFeedback = feedbackId is a finite number > 0`. The
        // gate is bound to the exact request rule, so a nil / 0 / negative id keeps the button
        // disabled and the body ships the sentinel feedback_id 0 (unlike the vehicle-id surfaces
        // where 0 is a valid selection).
        let canStart = FeedbackTriageRequest(feedbackID: input.feedbackID).haveFeedback
        let action = FeedbackTriageAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = FeedbackTriageStrings.string(
            "feedbackTriage.aiAdvisor.button",
            "Suggest triage"
        )
        let askHelix = FeedbackTriageStrings.string("helix.askHelix", "Ask Helix")
        let thinking = FeedbackTriageStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return FeedbackTriageReady(
            title: FeedbackTriageStrings.string(
                "feedbackTriage.aiAdvisor.title",
                "Helix triage advisor"
            ),
            description: FeedbackTriageStrings.string(
                "feedbackTriage.aiAdvisor.description",
                "Get a proposed status, category, and priority label for this feedback row. The "
                    + "advisor reads only the redacted envelope (id, category, title, body excerpt, "
                    + "page route, app version, status, created_at) — never the reporter email, IP, "
                    + "console tail, or recent errors. The proposal is informational; your existing "
                    + "manual controls above remain the only way to save changes."
            ),
            badge: FeedbackTriageStrings.string("feedbackTriage.aiAdvisor.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: FeedbackTriageAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `FeedbackTriageOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the no-feedback case (web button disabled) from the started-but-idle
    /// case, keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: FeedbackTriageStreamSnapshot,
        canStart: Bool
    ) -> FeedbackTriageResolvedOutput {
        let title = FeedbackTriageStrings.string(
            "feedbackTriage.aiAdvisor.output.a11yTitle",
            "Triage proposal"
        )
        switch FeedbackTriageOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? FeedbackTriageStrings.string(
                    "feedbackTriage.aiAdvisor.output.emptyHint",
                    "No proposal yet — ask Helix to suggest a status, category, and priority for "
                        + "this feedback row."
                )
                : FeedbackTriageStrings.string(
                    "feedbackTriage.aiAdvisor.output.noFeedbackHint",
                    "Select a feedback row to ask Helix for a triage proposal."
                )
            return FeedbackTriageResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = FeedbackTriageStrings.string("helix.thinking", "Helix is thinking…")
            return FeedbackTriageResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return FeedbackTriageResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: FeedbackTriageAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = FeedbackTriageStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? FeedbackTriageStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return FeedbackTriageResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
