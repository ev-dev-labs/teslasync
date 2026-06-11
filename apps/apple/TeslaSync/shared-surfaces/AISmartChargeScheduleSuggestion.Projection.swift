//
//  AISmartChargeScheduleSuggestion.Projection.swift
//  TeslaSync — P4 shared surface · 0047 · AISmartChargeScheduleSuggestion (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Draft-a-schedule button, the `canStart = haveInputs` rule, and the
//  `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation (no store, no
//  SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of the result.
//
//  Parity note: the web source does NOT pass `emptyHint` to `AIFeatureCard`, so there is no
//  description-level hint line. The "select a vehicle and a rate plan" guidance instead lives in the
//  output panel's friendly empty state, honouring the P4 "never a blank box" rule while preserving
//  the web `canStart` semantics.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AISmartChargeScheduleSuggestion` render plus the `withAiFeature` gate and the P4 leaf contract.
/// Unit tested across gated / loading / error / ready, the `canStart = haveInputs` rule (both the
/// vehicle and the rate-plan halves, incl. the nil / 0 boundaries), the Draft-a-schedule label flip,
/// and every `AiOutputPanel` branch.
public enum SmartChargeScheduleProjection {
    public static func resolve(
        _ input: SmartChargeScheduleInput,
        locale: Locale = .current
    ) -> SmartChargeScheduleResolved {
        switch input.availability {
        case .loading:
            return SmartChargeScheduleResolved(phase: .loading)
        case let .failed(message):
            return SmartChargeScheduleResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return SmartChargeScheduleResolved(phase: .gated) }
            return SmartChargeScheduleResolved(
                phase: .ready,
                ready: ready(for: input, locale: locale)
            )
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: SmartChargeScheduleInput,
        locale _: Locale
    ) -> SmartChargeScheduleReady {
        // Web `haveInputs = !!vehicleId && !!ratePlanId`, and `canStart={haveInputs}`. Reuse the
        // adapter's rule so the gate, the request body, and the button stay a single source of truth.
        let canStart = SmartChargeScheduleRequest(
            vehicleID: input.vehicleID,
            ratePlanID: input.ratePlanID
        ).haveInputs
        let action = SmartChargeScheduleAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = SmartChargeScheduleStrings.string(
            "chargePlanner.aiAgent.generateButton",
            "Draft a schedule"
        )
        let askHelix = SmartChargeScheduleStrings.string("helix.askHelix", "Ask Helix")
        let thinking = SmartChargeScheduleStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return SmartChargeScheduleReady(
            title: SmartChargeScheduleStrings.string(
                "chargePlanner.aiAgent.title",
                "Draft a schedule with Helix"
            ),
            description: SmartChargeScheduleStrings.string(
                "chargePlanner.aiAgent.description",
                "Ask Helix to propose a time-of-use-optimized charge schedule grounded in your "
                    + "selected rate plan and target departure. The schedule is never saved "
                    + "automatically — review the proposed window and click Schedule below to apply it."
            ),
            badge: SmartChargeScheduleStrings.string("chargePlanner.aiAgent.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: SmartChargeScheduleAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `SmartChargeScheduleOutputKind` into the view-ready output. The
    /// friendly empty hint distinguishes the missing-inputs case (web button disabled) from the
    /// ready-but-idle case, keeping the P4 "never a blank box" rule while preserving the web
    /// `canStart` semantics.
    private static func output(
        for snapshot: SmartChargeScheduleStreamSnapshot,
        canStart: Bool
    ) -> SmartChargeScheduleResolvedOutput {
        let title = SmartChargeScheduleStrings.string(
            "chargePlanner.aiAgent.output.a11yTitle",
            "Charge schedule proposal"
        )
        switch SmartChargeScheduleOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? SmartChargeScheduleStrings.string(
                    "chargePlanner.aiAgent.output.emptyHint",
                    "No schedule drafted yet — ask Helix to propose a time-of-use-optimized charge window."
                )
                : SmartChargeScheduleStrings.string(
                    "chargePlanner.aiAgent.output.noInputsHint",
                    "Select a vehicle and a rate plan to draft a charge schedule."
                )
            return SmartChargeScheduleResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = SmartChargeScheduleStrings.string("helix.thinking", "Helix is thinking…")
            return SmartChargeScheduleResolvedOutput(
                kind: .thinking,
                body: label,
                accessibilityLabel: label
            )
        case let .prose(text):
            return SmartChargeScheduleResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: SmartChargeScheduleAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = SmartChargeScheduleStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? SmartChargeScheduleStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return SmartChargeScheduleResolvedOutput(
                kind: .failed,
                body: body,
                accessibilityLabel: body
            )
        }
    }
}
