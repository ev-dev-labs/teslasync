//
//  AIPreheatPrecoolRecommender.Projection.swift
//  TeslaSync — P4 shared surface · 0040 · AIPreheatPrecoolRecommender (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Ask-Helix button, the `canStart = haveVehicle && haveDepart && haveCabin &&
//  haveOutside` rule, and the `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable
//  in isolation (no store, no SwiftUI). Localization is applied here (P1/S10) so the view is a pure
//  function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIPreheatPrecoolRecommender` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip, and
/// every `AiOutputPanel` branch.
public enum PreheatPrecoolProjection {
    public static func resolve(
        _ input: PreheatPrecoolInput,
        locale: Locale = .current
    ) -> PreheatPrecoolResolved {
        switch input.availability {
        case .loading:
            return PreheatPrecoolResolved(phase: .loading)
        case let .failed(message):
            return PreheatPrecoolResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return PreheatPrecoolResolved(phase: .gated) }
            return PreheatPrecoolResolved(
                phase: .ready,
                ready: ready(for: input, locale: locale)
            )
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: PreheatPrecoolInput, locale _: Locale) -> PreheatPrecoolReady {
        // Web `haveInputs = haveVehicle && haveDepart && haveCabin && haveOutside` — the resolved
        // request owns that five-part gate (the target defaults to 21 °C and is not part of it).
        let canStart = input.request.canStart
        let action = PreheatPrecoolAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = PreheatPrecoolStrings.string(
            "climate.aiPreheatPrecool.generateButton",
            "Draft schedule"
        )
        let askHelix = PreheatPrecoolStrings.string("helix.askHelix", "Ask Helix")
        let thinking = PreheatPrecoolStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return PreheatPrecoolReady(
            title: PreheatPrecoolStrings.string(
                "climate.aiPreheatPrecool.title",
                "Suggest a preheat or precool schedule"
            ),
            description: PreheatPrecoolStrings.string(
                "climate.aiPreheatPrecool.description",
                "Ask Helix to draft a preheat or precool window grounded in the deterministic "
                    + "departure heuristic \u{2014} start time, end time, mode (preheat | precool), "
                    + "and target cabin temperature. The temperatures are the same the panels below "
                    + "show; Helix never persists a schedule. Review the proposal and click Apply on "
                    + "the climate controls below to save it."
            ),
            badge: PreheatPrecoolStrings.string("climate.aiPreheatPrecool.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: PreheatPrecoolAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `PreheatPrecoolOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the missing-inputs case (web button disabled) from the
    /// started-but-idle case, keeping the P4 "never a blank box" rule while preserving the web
    /// `canStart` semantics.
    private static func output(
        for snapshot: PreheatPrecoolStreamSnapshot,
        canStart: Bool
    ) -> PreheatPrecoolResolvedOutput {
        let title = PreheatPrecoolStrings.string(
            "climate.aiPreheatPrecool.output.a11yTitle",
            "Preheat / precool schedule proposal"
        )
        switch PreheatPrecoolOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? PreheatPrecoolStrings.string(
                    "climate.aiPreheatPrecool.output.emptyHint",
                    "No schedule drafted yet \u{2014} ask Helix to draft a preheat or precool window."
                )
                : PreheatPrecoolStrings.string(
                    "climate.aiPreheatPrecool.output.noInputsHint",
                    "Add a vehicle, departure time, and cabin and outside temperatures to draft a schedule."
                )
            return PreheatPrecoolResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = PreheatPrecoolStrings.string("helix.thinking", "Helix is thinking…")
            return PreheatPrecoolResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return PreheatPrecoolResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: PreheatPrecoolAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = PreheatPrecoolStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? PreheatPrecoolStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return PreheatPrecoolResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
