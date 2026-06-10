//
//  AIRouteEfficiencySuggestions.Projection.swift
//  TeslaSync — P4 shared surface · 0044 · AIRouteEfficiencySuggestions (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Ask-Helix button, the `canStart = !!vehicleId` rule, and the
//  `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation (no store, no
//  SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIRouteEfficiencySuggestions` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip, and
/// every `AiOutputPanel` branch.
public enum RouteEfficiencySuggestionsProjection {
    public static func resolve(
        _ input: RouteEfficiencySuggestionsInput,
        locale: Locale = .current
    ) -> RouteEfficiencySuggestionsResolved {
        switch input.availability {
        case .loading:
            return RouteEfficiencySuggestionsResolved(phase: .loading)
        case let .failed(message):
            return RouteEfficiencySuggestionsResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return RouteEfficiencySuggestionsResolved(phase: .gated) }
            return RouteEfficiencySuggestionsResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: RouteEfficiencySuggestionsInput,
        locale _: Locale
    ) -> RouteEfficiencySuggestionsReady {
        // Web `canStart={!!vehicleId}`: the suggest call needs a non-empty vehicleId in the {routeID}
        // path slot, so nil / "" keep the button disabled. The id is an opaque string carried by the
        // URL — any non-empty value passes.
        let canStart = (input.vehicleID?.isEmpty == false)
        let action = RouteEfficiencySuggestionsAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = RouteEfficiencySuggestionsStrings.string(
            "routeEfficiency.aiSuggestions.generateButton",
            "Generate suggestions"
        )
        let askHelix = RouteEfficiencySuggestionsStrings.string("helix.askHelix", "Ask Helix")
        let thinking = RouteEfficiencySuggestionsStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return RouteEfficiencySuggestionsReady(
            title: RouteEfficiencySuggestionsStrings.string(
                "routeEfficiency.aiSuggestions.title",
                "Route-efficiency suggestions"
            ),
            description: RouteEfficiencySuggestionsStrings.string(
                "routeEfficiency.aiSuggestions.description",
                "Get a short plain-language suggestion for lower-consumption habits and route choices "
                    + "grounded in your own historical route data — the dominant route, its kWh/100mi "
                    + "figure, a comparison across your other routes, and one or two concrete, "
                    + "non-mutating ideas you can try yourself."
            ),
            badge: RouteEfficiencySuggestionsStrings.string("routeEfficiency.aiSuggestions.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: RouteEfficiencySuggestionsAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural output kind into the view-ready output. The friendly empty hint
    /// distinguishes the no-vehicle case (web button disabled) from the started-but-idle case,
    /// keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: RouteEfficiencySuggestionsStreamSnapshot,
        canStart: Bool
    ) -> RouteEfficiencySuggestionsResolvedOutput {
        let title = RouteEfficiencySuggestionsStrings.string(
            "routeEfficiency.aiSuggestions.output.a11yTitle",
            "Route-efficiency suggestions"
        )
        switch RouteEfficiencySuggestionsOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? RouteEfficiencySuggestionsStrings.string(
                    "routeEfficiency.aiSuggestions.output.emptyHint",
                    "No suggestions yet — ask Helix for route-efficiency ideas."
                )
                : RouteEfficiencySuggestionsStrings.string(
                    "routeEfficiency.aiSuggestions.output.noVehicleHint",
                    "Select a vehicle to ask Helix for route-efficiency suggestions."
                )
            return RouteEfficiencySuggestionsResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = RouteEfficiencySuggestionsStrings.string("helix.thinking", "Helix is thinking…")
            return RouteEfficiencySuggestionsResolvedOutput(
                kind: .thinking,
                body: label,
                accessibilityLabel: label
            )
        case let .prose(text):
            return RouteEfficiencySuggestionsResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: RouteEfficiencySuggestionsAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = RouteEfficiencySuggestionsStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? RouteEfficiencySuggestionsStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return RouteEfficiencySuggestionsResolvedOutput(
                kind: .failed,
                body: body,
                accessibilityLabel: body
            )
        }
    }
}
