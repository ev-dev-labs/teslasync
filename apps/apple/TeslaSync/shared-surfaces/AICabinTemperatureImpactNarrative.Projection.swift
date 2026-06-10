//
//  AICabinTemperatureImpactNarrative.Projection.swift
//  TeslaSync — P4 shared surface · 0009 · AICabinTemperatureImpactNarrative (Apple)
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
/// `AICabinTemperatureImpactNarrative` render plus the `withAiFeature` gate and the P4 leaf contract.
/// Unit tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label
/// flip, and every `AiOutputPanel` branch.
public enum CabinTempNarrativeProjection {
    public static func resolve(
        _ input: CabinTempNarrativeInput,
        locale: Locale = .current
    ) -> CabinTempNarrativeResolved {
        switch input.availability {
        case .loading:
            return CabinTempNarrativeResolved(phase: .loading)
        case let .failed(message):
            return CabinTempNarrativeResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return CabinTempNarrativeResolved(phase: .gated) }
            return CabinTempNarrativeResolved(
                phase: .ready,
                ready: ready(for: input, locale: locale)
            )
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: CabinTempNarrativeInput, locale _: Locale) -> CabinTempNarrativeReady {
        // Web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`.
        let canStart = CabinTempNarrativeVehicleID.canStart(input.vehicleID)
        let action = CabinTempNarrativeAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = CabinTempNarrativeStrings.string(
            "tempImpact.aiNarrative.generateButton",
            "Narrate impact"
        )
        let askHelix = CabinTempNarrativeStrings.string("helix.askHelix", "Ask Helix")
        let thinking = CabinTempNarrativeStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return CabinTempNarrativeReady(
            title: CabinTempNarrativeStrings.string(
                "tempImpact.aiNarrative.title",
                "Narrate the cabin-temperature impact"
            ),
            description: CabinTempNarrativeStrings.string(
                "tempImpact.aiNarrative.description",
                "Ask Helix to explain how outside ambient temperature affects this vehicle\u{2019}s "
                    + "efficiency \u{2014} which temperature bucket runs most efficiently, how "
                    + "cold-weather months compare with mild-weather months, and what the seasonal "
                    + "pattern in the chart implies. The bucket and monthly numbers are the same the "
                    + "chart below shows; the narrator only explains them and is honest that these are "
                    + "descriptive aggregates of recent drives, not a forecast."
            ),
            badge: CabinTempNarrativeStrings.string("tempImpact.aiNarrative.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: CabinTempNarrativeAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `CabinTempNarrativeOutputKind` into the view-ready output. The
    /// friendly empty hint distinguishes the no-vehicle case (web button disabled) from the
    /// started-but-idle case, keeping the P4 "never a blank box" rule while preserving the web
    /// `canStart` semantics.
    private static func output(
        for snapshot: CabinTempNarrativeStreamSnapshot,
        canStart: Bool
    ) -> CabinTempNarrativeResolvedOutput {
        let title = CabinTempNarrativeStrings.string(
            "tempImpact.output.a11yTitle",
            "Cabin-temperature impact narration"
        )
        switch CabinTempNarrativeOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? CabinTempNarrativeStrings.string(
                    "tempImpact.output.emptyHint",
                    "No narration yet \u{2014} ask Helix to narrate the temperature impact."
                )
                : CabinTempNarrativeStrings.string(
                    "tempImpact.output.noVehicleHint",
                    "Select a vehicle to ask Helix to narrate the temperature impact."
                )
            return CabinTempNarrativeResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = CabinTempNarrativeStrings.string("helix.thinking", "Helix is thinking…")
            return CabinTempNarrativeResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return CabinTempNarrativeResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: CabinTempNarrativeAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = CabinTempNarrativeStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? CabinTempNarrativeStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return CabinTempNarrativeResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
