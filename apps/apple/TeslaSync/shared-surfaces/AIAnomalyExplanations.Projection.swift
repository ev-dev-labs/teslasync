//
//  AIAnomalyExplanations.Projection.swift
//  TeslaSync — P4 shared surface · 0005 · AIAnomalyExplanations (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Ask-Helix button, the `canStart = vehicleId != null` rule, and the
//  `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation (no store,
//  no SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIAnomalyExplanations` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip,
/// and every `AiOutputPanel` branch.
public enum AnomalyExplanationsProjection {
    public static func resolve(
        _ input: AnomalyExplanationsInput,
        locale: Locale = .current
    ) -> AnomalyExplanationsResolved {
        switch input.availability {
        case .loading:
            return AnomalyExplanationsResolved(phase: .loading)
        case let .failed(message):
            return AnomalyExplanationsResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return AnomalyExplanationsResolved(phase: .gated) }
            return AnomalyExplanationsResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: AnomalyExplanationsInput, locale _: Locale) -> AnomalyReady {
        let canStart = input.vehicleID != nil
        let action = AnomalyAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = AnomalyExplanationsStrings.string(
            "anomaly.aiExplanation.generateButton",
            "Generate explanation"
        )
        let askHelix = AnomalyExplanationsStrings.string("helix.askHelix", "Ask Helix")
        let thinking = AnomalyExplanationsStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return AnomalyReady(
            title: AnomalyExplanationsStrings.string("anomaly.aiExplanation.title", "Helix explanation"),
            description: AnomalyExplanationsStrings.string(
                "anomaly.aiExplanation.description",
                "Get a plain-language explanation of the anomalies the detector has "
                    + "already identified above."
            ),
            badge: AnomalyExplanationsStrings.string("anomaly.aiExplanation.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: AnomalyAccessibility.actionLabel(ask: askHelix, context: buttonContext),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `AnomalyOutputKind` into the view-ready output. The friendly empty
    /// hint distinguishes the no-vehicle case (web button disabled) from the started-but-idle case,
    /// keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(for snapshot: AnomalyStreamSnapshot, canStart: Bool) -> AnomalyResolvedOutput {
        let title = AnomalyExplanationsStrings.string("anomaly.output.a11yTitle", "Helix explanation")
        switch AnomalyOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? AnomalyExplanationsStrings.string(
                    "anomaly.output.emptyHint",
                    "No explanation yet — ask Helix to generate one."
                )
                : AnomalyExplanationsStrings.string(
                    "anomaly.output.noVehicleHint",
                    "Select a vehicle to ask Helix for an explanation."
                )
            return AnomalyResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = AnomalyExplanationsStrings.string("helix.thinking", "Helix is thinking…")
            return AnomalyResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return AnomalyResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: AnomalyAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = AnomalyExplanationsStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? AnomalyExplanationsStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return AnomalyResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
