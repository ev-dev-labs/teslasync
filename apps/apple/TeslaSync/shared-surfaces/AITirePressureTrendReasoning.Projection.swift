//
//  AITirePressureTrendReasoning.Projection.swift
//  TeslaSync — P4 shared surface · 0054 · AITirePressureTrendReasoning (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Ask-Helix button, the `canStart = isFinite(vehicleId) && vehicleId > 0`
//  rule, and the `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation
//  (no store, no SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of
//  the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AITirePressureTrendReasoning` render plus the `withAiFeature` gate and the P4 leaf contract.
/// Unit tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label
/// flip, and every `AiOutputPanel` branch.
public enum TirePressureTrendReasoningProjection {
    public static func resolve(
        _ input: TirePressureTrendReasoningInput,
        locale: Locale = .current
    ) -> TirePressureTrendReasoningResolved {
        switch input.availability {
        case .loading:
            return TirePressureTrendReasoningResolved(phase: .loading)
        case let .failed(message):
            return TirePressureTrendReasoningResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return TirePressureTrendReasoningResolved(phase: .gated) }
            return TirePressureTrendReasoningResolved(
                phase: .ready,
                ready: ready(for: input, locale: locale)
            )
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: TirePressureTrendReasoningInput,
        locale _: Locale
    ) -> TirePressureTrendReasoningReady {
        // Web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`.
        let canStart = TirePressureTrendReasoningVehicleID.canStart(input.vehicleID)
        let action = TirePressureTrendReasoningAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = TirePressureTrendReasoningStrings.string(
            "tirePressure.aiTrendReasoning.generateButton",
            "Narrate trend"
        )
        let askHelix = TirePressureTrendReasoningStrings.string("helix.askHelix", "Ask Helix")
        let thinking = TirePressureTrendReasoningStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return TirePressureTrendReasoningReady(
            title: TirePressureTrendReasoningStrings.string(
                "tirePressure.aiTrendReasoning.title",
                "Narrate the 30-day tire-pressure trend"
            ),
            description: TirePressureTrendReasoningStrings.string(
                "tirePressure.aiTrendReasoning.description",
                "Ask Helix to explain the recent 30-day trend in this vehicle\u{2019}s four corner "
                    + "tire pressures \u{2014} which tires are trending up, down, or stable, the most "
                    + "likely deterministic driver of any deviation (cold-weather correlation, "
                    + "all-tires-trending suggesting weather rather than puncture, single-corner "
                    + "slow-leak signature), and any actionable threshold crossing. The per-corner "
                    + "pressures and thresholds are the same the gauges below show; the narrator only "
                    + "explains them and is honest that the slope is a descriptive linear "
                    + "extrapolation, not a forecast."
            ),
            badge: TirePressureTrendReasoningStrings.string("tirePressure.aiTrendReasoning.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: TirePressureTrendReasoningAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `TirePressureTrendReasoningOutputKind` into the view-ready output.
    /// The friendly empty hint distinguishes the no-vehicle case (web button disabled) from the
    /// started-but-idle case, keeping the P4 "never a blank box" rule while preserving the web
    /// `canStart` semantics.
    private static func output(
        for snapshot: TirePressureTrendReasoningStreamSnapshot,
        canStart: Bool
    ) -> TirePressureTrendReasoningResolvedOutput {
        let title = TirePressureTrendReasoningStrings.string(
            "tirePressure.aiTrendReasoning.output.a11yTitle",
            "Tire-pressure trend narration"
        )
        switch TirePressureTrendReasoningOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? TirePressureTrendReasoningStrings.string(
                    "tirePressure.aiTrendReasoning.output.emptyHint",
                    "No narration yet \u{2014} ask Helix to narrate the 30-day tire-pressure trend."
                )
                : TirePressureTrendReasoningStrings.string(
                    "tirePressure.aiTrendReasoning.output.noVehicleHint",
                    "Select a vehicle to ask Helix to narrate the tire-pressure trend."
                )
            return TirePressureTrendReasoningResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = TirePressureTrendReasoningStrings.string("helix.thinking", "Helix is thinking…")
            return TirePressureTrendReasoningResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return TirePressureTrendReasoningResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: TirePressureTrendReasoningAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = TirePressureTrendReasoningStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? TirePressureTrendReasoningStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return TirePressureTrendReasoningResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
