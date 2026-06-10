//
//  AINLAutomationBuilder.Adapter.swift
//  TeslaSync — P4 shared surface · 0030 · AINLAutomationBuilder (Apple)
//
//  The testable projection core for the "Draft from natural language" Helix panel — the
//  SwiftUI parity of components/ai/AINLAutomationBuilder.tsx. Everything here is pure +
//  dependency-free (Foundation only — no SwiftUI, no Observation, no network), so the
//  surface identity, the SSE event model, and the cached-inputs → view-projection map are
//  all unit tested in isolation (and in the SwiftPM harness) without rendering a view.
//
//  Parity note: the web source wires `useAiStream({ url:'/ai/automations/draft',
//  body:{vehicle_id, prompt}, onEvent: () => {} })`. The `onEvent` handler is a deliberate
//  no-op — unlike its sibling AIGeofenceAwareAutomationSuggestions, this builder captures NO
//  typed `tool_result` draft and renders NO proposal children; the streamed narrative flows
//  straight into the AiOutputPanel. So the projection here models only the two web `canStart`
//  predicates (`vehicleId != null`, `prompt.trim() ≠ ""`) plus the stream lifecycle + leaf
//  connectivity — there is no graph decode to defend against.
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`) and
/// the AI feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so the
/// state-holder can emit telemetry without depending on the view layer.
public enum NLAutomationBuilderSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AINLAutomationBuilder"
    /// The AI feature id (web `withAiFeature('nl-automation-builder', …)`).
    public static let featureID = "nl-automation-builder"
}

// MARK: - Stream event (web `AiStreamEvent` discriminated union)

/// The native port of the web `AiStreamEvent` union the SSE writer emits. The web source's
/// `onEvent` is a no-op, so the model only acts on `delta` (the output-panel text
/// accumulator); the remaining cases are carried for fidelity + future fan-out, with the
/// lifecycle transitions delivered separately through the source's stream-state callback
/// (mirroring how `useAiStream` flips `state` internally on `done`/`error`/`confirm`).
public enum NLAutomationBuilderStreamEvent: Equatable, Sendable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(id: String, name: String, ok: Bool)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String)
    case error(message: String)
}

// MARK: - Input snapshot (web `vehicleId` prop + gate/connectivity context)

/// One coalesced snapshot of the panel's non-stream, non-prompt inputs — the native mirror of
/// the web `vehicleId` prop plus the `useAiEnabled` gate and the parent surface connectivity.
/// The free-form `prompt` is local UI state (web `useState`) the user edits, so it lives on the
/// model, not here. `vehicleID` is optional to preserve the web `vehicleId?: number` /
/// `vehicleId != null` semantics exactly. Pure Foundation data, so it bundles the projection's
/// cached inputs (keeping the projection map under the parameter-count budget).
public struct NLAutomationBuilderInputSnapshot: Sendable, Equatable {
    public var gate: NLAutomationBuilderGate
    public var vehicleID: Int64?
    public var connection: NLAutomationBuilderConnection
    public var errorMessage: String?

    public init(
        gate: NLAutomationBuilderGate = .on,
        vehicleID: Int64? = nil,
        connection: NLAutomationBuilderConnection = .live,
        errorMessage: String? = nil
    ) {
        self.gate = gate
        self.vehicleID = vehicleID
        self.connection = connection
        self.errorMessage = errorMessage
    }
}

// MARK: - View projection (cached inputs → render decisions)

/// The pure projection of the panel's cached inputs (gate + vehicle + prompt + stream phase +
/// connectivity) into the render decisions the view switches on — the testable "adapter"
/// boundary (P4 acceptance: *adapter unit test (cached → projection)*). It holds no SwiftUI
/// and no I/O, so the mapping is asserted without a view or a network. `NLAutomationBuilderModel`
/// derives the very same flags through `NLAutomationBuilderLogic`, so the projection and the
/// live model can never diverge.
public struct NLAutomationBuilderProjection: Equatable, Sendable {
    /// The top-level render axis (gate + gate-error).
    public let renderState: NLAutomationBuilderRenderState
    /// Web `canStart = vehicleId != null && prompt.trim().length > 0`.
    public let canStart: Bool
    /// Web `buttonDisabled = !canStart || isStreaming` (+ offline leaf contract).
    public let buttonDisabled: Bool
    /// Web `stream.state === 'streaming'` — flips the CTA to "Helix is thinking…".
    public let isStreaming: Bool
    /// Web `AiOutputPanel` visibility (text, or a streaming/done/error lifecycle).
    public let outputVisible: Bool
    /// Web `AiOutputPanel` animated thinking branch (streaming, no text yet).
    public let thinkingVisible: Bool
    /// The contextual disabled-reason hint (P4 friendly empty state), or `nil` when ready.
    public let emptyHint: NLAutomationBuilderHint?
    /// The orthogonal connectivity axis (P4 leaf freshness chip + banner).
    public let connection: NLAutomationBuilderConnection

    public init(
        renderState: NLAutomationBuilderRenderState,
        canStart: Bool,
        buttonDisabled: Bool,
        isStreaming: Bool,
        outputVisible: Bool,
        thinkingVisible: Bool,
        emptyHint: NLAutomationBuilderHint?,
        connection: NLAutomationBuilderConnection
    ) {
        self.renderState = renderState
        self.canStart = canStart
        self.buttonDisabled = buttonDisabled
        self.isStreaming = isStreaming
        self.outputVisible = outputVisible
        self.thinkingVisible = thinkingVisible
        self.emptyHint = emptyHint
        self.connection = connection
    }

    /// Projects one coalesced snapshot of the cached inputs into the render decisions, reusing
    /// `NLAutomationBuilderLogic` so the projection is the single source of truth the model also
    /// consumes. `vehicleID` is optional to preserve the web `vehicleId != null` semantics
    /// exactly (a present id of `0` still satisfies the gate, mirroring `vehicleId ?? 0`).
    public static func make(
        snapshot: NLAutomationBuilderInputSnapshot,
        prompt: String,
        phase: NLAutomationBuilderStreamPhase,
        streamText: String
    ) -> NLAutomationBuilderProjection {
        let vehicleID = snapshot.vehicleID
        let connection = snapshot.connection
        return NLAutomationBuilderProjection(
            renderState: NLAutomationBuilderLogic.renderState(
                gate: snapshot.gate, gateError: snapshot.errorMessage
            ),
            canStart: NLAutomationBuilderLogic.canStart(vehicleID: vehicleID, prompt: prompt, phase: phase),
            buttonDisabled: NLAutomationBuilderLogic.buttonDisabled(
                vehicleID: vehicleID, prompt: prompt, phase: phase, connection: connection
            ),
            isStreaming: phase == .streaming,
            outputVisible: NLAutomationBuilderLogic.outputVisible(phase: phase, hasText: !streamText.isEmpty),
            thinkingVisible: NLAutomationBuilderLogic.thinkingVisible(phase: phase, hasText: !streamText.isEmpty),
            emptyHint: NLAutomationBuilderLogic.emptyHint(vehicleID: vehicleID, prompt: prompt, phase: phase),
            connection: connection
        )
    }
}
