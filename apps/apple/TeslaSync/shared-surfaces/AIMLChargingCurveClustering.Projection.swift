//
//  AIMLChargingCurveClustering.Projection.swift
//  TeslaSync — P4 shared surface · 0027 · AIMLChargingCurveClustering (Apple)
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
/// `AIMLChargingCurveClustering` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip,
/// and every `AiOutputPanel` branch.
public enum MLChargeCurveProjection {
    public static func resolve(
        _ input: MLChargeCurveInput,
        locale: Locale = .current
    ) -> MLChargeCurveResolved {
        switch input.availability {
        case .loading:
            return MLChargeCurveResolved(phase: .loading)
        case let .failed(message):
            return MLChargeCurveResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return MLChargeCurveResolved(phase: .gated) }
            return MLChargeCurveResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: MLChargeCurveInput, locale _: Locale) -> MLChargeCurveReady {
        let canStart = input.vehicleID != nil
        let action = MLChargeCurveAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = MLChargeCurveStrings.string(
            "charging.aiMlClustering.generateButton",
            "Train charging-curve clusters"
        )
        let askHelix = MLChargeCurveStrings.string("helix.askHelix", "Ask Helix")
        let thinking = MLChargeCurveStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return MLChargeCurveReady(
            title: MLChargeCurveStrings.string(
                "charging.aiMlClustering.title",
                "Learn per-vehicle charging-curve clusters"
            ),
            description: MLChargeCurveStrings.string(
                "charging.aiMlClustering.description",
                "Compute per-cluster (L1 overnight / L2 workplace / DC fast) learned "
                    + "charging envelope from this vehicle’s recent sessions and walk through "
                    + "how each cluster compares to the deterministic rule-label baseline "
                    + "used by the Charging Curve page today."
            ),
            badge: MLChargeCurveStrings.string("charging.aiMlClustering.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: MLChargeCurveAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `MLChargeCurveOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the no-vehicle case (web button disabled) from the started-but-idle
    /// case, keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: MLChargeCurveStreamSnapshot,
        canStart: Bool
    ) -> MLChargeCurveResolvedOutput {
        let title = MLChargeCurveStrings.string("charging.aiMlClustering.output.a11yTitle", "Charging-curve clusters")
        switch MLChargeCurveOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? MLChargeCurveStrings.string(
                    "charging.aiMlClustering.output.emptyHint",
                    "No clusters trained yet — ask Helix to learn this vehicle’s charging curves."
                )
                : MLChargeCurveStrings.string(
                    "charging.aiMlClustering.output.noVehicleHint",
                    "Select a vehicle to train its charging-curve clusters."
                )
            return MLChargeCurveResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = MLChargeCurveStrings.string("helix.thinking", "Helix is thinking…")
            return MLChargeCurveResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return MLChargeCurveResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: MLChargeCurveAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = MLChargeCurveStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? MLChargeCurveStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return MLChargeCurveResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
