//
//  AICostForecastNarration.Projection.swift
//  TeslaSync — P4 shared surface · 0013 · AICostForecastNarration (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard` header /
//  description / Ask-Helix button, the `canStart = numericVehicleId > 0` rule, and the
//  `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation (no store,
//  no SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AICostForecastNarration` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip, and
/// every `AiOutputPanel` branch.
public enum CostNarrationProjection {
    public static func resolve(
        _ input: CostNarrationInput,
        locale: Locale = .current
    ) -> CostNarrationResolved {
        switch input.availability {
        case .loading:
            return CostNarrationResolved(phase: .loading)
        case let .failed(message):
            return CostNarrationResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return CostNarrationResolved(phase: .gated) }
            return CostNarrationResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: CostNarrationInput, locale _: Locale) -> CostNarrationReady {
        // Web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`: the narrator
        // needs a positive vehicle id (mirrors the handler-side `vehicle_id > 0` parser), so id 0 /
        // nil keep the button disabled. The optional `months` horizon never gates the button — the
        // backend defaults it when the body omits it.
        let canStart = (input.vehicleID ?? 0) > 0
        let action = CostNarrationAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = CostNarrationStrings.string(
            "costAnalysis.aiNarrative.generateButton",
            "Narrate forecast"
        )
        let askHelix = CostNarrationStrings.string("helix.askHelix", "Ask Helix")
        let thinking = CostNarrationStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return CostNarrationReady(
            title: CostNarrationStrings.string(
                "costAnalysis.aiNarrative.title",
                "Narrate the charging-cost forecast"
            ),
            description: CostNarrationStrings.string(
                "costAnalysis.aiNarrative.description",
                "Ask Helix to explain the deterministic charging-cost forecast — the historical "
                    + "trend, the projected cost / cost_low / cost_high band, the home-vs-supercharger "
                    + "split, and the deterministic insight. The dollar amounts are the same the chart "
                    + "below shows; the narrator only explains them and is honest that the band is an "
                    + "APPROXIMATE prediction interval, not a strict 95% confidence interval."
            ),
            badge: CostNarrationStrings.string("costAnalysis.aiNarrative.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: CostNarrationAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `CostNarrationOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the no-vehicle case (web button disabled) from the started-but-idle
    /// case, keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: CostNarrationStreamSnapshot,
        canStart: Bool
    ) -> CostNarrationResolvedOutput {
        let title = CostNarrationStrings.string("costAnalysis.output.a11yTitle", "Charging-cost narrative")
        switch CostNarrationOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? CostNarrationStrings.string(
                    "costAnalysis.output.emptyHint",
                    "No narrative yet — ask Helix to narrate your forecast."
                )
                : CostNarrationStrings.string(
                    "costAnalysis.output.noVehicleHint",
                    "Select a vehicle to ask Helix to narrate the forecast."
                )
            return CostNarrationResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = CostNarrationStrings.string("helix.thinking", "Helix is thinking…")
            return CostNarrationResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return CostNarrationResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: CostNarrationAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = CostNarrationStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? CostNarrationStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return CostNarrationResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
