//
//  AITCONarration.Projection.swift
//  TeslaSync — P4 shared surface · 0052 · AITCONarration (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard` header /
//  description / empty hint / Ask-Helix button, the `canStart = numericVehicleId > 0` rule, and the
//  `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation (no store,
//  no SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AITCONarration` render plus the `withAiFeature` gate and the P4 leaf contract. Unit tested across
/// gated / loading / error / ready, the `canStart` rule, the web `emptyHint` element, the Ask-Helix
/// label flip, and every `AiOutputPanel` branch.
public enum TCONarrationProjection {
    public static func resolve(
        _ input: TCONarrationInput,
        locale: Locale = .current
    ) -> TCONarrationResolved {
        switch input.availability {
        case .loading:
            return TCONarrationResolved(phase: .loading)
        case let .failed(message):
            return TCONarrationResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return TCONarrationResolved(phase: .gated) }
            return TCONarrationResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: TCONarrationInput, locale _: Locale) -> TCONarrationReady {
        // Web `haveInputs = typeof vehicleId === 'number' && Number.isFinite(vehicleId) &&
        // vehicleId > 0`: the narrator needs a positive vehicle id (mirrors the handler-side
        // `vehicle_id > 0` parser), so id 0 / nil keep the button disabled and surface the empty hint.
        let canStart = (input.vehicleID ?? 0) > 0
        let action = TCONarrationAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = TCONarrationStrings.string(
            "tco.aiNarration.button",
            "Explain ownership cost"
        )
        let askHelix = TCONarrationStrings.string("helix.askHelix", "Ask Helix")
        let thinking = TCONarrationStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        // Web `emptyHint = haveInputs ? undefined : t('tco.aiNarration.noVehicleHint', …)`, rendered
        // by AIFeatureCard as `{!canStart && emptyHint && <p>…</p>}` beneath the description.
        let emptyHint = canStart
            ? nil
            : TCONarrationStrings.string(
                "tco.aiNarration.noVehicleHint",
                "Pick a vehicle above to enable Helix."
            )

        return TCONarrationReady(
            title: TCONarrationStrings.string(
                "tco.aiNarration.title",
                "Explain my total cost of ownership"
            ),
            description: descriptionText(),
            badge: TCONarrationStrings.string("tco.aiNarration.badge", "Helix"),
            emptyHint: emptyHint,
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: TCONarrationAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    /// The long-form description — the verbatim web `tco.aiNarration.description` copy (the privacy
    /// contract + the four limiting assumptions inherited from the deterministic helper).
    private static func descriptionText() -> String {
        TCONarrationStrings.string(
            "tco.aiNarration.description",
            "Ask Helix to walk through the deterministic operating-cost figures shown below — the EV "
                + "charging spend, the equivalent gas cost, the cumulative savings, and the "
                + "cost-per-kilometre comparison. The narrator quotes the same numbers the chart shows "
                + "and is honest about the four limiting assumptions: operating cost only (no "
                + "depreciation, resale, insurance, registration, or financing); a flat $50/month "
                + "maintenance heuristic; equivalent gas cost estimated from charged energy not "
                + "real-world distance; and gas-price / efficiency / electricity-rate defaults from "
                + "your editable Settings."
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `TCONarrationOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the no-vehicle case (web button disabled) from the started-but-idle
    /// case, keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: TCONarrationStreamSnapshot,
        canStart: Bool
    ) -> TCONarrationResolvedOutput {
        let title = TCONarrationStrings.string(
            "tco.output.a11yTitle",
            "Total-cost-of-ownership narrative"
        )
        switch TCONarrationOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? TCONarrationStrings.string(
                    "tco.output.emptyHint",
                    "No narrative yet — ask Helix to explain your ownership cost."
                )
                : TCONarrationStrings.string(
                    "tco.output.noVehicleHint",
                    "Select a vehicle to ask Helix to explain ownership cost."
                )
            return TCONarrationResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = TCONarrationStrings.string("helix.thinking", "Helix is thinking…")
            return TCONarrationResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return TCONarrationResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: TCONarrationAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = TCONarrationStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? TCONarrationStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return TCONarrationResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
