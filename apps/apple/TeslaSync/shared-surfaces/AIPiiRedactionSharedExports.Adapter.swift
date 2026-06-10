//
//  AIPiiRedactionSharedExports.Adapter.swift
//  TeslaSync — P4 shared surface · 0038 · AIPiiRedactionSharedExports (Apple)
//
//  The testable projection core for the "Plan PII redactions before sharing" Helix panel — the
//  SwiftUI parity of components/ai/AIPiiRedactionSharedExports.tsx. Everything here is pure +
//  dependency-free (Foundation only — no SwiftUI, no Observation, no network), so the surface
//  identity, the SSE event model, and the cached-inputs → view-projection map are all unit
//  tested in isolation (and in the SwiftPM harness) without rendering a view.
//
//  Parity note: the web source wires `useAiStream({ url:'/ai/exports/redaction/draft',
//  body:{export_type}, onEvent: () => {} })`. The `onEvent` handler is a deliberate no-op — the
//  catalog-based narrative flows straight into the AiOutputPanel; there is NO typed `tool_result`
//  capture and NO proposal children. So the projection here models only the single web `canStart`
//  predicate (`exportType !== ''`) plus the stream lifecycle + leaf connectivity.
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`) and
/// the AI feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so the
/// state-holder can emit telemetry without depending on the view layer.
public enum PiiRedactionExportsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AIPiiRedactionSharedExports"
    /// The AI feature id — web `withAiFeature('pii-redaction-shared-exports', …)`.
    public static let featureID = "pii-redaction-shared-exports"
}

// MARK: - Stream event (web `AiStreamEvent` discriminated union)

/// The native port of the web `AiStreamEvent` union the SSE writer emits. The web source's
/// `onEvent` is a no-op, so the model only acts on `delta` (the output-panel text accumulator);
/// the remaining cases are carried for fidelity + future fan-out, with the lifecycle transitions
/// delivered separately through the source's stream-state callback (mirroring how `useAiStream`
/// flips `state` internally on `done`/`error`/`confirm`).
public enum PiiRedactionExportsStreamEvent: Equatable, Sendable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(id: String, name: String, ok: Bool)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String)
    case error(message: String)
}

// MARK: - Input snapshot (gate + connectivity context)

/// One coalesced snapshot of the panel's non-stream, non-selection inputs — the native mirror of
/// the `useAiEnabled` gate and the parent surface connectivity. The chosen `exportType` is local
/// UI state (web `useState`) the user edits, so it lives on the model, not here. The web
/// `InnerSection` takes NO props (no `vehicleId`), so this snapshot carries only the gate, the
/// connectivity axis, and the gate-fetch error. Pure Foundation data, so it bundles the
/// projection's cached inputs (keeping the projection map under the parameter-count budget).
public struct PiiRedactionExportsInputSnapshot: Sendable, Equatable {
    public var gate: PiiRedactionExportsGate
    public var connection: PiiRedactionExportsConnection
    public var errorMessage: String?

    public init(
        gate: PiiRedactionExportsGate = .on,
        connection: PiiRedactionExportsConnection = .live,
        errorMessage: String? = nil
    ) {
        self.gate = gate
        self.connection = connection
        self.errorMessage = errorMessage
    }
}

// MARK: - View projection (cached inputs → render decisions)

/// The pure projection of the panel's cached inputs (gate + export-type + stream phase +
/// connectivity) into the render decisions the view switches on — the testable "adapter"
/// boundary (P4 acceptance: *adapter unit test (cached → projection)*). It holds no SwiftUI
/// and no I/O, so the mapping is asserted without a view or a network.
/// `PiiRedactionExportsModel` derives the very same flags through `PiiRedactionExportsLogic`,
/// so the projection and the live model can never diverge.
public struct PiiRedactionExportsProjection: Equatable, Sendable {
    /// The top-level render axis (gate + gate-error).
    public let renderState: PiiRedactionExportsRenderState
    /// Web `canStart = exportType !== ''`.
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
    public let emptyHint: PiiRedactionExportsHint?
    /// The orthogonal connectivity axis (P4 leaf freshness chip + banner).
    public let connection: PiiRedactionExportsConnection

    public init(
        renderState: PiiRedactionExportsRenderState,
        canStart: Bool,
        buttonDisabled: Bool,
        isStreaming: Bool,
        outputVisible: Bool,
        thinkingVisible: Bool,
        emptyHint: PiiRedactionExportsHint?,
        connection: PiiRedactionExportsConnection
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
    /// `PiiRedactionExportsLogic` so the projection is the single source of truth the model also
    /// consumes. `exportType` is optional to preserve the web `exportType !== ''` semantics
    /// exactly (`nil` ⇒ the empty-string resting state that disables the action).
    public static func make(
        snapshot: PiiRedactionExportsInputSnapshot,
        exportType: PiiRedactionExportType?,
        phase: PiiRedactionExportsStreamPhase,
        streamText: String
    ) -> PiiRedactionExportsProjection {
        let connection = snapshot.connection
        return PiiRedactionExportsProjection(
            renderState: PiiRedactionExportsLogic.renderState(
                gate: snapshot.gate, gateError: snapshot.errorMessage
            ),
            canStart: PiiRedactionExportsLogic.canStart(exportType: exportType, phase: phase),
            buttonDisabled: PiiRedactionExportsLogic.buttonDisabled(
                exportType: exportType, phase: phase, connection: connection
            ),
            isStreaming: phase == .streaming,
            outputVisible: PiiRedactionExportsLogic.outputVisible(
                phase: phase, hasText: !streamText.isEmpty
            ),
            thinkingVisible: PiiRedactionExportsLogic.thinkingVisible(
                phase: phase, hasText: !streamText.isEmpty
            ),
            emptyHint: PiiRedactionExportsLogic.emptyHint(exportType: exportType, phase: phase),
            connection: connection
        )
    }
}
