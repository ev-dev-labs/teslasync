//
//  AIStateMachineDebuggerNarrator.Projection.swift
//  TeslaSync — P4 shared surface · 0050 · AIStateMachineDebuggerNarrator (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard` header /
//  description / Narrate-transitions button, the `canStart = haveScope` rule, the `emptyHint` shown
//  when the scope is missing, and the `AiOutputPanel` branches) plus the P4 leaf contract stay unit
//  testable in isolation (no store, no SwiftUI). Localization is applied here (P1/S10) so the view is
//  a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIStateMachineDebuggerNarrator` render plus the `withAiFeature` gate and the P4 leaf contract.
/// Unit tested across gated / loading / error / ready, the `canStart = haveScope` rule, the header
/// `emptyHint`, the Ask-Helix label flip, and every `AiOutputPanel` branch.
public enum FSMNarratorProjection {
    public static func resolve(
        _ input: FSMNarratorInput,
        locale: Locale = .current
    ) -> FSMNarratorResolved {
        switch input.availability {
        case .loading:
            return FSMNarratorResolved(phase: .loading)
        case let .failed(message):
            return FSMNarratorResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return FSMNarratorResolved(phase: .gated) }
            return FSMNarratorResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: FSMNarratorInput,
        locale _: Locale
    ) -> FSMNarratorReady {
        // Web `haveScope = Number.isFinite(vehicleId) && vehicleId > 0 && Number.isFinite(fromUnix) &&
        // fromUnix > 0 && Number.isFinite(toUnix) && toUnix > fromUnix`: the narrator needs a positive
        // vehicle AND a positive ordered window (the parent derives these from the page's active
        // vehicle selector + start/end instants), so nil / non-positive / inverted scopes keep the
        // button disabled and ship the `{0,0,0}` sentinel body. The gate lives in the request type so
        // the body shape + canStart stay in lockstep (tested in the adapter).
        let canStart = FSMNarratorRequest(
            vehicleID: input.vehicleID,
            fromUnix: input.fromUnix,
            toUnix: input.toUnix
        ).haveScope
        let action = FSMNarratorAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = FSMNarratorStrings.string(
            "stateMachineDebugger.aiNarrator.button",
            "Narrate transitions"
        )
        let askHelix = FSMNarratorStrings.string("helix.askHelix", "Ask Helix")
        let thinking = FSMNarratorStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        // Web `emptyHint={haveScope ? undefined : t('…emptyHint', 'Select a vehicle and a valid time
        // window first.')}`, rendered by AIFeatureCard only when `!canStart`. Reproduced as the
        // header-region hint beneath the description.
        let scopeHint = canStart
            ? nil
            : FSMNarratorStrings.string(
                "stateMachineDebugger.aiNarrator.emptyHint",
                "Select a vehicle and a valid time window first."
            )

        return FSMNarratorReady(
            title: FSMNarratorStrings.string(
                "stateMachineDebugger.aiNarrator.title",
                "Helix FSM narrator"
            ),
            description: FSMNarratorStrings.string(
                "stateMachineDebugger.aiNarrator.description",
                "Get a 3-6 sentence factual narration of the current vehicle FSM transition trace. "
                    + "The narrator reads only the deterministic FSM envelope (vehicle id, window "
                    + "bounds, per-FSM-name counts, per-edge counts, flap count, transition stream) "
                    + "\u{2014} VINs, coordinates, place names, IPs, and personal identifiers are "
                    + "redacted before the message reaches the provider. The narration is "
                    + "informational; the transition table, state diagram, and FSM health panel above "
                    + "remain the canonical raw view."
            ),
            badge: FSMNarratorStrings.string("stateMachineDebugger.aiNarrator.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: FSMNarratorAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            scopeHint: scopeHint,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `FSMNarratorOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the no-scope case (web button disabled) from the started-but-idle
    /// case, keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: FSMNarratorStreamSnapshot,
        canStart: Bool
    ) -> FSMNarratorResolvedOutput {
        let title = FSMNarratorStrings.string(
            "stateMachineDebugger.aiNarrator.output.a11yTitle",
            "FSM transition narration"
        )
        switch FSMNarratorOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? FSMNarratorStrings.string(
                    "stateMachineDebugger.aiNarrator.output.emptyHint",
                    "No narration yet \u{2014} ask Helix to narrate the current FSM transitions."
                )
                : FSMNarratorStrings.string(
                    "stateMachineDebugger.aiNarrator.output.noScopeHint",
                    "Select a vehicle and a valid time window to narrate the FSM transitions."
                )
            return FSMNarratorResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = FSMNarratorStrings.string("helix.thinking", "Helix is thinking…")
            return FSMNarratorResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return FSMNarratorResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: FSMNarratorAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = FSMNarratorStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? FSMNarratorStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return FSMNarratorResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
