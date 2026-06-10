//
//  AIDataRepairSuggestions.Projection.swift
//  TeslaSync — P4 shared surface · 0015 · AIDataRepairSuggestions (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / "Draft repair plan" button, the `canStart = stream.state !== 'streaming'`
//  rule, and the `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in
//  isolation (no store, no SwiftUI). Localization is applied here (P1/S10) so the view is a pure
//  function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIDataRepairSuggestions` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart = state != streaming` rule, the
/// Ask-Helix label flip, and every `AiOutputPanel` branch.
public enum DataRepairSuggestionsProjection {
    public static func resolve(
        _ input: DataRepairSuggestionsInput,
        locale: Locale = .current
    ) -> DataRepairSuggestionsResolved {
        switch input.availability {
        case .loading:
            return DataRepairSuggestionsResolved(phase: .loading)
        case let .failed(message):
            return DataRepairSuggestionsResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return DataRepairSuggestionsResolved(phase: .gated) }
            return DataRepairSuggestionsResolved(
                phase: .ready,
                ready: ready(for: input, locale: locale)
            )
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: DataRepairSuggestionsInput, locale _: Locale) -> DataRepairReady {
        // Web `canStart={stream.state !== 'streaming'}` — the double-submit guard, NOT a vehicle
        // gate. The control is live in every non-streaming state (idle / done / error).
        let canStart = input.stream.state != .streaming
        let action = DataRepairAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = DataRepairSuggestionsStrings.string(
            "dataRepair.aiSuggestions.button",
            "Draft repair plan"
        )
        let askHelix = DataRepairSuggestionsStrings.string("helix.askHelix", "Ask Helix")
        let thinking = DataRepairSuggestionsStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return DataRepairReady(
            title: DataRepairSuggestionsStrings.string(
                "dataRepair.aiSuggestions.title",
                "Helix repair suggestions"
            ),
            description: DataRepairSuggestionsStrings.string(
                "dataRepair.aiSuggestions.description",
                "Propose a typed repair plan (close, discard, or partial-update) for one stale "
                    + "charging session or drive from the inventory below. The LLM never writes — "
                    + "review the proposal here and click the canonical Save / Close / Discard "
                    + "button on the matching baseline form to apply it."
            ),
            badge: DataRepairSuggestionsStrings.string("dataRepair.aiSuggestions.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: DataRepairAccessibility.actionLabel(ask: askHelix, context: buttonContext),
            canStart: canStart,
            action: action,
            output: output(for: input.stream)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `DataRepairOutputKind` into the view-ready output. The friendly
    /// empty hint keeps the P4 "never a blank box" rule when the stream is idle (web `AiOutputPanel`
    /// renders nothing). There is no no-vehicle branch here — this surface has no vehicle gate.
    private static func output(for snapshot: DataRepairStreamSnapshot) -> DataRepairResolvedOutput {
        let title = DataRepairSuggestionsStrings.string(
            "dataRepair.aiSuggestions.output.a11yTitle",
            "Helix repair suggestions"
        )
        switch DataRepairOutput.derive(snapshot) {
        case .empty:
            let hint = DataRepairSuggestionsStrings.string(
                "dataRepair.aiSuggestions.output.emptyHint",
                "No repair plan yet — ask Helix to draft one."
            )
            return DataRepairResolvedOutput(kind: .empty, body: hint, accessibilityLabel: hint)
        case .thinking:
            let label = DataRepairSuggestionsStrings.string("helix.thinking", "Helix is thinking…")
            return DataRepairResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return DataRepairResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: DataRepairAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = DataRepairSuggestionsStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? DataRepairSuggestionsStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return DataRepairResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
