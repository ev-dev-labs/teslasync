//
//  AIMqttSseInspectorExplanations.Projection.swift
//  TeslaSync — P4 shared surface · 0028 · AIMqttSseInspectorExplanations (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard` header /
//  description / Explain-streams button, the `canStart = haveWindow` rule, the `emptyHint` shown when
//  the window is missing, and the `AiOutputPanel` branches) plus the P4 leaf contract stay unit
//  testable in isolation (no store, no SwiftUI). Localization is applied here (P1/S10) so the view is
//  a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIMqttSseInspectorExplanations` render plus the `withAiFeature` gate and the P4 leaf contract.
/// Unit tested across gated / loading / error / ready, the `canStart = haveWindow` rule, the header
/// `emptyHint`, the Ask-Helix label flip, and every `AiOutputPanel` branch.
public enum MqttSseExplainerProjection {
    public static func resolve(
        _ input: MqttSseExplainerInput,
        locale: Locale = .current
    ) -> MqttSseExplainerResolved {
        switch input.availability {
        case .loading:
            return MqttSseExplainerResolved(phase: .loading)
        case let .failed(message):
            return MqttSseExplainerResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return MqttSseExplainerResolved(phase: .gated) }
            return MqttSseExplainerResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: MqttSseExplainerInput,
        locale _: Locale
    ) -> MqttSseExplainerReady {
        // Web `haveWindow = Number.isFinite(fromUnix) && fromUnix > 0 && Number.isFinite(toUnix) &&
        // toUnix > fromUnix`: the explainer needs a positive start with an end after it (mirrors the
        // handler-side `from_unix` / `to_unix` window parser), so nil / non-positive / inverted
        // windows keep the button disabled and ship the `{0,0}` sentinel body. The gate lives in
        // the request type so the body shape + canStart stay in lockstep (tested in the adapter).
        let canStart = MqttSseExplainRequest(fromUnix: input.fromUnix, toUnix: input.toUnix).haveWindow
        let action = MqttSseExplainerAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = MqttSseExplainerStrings.string(
            "mqttSseInspector.aiExplainer.button",
            "Explain streams"
        )
        let askHelix = MqttSseExplainerStrings.string("helix.askHelix", "Ask Helix")
        let thinking = MqttSseExplainerStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        // Web `emptyHint={haveWindow ? undefined : t('…emptyHint', 'A valid time window is
        // required.')}`, rendered by AIFeatureCard only when `!canStart`. Reproduced as the
        // header-region hint beneath the description.
        let windowHint = canStart
            ? nil
            : MqttSseExplainerStrings.string(
                "mqttSseInspector.aiExplainer.emptyHint",
                "A valid time window is required."
            )

        return MqttSseExplainerReady(
            title: MqttSseExplainerStrings.string(
                "mqttSseInspector.aiExplainer.title",
                "Helix stream explainer"
            ),
            description: MqttSseExplainerStrings.string(
                "mqttSseInspector.aiExplainer.description",
                "Get a 3-6 sentence factual explanation of the current MQTT broker, SSE hub, and "
                    + "background-job state. The explainer reads only the deterministic broker-status "
                    + "envelope (broker connectivity, per-vehicle stream stats, SSE client counts, job "
                    + "freshness) \u{2014} broker hostnames, ports, SSE client identifiers, and VINs "
                    + "are redacted before the message reaches the provider. The explanation is "
                    + "informational; the broker-status snapshot above remains the canonical raw view."
            ),
            badge: MqttSseExplainerStrings.string("mqttSseInspector.aiExplainer.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: MqttSseExplainerAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            windowHint: windowHint,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `MqttSseExplainerOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the no-window case (web button disabled) from the started-but-idle
    /// case, keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: MqttSseExplainerStreamSnapshot,
        canStart: Bool
    ) -> MqttSseExplainerResolvedOutput {
        let title = MqttSseExplainerStrings.string(
            "mqttSseInspector.aiExplainer.output.a11yTitle",
            "MQTT / SSE stream explanation"
        )
        switch MqttSseExplainerOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? MqttSseExplainerStrings.string(
                    "mqttSseInspector.aiExplainer.output.emptyHint",
                    "No explanation yet \u{2014} ask Helix to explain the current streams."
                )
                : MqttSseExplainerStrings.string(
                    "mqttSseInspector.aiExplainer.output.noWindowHint",
                    "Set a valid time window to ask Helix to explain the streams."
                )
            return MqttSseExplainerResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = MqttSseExplainerStrings.string("helix.thinking", "Helix is thinking…")
            return MqttSseExplainerResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return MqttSseExplainerResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: MqttSseExplainerAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = MqttSseExplainerStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? MqttSseExplainerStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return MqttSseExplainerResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
