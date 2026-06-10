//
//  AILearnedAnomalyBaselines.Projection.swift
//  TeslaSync — P4 shared surface · 0023 · AILearnedAnomalyBaselines (Apple)
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
/// `AILearnedAnomalyBaselines` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip,
/// and every `AiOutputPanel` branch.
public enum BaselineProjection {
    public static func resolve(
        _ input: BaselineInput,
        locale: Locale = .current
    ) -> BaselineResolved {
        switch input.availability {
        case .loading:
            return BaselineResolved(phase: .loading)
        case let .failed(message):
            return BaselineResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return BaselineResolved(phase: .gated) }
            return BaselineResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: BaselineInput, locale _: Locale) -> BaselineReady {
        let canStart = input.vehicleID != nil
        let action = BaselineAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = LearnedBaselineStrings.string(
            "anomaly.aiBaseline.generateButton",
            "Train baseline"
        )
        let askHelix = LearnedBaselineStrings.string("helix.askHelix", "Ask Helix")
        let thinking = LearnedBaselineStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return BaselineReady(
            title: LearnedBaselineStrings.string("anomaly.aiBaseline.title", "Learn per-vehicle baseline"),
            description: LearnedBaselineStrings.string(
                "anomaly.aiBaseline.description",
                "Compute statistical anomaly bounds (mean, stddev, p5/p95) from this vehicle's "
                    + "recent signal history and walk through how each signal compares to the "
                    + "static safe-range fallback."
            ),
            badge: LearnedBaselineStrings.string("anomaly.aiBaseline.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: BaselineAccessibility.actionLabel(ask: askHelix, context: buttonContext),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `BaselineOutputKind` into the view-ready output. The friendly empty
    /// hint distinguishes the no-vehicle case (web button disabled) from the started-but-idle case,
    /// keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(for snapshot: BaselineStreamSnapshot, canStart: Bool) -> BaselineResolvedOutput {
        let title = LearnedBaselineStrings.string("anomaly.baseline.a11yTitle", "Learned baseline")
        switch BaselineOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? LearnedBaselineStrings.string(
                    "anomaly.baseline.emptyHint",
                    "No baseline yet — ask Helix to train one."
                )
                : LearnedBaselineStrings.string(
                    "anomaly.baseline.noVehicleHint",
                    "Select a vehicle to train a learned baseline."
                )
            return BaselineResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = LearnedBaselineStrings.string("helix.thinking", "Helix is thinking…")
            return BaselineResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return BaselineResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: BaselineAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = LearnedBaselineStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? LearnedBaselineStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return BaselineResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
