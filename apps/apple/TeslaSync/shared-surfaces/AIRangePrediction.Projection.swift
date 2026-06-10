//
//  AIRangePrediction.Projection.swift
//  TeslaSync — P4 shared surface · 0043 · AIRangePrediction (Apple)
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
/// `AIRangePrediction` render plus the `withAiFeature` gate and the P4 leaf contract. Unit tested
/// across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip, and every
/// `AiOutputPanel` branch.
public enum RangePredictionProjection {
    public static func resolve(
        _ input: RangePredictionInput,
        locale: Locale = .current
    ) -> RangePredictionResolved {
        switch input.availability {
        case .loading:
            return RangePredictionResolved(phase: .loading)
        case let .failed(message):
            return RangePredictionResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return RangePredictionResolved(phase: .gated) }
            return RangePredictionResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: RangePredictionInput, locale _: Locale) -> RangePredictionReady {
        // Web `canStart={vehicleId != null}`: a non-null vehicle id passes (even 0), nil keeps the
        // button disabled. The id is carried in the request BODY (`vehicle_id: vehicleId ?? 0`), so
        // unlike a path-bearing surface the gate is purely "is a vehicle selected".
        let canStart = input.vehicleID != nil
        let action = RangePredictionAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = RangePredictionStrings.string(
            "range.aiPredict.generateButton",
            "Train range model"
        )
        let askHelix = RangePredictionStrings.string("helix.askHelix", "Ask Helix")
        let thinking = RangePredictionStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return RangePredictionReady(
            title: RangePredictionStrings.string(
                "range.aiPredict.title",
                "Learn per-vehicle range model"
            ),
            description: RangePredictionStrings.string(
                "range.aiPredict.description",
                "Compute per-bucket (temperature × speed) learned Wh/km from this vehicle’s "
                    + "recent drives and walk through how each bucket compares to the static "
                    + "heuristic curve the projection uses today."
            ),
            badge: RangePredictionStrings.string("range.aiPredict.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: RangePredictionAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `RangePredictionOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the no-vehicle case (web button disabled) from the started-but-idle
    /// case, keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: RangePredictionStreamSnapshot,
        canStart: Bool
    ) -> RangePredictionResolvedOutput {
        let title = RangePredictionStrings.string("range.aiPredict.output.a11yTitle", "Range model narrative")
        switch RangePredictionOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? RangePredictionStrings.string(
                    "range.aiPredict.output.emptyHint",
                    "No range model yet — ask Helix to learn this vehicle’s range envelope."
                )
                : RangePredictionStrings.string(
                    "range.aiPredict.output.noVehicleHint",
                    "Select a vehicle to learn its per-vehicle range model."
                )
            return RangePredictionResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = RangePredictionStrings.string("helix.thinking", "Helix is thinking…")
            return RangePredictionResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return RangePredictionResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: RangePredictionAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = RangePredictionStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? RangePredictionStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return RangePredictionResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
