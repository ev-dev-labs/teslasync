//
//  AITripPlannerLLMAgent.Projection.swift
//  TeslaSync — P4 shared surface · 0055 · AITripPlannerLLMAgent (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Draft-a-plan button, the
//  `canStart = !!vehicleId && origin != null && destination != null` rule, and the `AiOutputPanel`
//  branches) plus the P4 leaf contract stay unit testable in isolation (no store, no SwiftUI).
//  Localization is applied here (P1/S10) so the view is a pure function of the result.
//
//  Parity note: the web source does NOT pass `emptyHint` to `AIFeatureCard`, so there is no
//  description-level hint line. The "select a vehicle, an origin, and a destination" guidance instead
//  lives in the output panel's friendly empty state, honouring the P4 "never a blank box" rule while
//  preserving the web `canStart` semantics.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AITripPlannerLLMAgent` render plus the `withAiFeature` gate and the P4 leaf contract. Unit tested
/// across gated / loading / error / ready, the `canStart = haveInputs` rule (the vehicle, origin, and
/// destination thirds, incl. the nil / 0 boundaries), the Draft-a-plan label flip, and every
/// `AiOutputPanel` branch.
public enum TripPlannerAgentProjection {
    public static func resolve(
        _ input: TripPlannerAgentInput,
        locale: Locale = .current
    ) -> TripPlannerAgentResolved {
        switch input.availability {
        case .loading:
            return TripPlannerAgentResolved(phase: .loading)
        case let .failed(message):
            return TripPlannerAgentResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return TripPlannerAgentResolved(phase: .gated) }
            return TripPlannerAgentResolved(
                phase: .ready,
                ready: ready(for: input, locale: locale)
            )
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: TripPlannerAgentInput,
        locale _: Locale
    ) -> TripPlannerAgentReady {
        // Web `haveInputs = !!vehicleId && origin != null && destination != null`, and
        // `canStart={haveInputs}`. Reuse the adapter's rule so the gate, the request body, and the
        // button stay a single source of truth.
        let canStart = TripPlannerAgentRequest(
            vehicleID: input.vehicleID,
            origin: input.origin,
            destination: input.destination
        ).haveInputs
        let action = TripPlannerAgentAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = TripPlannerAgentStrings.string(
            "tripPlanner.aiAgent.generateButton",
            "Draft a plan"
        )
        let askHelix = TripPlannerAgentStrings.string("helix.askHelix", "Ask Helix")
        let thinking = TripPlannerAgentStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return TripPlannerAgentReady(
            title: TripPlannerAgentStrings.string(
                "tripPlanner.aiAgent.title",
                "Draft a plan with Helix"
            ),
            description: TripPlannerAgentStrings.string(
                "tripPlanner.aiAgent.description",
                "Ask Helix to draft a trip plan grounded in your past charging history along the "
                    + "corridor. The plan is never saved automatically — review the proposed plan and "
                    + "click Plan in the form below to save it."
            ),
            badge: TripPlannerAgentStrings.string("tripPlanner.aiAgent.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: TripPlannerAgentAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `TripPlannerAgentOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the missing-inputs case (web button disabled) from the ready-but-idle
    /// case, keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: TripPlannerAgentStreamSnapshot,
        canStart: Bool
    ) -> TripPlannerAgentResolvedOutput {
        let title = TripPlannerAgentStrings.string(
            "tripPlanner.aiAgent.output.a11yTitle",
            "Trip plan proposal"
        )
        switch TripPlannerAgentOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? TripPlannerAgentStrings.string(
                    "tripPlanner.aiAgent.output.emptyHint",
                    "No plan drafted yet — ask Helix to draft a trip plan grounded in your charging "
                        + "history along the corridor."
                )
                : TripPlannerAgentStrings.string(
                    "tripPlanner.aiAgent.output.noInputsHint",
                    "Select a vehicle, an origin, and a destination to draft a trip plan."
                )
            return TripPlannerAgentResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = TripPlannerAgentStrings.string("helix.thinking", "Helix is thinking…")
            return TripPlannerAgentResolvedOutput(
                kind: .thinking,
                body: label,
                accessibilityLabel: label
            )
        case let .prose(text):
            return TripPlannerAgentResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: TripPlannerAgentAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = TripPlannerAgentStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? TripPlannerAgentStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return TripPlannerAgentResolvedOutput(
                kind: .failed,
                body: body,
                accessibilityLabel: body
            )
        }
    }
}
