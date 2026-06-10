//
//  AISignalExplorerNlFilter.Adapter.swift
//  TeslaSync — P4 shared surface · 0046 · AISignalExplorerNlFilter (Apple)
//
//  The testable projection core for the "Helix natural-language filter" panel — the SwiftUI
//  parity of components/ai/AISignalExplorerNlFilter.tsx. Everything here is pure +
//  dependency-free (Foundation only — no SwiftUI, no Observation, no network), so the typed
//  `tool_result` → draft decode, the prompt/stream-lifecycle button logic, and the cached-inputs
//  → view-projection map are all unit tested in isolation (and in the SwiftPM harness) without
//  rendering a view.
//
//  Parity note: the web `onEvent` captures a `tool_result` frame whose
//  `name === 'draft_signal_filter'` and runs `parseSignalFilterDraft(ev.data)`, which keeps the
//  draft ONLY when `data.status === 'ok'` AND `data.draft` normalises (vehicle_id number, signals
//  a string array, range_preset string, per_page number). Unlike its geofence sibling, the web
//  guard does NOT inspect `ev.ok` — the verdict is carried entirely by `data.status`, so a
//  non-`ok` status is dropped (the web `return null`) and there is no "rejected proposal" surface.
//  `SignalExplorerFilterDraft.from(_:)` reproduces that walk exactly, so a malformed provider
//  response can never bleed a partial filter into the user's form.
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`) and the
/// AI feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so the state-holder
/// can emit telemetry without depending on the view layer.
public enum SignalExplorerFilterSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AISignalExplorerNlFilter"
    /// The AI feature id (web `withAiFeature('signal-explorer-nl-filter', …)`).
    public static let featureID = "signal-explorer-nl-filter"
}

// MARK: - JSON value (the `tool_result.data` payload element)

/// A minimal, `Sendable` JSON value — the native mirror of the untyped `ev.data` object the web
/// `parseSignalFilterDraft` narrows with `typeof` / `Array.isArray` guards. It carries the nested
/// `object` / `array` shapes because the draft lives at `data.draft` and its `signals` is a string
/// array the panel reads element-by-element.
public enum SignalExplorerFilterJSON: Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: SignalExplorerFilterJSON])
    case array([SignalExplorerFilterJSON])
    case null

    /// The string payload (web `typeof x === 'string'`), or `nil` for any other kind.
    public var stringValue: String? {
        if case let .string(value) = self { return value }
        return nil
    }

    /// The numeric payload (web `typeof x === 'number'`), or `nil` for any other kind.
    public var numberValue: Double? {
        if case let .number(value) = self { return value }
        return nil
    }

    /// The boolean payload (web `typeof x === 'boolean'`), or `nil` for any other kind.
    public var boolValue: Bool? {
        if case let .bool(value) = self { return value }
        return nil
    }

    /// The array payload (web `Array.isArray(x)`), or `nil` for any other kind.
    public var arrayValue: [SignalExplorerFilterJSON]? {
        if case let .array(value) = self { return value }
        return nil
    }

    /// The object payload (web `typeof x === 'object' && x !== null`), or `nil` otherwise.
    public var objectValue: [String: SignalExplorerFilterJSON]? {
        if case let .object(value) = self { return value }
        return nil
    }
}

// MARK: - Tool result (web `AiStreamEvent` `tool_result` case)

/// One decoded `tool_result` SSE frame — the native mirror of the web event's
/// `{ id, name, ok, data, error }` shape. The view never sees this type; the state-holder forwards
/// it to `SignalExplorerFilterDraft.from(_:)`.
public struct SignalExplorerFilterToolResult: Equatable, Sendable {
    public let id: String
    public let name: String
    public let ok: Bool
    public let data: [String: SignalExplorerFilterJSON]?
    public let error: String?

    public init(
        id: String,
        name: String,
        ok: Bool,
        data: [String: SignalExplorerFilterJSON]? = nil,
        error: String? = nil
    ) {
        self.id = id
        self.name = name
        self.ok = ok
        self.data = data
        self.error = error
    }
}

// MARK: - Signal filter draft (web `SignalFilterDraft`)

/// The typed filter the Helix panel proposes — the native mirror of the web `SignalFilterDraft`
/// (the Go-side `SignalFilter` DTO in internal/ai/tools/signal_explorer_nl_filter.go). The field
/// set is intentionally narrow: only the fields the deterministic SignalExplorer filter form owns
/// (the scoped vehicle, the selected signals, the range preset, and the page size). `onApply`
/// copies the whole value into that form — the panel never writes page state itself.
public struct SignalExplorerFilterDraft: Equatable, Sendable {
    /// The vehicle the proposed filter is scoped to (web `draft.vehicle_id`).
    public let vehicleID: Int64
    /// The signal names the LLM proposes selecting (web `draft.signals`).
    public let signals: [String]
    /// The range preset key (web `draft.range_preset`, e.g. `"24h"`).
    public let rangePreset: String
    /// The proposed page size (web `draft.per_page`).
    public let perPage: Int

    public init(vehicleID: Int64, signals: [String], rangePreset: String, perPage: Int) {
        self.vehicleID = vehicleID
        self.signals = signals
        self.rangePreset = rangePreset
        self.perPage = perPage
    }

    /// The tool whose `tool_result` frame carries a draft (web `ev.name === 'draft_signal_filter'`).
    public static let toolName = "draft_signal_filter"

    /// Native port of the web `parseSignalFilterDraft`: accept the frame only when it is the draft
    /// tool, carries `data.status === 'ok'`, and a `data.draft` that proves a `vehicle_id` number,
    /// a `signals` array whose every element is a string, a `range_preset` string, and a `per_page`
    /// number. Any failure yields `nil` (the web `return null` no-op). The web guard does NOT read
    /// `result.ok` — the verdict is carried entirely by `data.status` — so this faithfully ignores
    /// it too.
    public static func from(_ result: SignalExplorerFilterToolResult) -> SignalExplorerFilterDraft? {
        guard result.name == toolName, let data = result.data else { return nil }
        guard data["status"]?.stringValue == "ok" else { return nil }
        return normalize(data["draft"])
    }

    /// Native port of the web draft narrowing inside `parseSignalFilterDraft`: coerce the `draft`
    /// object into the typed filter, rejecting (returning `nil`) anything that cannot be positively
    /// proven from the wire shape. An empty `signals` array is valid (web `[].every(...) === true`).
    public static func normalize(_ value: SignalExplorerFilterJSON?) -> SignalExplorerFilterDraft? {
        guard let object = value?.objectValue else { return nil }
        guard
            let vehicleNumber = object["vehicle_id"]?.numberValue,
            let signalsArray = object["signals"]?.arrayValue,
            let rangePreset = object["range_preset"]?.stringValue,
            let perPageNumber = object["per_page"]?.numberValue
        else {
            return nil
        }
        var signals: [String] = []
        signals.reserveCapacity(signalsArray.count)
        for element in signalsArray {
            guard let name = element.stringValue else { return nil }
            signals.append(name)
        }
        return SignalExplorerFilterDraft(
            vehicleID: Int64(vehicleNumber),
            signals: signals,
            rangePreset: rangePreset,
            perPage: Int(perPageNumber)
        )
    }
}

// MARK: - Input snapshot (web `vehicleId` prop + gate/connectivity context)

/// One coalesced snapshot of the panel's non-stream, non-prompt inputs — the native mirror of the
/// web `vehicleId` prop plus the `useAiEnabled` gate and the parent surface connectivity. The
/// free-form `prompt` is local UI state (web `useState`) the user edits, so it lives on the model,
/// not here. `vehicleID` is a required `Int64` (web `vehicleId: number`, gated by `vehicleId > 0`).
public struct SignalExplorerFilterInputSnapshot: Sendable, Equatable {
    public var gate: SignalExplorerFilterGate
    public var vehicleID: Int64
    public var connection: SignalExplorerFilterConnection
    public var errorMessage: String?

    public init(
        gate: SignalExplorerFilterGate = .on,
        vehicleID: Int64 = 0,
        connection: SignalExplorerFilterConnection = .live,
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
/// captured-draft presence + connectivity) into the render decisions the view switches on — the
/// testable "adapter" boundary (P4 acceptance: *adapter unit test (cached → projection)*). It holds
/// no SwiftUI and no I/O, so the mapping is asserted without a view or a network.
/// `SignalExplorerFilterModel` derives the very same flags through `SignalExplorerFilterLogic`, so
/// the projection and the live model can never diverge.
public struct SignalExplorerFilterProjection: Equatable, Sendable {
    /// The top-level render axis (gate + gate-error).
    public let renderState: SignalExplorerFilterRenderState
    /// Web `canStart = hasPrompt && hasVehicle`.
    public let canStart: Bool
    /// Web `buttonDisabled = !canStart || isStreaming` (+ offline leaf contract).
    public let buttonDisabled: Bool
    /// Web `isStreaming = stream.state === 'streaming'` — flips the CTA to "Helix is thinking…".
    public let isStreaming: Bool
    /// Web `canApply = !!draft && !isStreaming` — enables the "Apply to filters" action.
    public let canApply: Bool
    /// Web `AiOutputPanel` visibility (text, or a streaming/done/error lifecycle).
    public let outputVisible: Bool
    /// Web `AiOutputPanel` animated thinking branch (streaming, no text yet).
    public let thinkingVisible: Bool
    /// The contextual disabled-reason hint (P4 friendly empty state), or `nil` when ready.
    public let emptyHint: SignalExplorerFilterHint?
    /// The orthogonal connectivity axis (P4 leaf freshness chip + banner).
    public let connection: SignalExplorerFilterConnection

    public init(
        renderState: SignalExplorerFilterRenderState,
        canStart: Bool,
        buttonDisabled: Bool,
        isStreaming: Bool,
        canApply: Bool,
        outputVisible: Bool,
        thinkingVisible: Bool,
        emptyHint: SignalExplorerFilterHint?,
        connection: SignalExplorerFilterConnection
    ) {
        self.renderState = renderState
        self.canStart = canStart
        self.buttonDisabled = buttonDisabled
        self.isStreaming = isStreaming
        self.canApply = canApply
        self.outputVisible = outputVisible
        self.thinkingVisible = thinkingVisible
        self.emptyHint = emptyHint
        self.connection = connection
    }

    /// Projects one coalesced snapshot of the cached inputs into the render decisions, reusing
    /// `SignalExplorerFilterLogic` so the projection is the single source of truth the model also
    /// consumes.
    public static func make(
        snapshot: SignalExplorerFilterInputSnapshot,
        prompt: String,
        phase: SignalExplorerFilterStreamPhase,
        hasDraft: Bool,
        streamText: String
    ) -> SignalExplorerFilterProjection {
        let vehicleID = snapshot.vehicleID
        let connection = snapshot.connection
        let hasText = !streamText.isEmpty
        return SignalExplorerFilterProjection(
            renderState: SignalExplorerFilterLogic.renderState(
                gate: snapshot.gate, gateError: snapshot.errorMessage
            ),
            canStart: SignalExplorerFilterLogic.canStart(vehicleID: vehicleID, prompt: prompt),
            buttonDisabled: SignalExplorerFilterLogic.buttonDisabled(
                vehicleID: vehicleID, prompt: prompt, phase: phase, connection: connection
            ),
            isStreaming: phase == .streaming,
            canApply: SignalExplorerFilterLogic.canApply(hasDraft: hasDraft, phase: phase),
            outputVisible: SignalExplorerFilterLogic.outputVisible(phase: phase, hasText: hasText),
            thinkingVisible: SignalExplorerFilterLogic.thinkingVisible(phase: phase, hasText: hasText),
            emptyHint: SignalExplorerFilterLogic.emptyHint(vehicleID: vehicleID, prompt: prompt, phase: phase),
            connection: connection
        )
    }
}
