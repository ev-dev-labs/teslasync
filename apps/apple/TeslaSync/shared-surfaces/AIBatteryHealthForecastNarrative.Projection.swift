//
//  AIBatteryHealthForecastNarrative.Projection.swift
//  TeslaSync — P4 shared surface · 0008 · AIBatteryHealthForecastNarrative (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Ask-Helix button, the `canStart = numericVehicleId > 0` rule, and the
//  `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation (no store,
//  no SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIBatteryHealthForecastNarrative` render plus the `withAiFeature` gate and the P4 leaf contract.
/// Unit tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label
/// flip, and every `AiOutputPanel` branch.
public enum BatteryNarrativeProjection {
    public static func resolve(
        _ input: BatteryNarrativeInput,
        locale: Locale = .current
    ) -> BatteryNarrativeResolved {
        switch input.availability {
        case .loading:
            return BatteryNarrativeResolved(phase: .loading)
        case let .failed(message):
            return BatteryNarrativeResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return BatteryNarrativeResolved(phase: .gated) }
            return BatteryNarrativeResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: BatteryNarrativeInput, locale _: Locale) -> BatteryNarrativeReady {
        // Web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`: the narrator
        // needs a positive vehicle id (mirrors the handler-side `vehicle_id > 0` parser), so id 0 /
        // nil keep the button disabled — a stricter gate than 0005's `vehicleId != null`.
        let canStart = (input.vehicleID ?? 0) > 0
        let action = BatteryNarrativeAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = BatteryNarrativeStrings.string(
            "battery.aiNarrative.generateButton",
            "Narrate forecast"
        )
        let askHelix = BatteryNarrativeStrings.string("helix.askHelix", "Ask Helix")
        let thinking = BatteryNarrativeStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return BatteryNarrativeReady(
            title: BatteryNarrativeStrings.string(
                "battery.aiNarrative.title",
                "Explain the battery health forecast"
            ),
            description: BatteryNarrativeStrings.string(
                "battery.aiNarrative.description",
                "Ask Helix to explain which charging habits and risk factors drive your "
                    + "deterministic battery-health forecast. The narrator never changes the "
                    + "forecast — it grounds every sentence in the same numbers the chart below "
                    + "renders."
            ),
            badge: BatteryNarrativeStrings.string("battery.aiNarrative.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: BatteryNarrativeAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `BatteryNarrativeOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the no-vehicle case (web button disabled) from the started-but-idle
    /// case, keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: BatteryNarrativeStreamSnapshot,
        canStart: Bool
    ) -> BatteryNarrativeResolvedOutput {
        let title = BatteryNarrativeStrings.string("battery.output.a11yTitle", "Battery health narrative")
        switch BatteryNarrativeOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? BatteryNarrativeStrings.string(
                    "battery.output.emptyHint",
                    "No narrative yet — ask Helix to narrate your forecast."
                )
                : BatteryNarrativeStrings.string(
                    "battery.output.noVehicleHint",
                    "Select a vehicle to ask Helix to narrate the forecast."
                )
            return BatteryNarrativeResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = BatteryNarrativeStrings.string("helix.thinking", "Helix is thinking…")
            return BatteryNarrativeResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return BatteryNarrativeResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: BatteryNarrativeAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = BatteryNarrativeStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? BatteryNarrativeStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return BatteryNarrativeResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
