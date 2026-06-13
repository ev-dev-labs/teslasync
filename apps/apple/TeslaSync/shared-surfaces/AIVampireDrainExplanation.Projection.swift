//
//  AIVampireDrainExplanation.Projection.swift
//  TeslaSync — P4 shared surface · 0057 · AIVampireDrainExplanation (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Narrate button, the `canStart = isFinite(vehicleId) && vehicleId > 0`
//  rule, and the `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation
//  (no store, no SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of
//  the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIVampireDrainExplanation` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart` rule, the Narrate label flip, and
/// every `AiOutputPanel` branch.
public enum VampireDrainExplainProjection {
    public static func resolve(
        _ input: VampireDrainExplainInput,
        locale: Locale = .current
    ) -> VampireDrainExplainResolved {
        switch input.availability {
        case .loading:
            return VampireDrainExplainResolved(phase: .loading)
        case let .failed(message):
            return VampireDrainExplainResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return VampireDrainExplainResolved(phase: .gated) }
            return VampireDrainExplainResolved(
                phase: .ready,
                ready: ready(for: input, locale: locale)
            )
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: VampireDrainExplainInput, locale _: Locale) -> VampireDrainExplainReady {
        // Web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`.
        let canStart = VampireDrainExplainVehicleID.canStart(input.vehicleID)
        let action = VampireDrainExplainAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = VampireDrainExplainStrings.string(
            "vampireDrain.aiNarrative.generateButton",
            "Narrate drain"
        )
        let askHelix = VampireDrainExplainStrings.string("helix.askHelix", "Ask Helix")
        let thinking = VampireDrainExplainStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return VampireDrainExplainReady(
            title: VampireDrainExplainStrings.string(
                "vampireDrain.aiNarrative.title",
                "Explain the recent vampire drain"
            ),
            description: VampireDrainExplainStrings.string(
                "vampireDrain.aiNarrative.description",
                "Ask Helix to explain the deterministic vampire-drain signal \u{2014} the recent "
                    + "average / worst idle-drain rate, the most-correlated per-event driver "
                    + "(Sentry, climate, long park), and whether the recent rate is in line with the "
                    + "typical fleet. The numbers are the same the cards below show; the narrator only "
                    + "explains them and surfaces the inference\u{2019}s correlational nature honestly."
            ),
            badge: VampireDrainExplainStrings.string("vampireDrain.aiNarrative.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: VampireDrainExplainAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `VampireDrainExplainOutputKind` into the view-ready output. The
    /// friendly empty hint distinguishes the no-vehicle case (web button disabled) from the
    /// started-but-idle case, keeping the P4 "never a blank box" rule while preserving the web
    /// `canStart` semantics.
    private static func output(
        for snapshot: VampireDrainExplainStreamSnapshot,
        canStart: Bool
    ) -> VampireDrainExplainResolvedOutput {
        let title = VampireDrainExplainStrings.string(
            "vampireDrain.output.a11yTitle",
            "Vampire-drain explanation"
        )
        switch VampireDrainExplainOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? VampireDrainExplainStrings.string(
                    "vampireDrain.output.emptyHint",
                    "No narration yet \u{2014} ask Helix to explain the vampire drain."
                )
                : VampireDrainExplainStrings.string(
                    "vampireDrain.output.noVehicleHint",
                    "Select a vehicle to ask Helix to explain the vampire drain."
                )
            return VampireDrainExplainResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = VampireDrainExplainStrings.string("helix.thinking", "Helix is thinking…")
            return VampireDrainExplainResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return VampireDrainExplainResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: VampireDrainExplainAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = VampireDrainExplainStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? VampireDrainExplainStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return VampireDrainExplainResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
