//
//  AIVehiclePaintPreview.Adapter.swift
//  TeslaSync — P4 shared surface · 0058 · AIVehiclePaintPreview (Apple)
//
//  The testable, dependency-free core for the Helix vehicle-paint-preview card — the SwiftUI parity
//  of web/src/components/ai/AIVehiclePaintPreview.tsx and the shared `useAiStream` + `AIFeatureCard`
//  + `AiOutputPanel` primitives it composes. Everything here is pure Foundation (no store, no
//  SwiftUI, no bundle) so the dynamic request URL, the optional `style_hint` body, the SSE frame
//  parsing, the delta-accumulating stream reducer, and the output / action derivations are unit
//  tested in isolation against the exact web expressions.
//
//  Parity notes (reproduced verbatim from the web source — do NOT "fix" the behaviour):
//    • numericVehicleID     = `typeof vehicleId === 'number' && Number.isFinite(vehicleId) ?
//                             vehicleId : 0`. The string→number coercion already happened at the
//                             state-holder boundary, so the core models the already-coerced `Int?`;
//                             `nil` collapses to 0 (the `Number.isFinite` guard is vacuous for `Int`).
//    • canStart / haveInputs = `numericVehicleId > 0` — a positive vehicle id (the handler validates
//                             vehicleID > 0). nil / zero / negative ids keep the button disabled.
//    • request URL          = DYNAMIC: `numericVehicleId > 0 ?
//                             '/ai/vehicles/${numericVehicleId}/paint-preview/draft' :
//                             '/ai/vehicles/0/paint-preview/draft'`. The vehicleID is embedded in the
//                             path so the handler scopes the prompt; the client prepends `/api/v1`.
//    • request body         = `useMemo` → `{}` when no style hint, else `{ style_hint }` with the hint
//                             `.trim()`-ed and dropped when empty after trimming. Only the optional
//                             one-word style hint travels in the body.
//    • SSE frame parse      = port of `parseSSEFrame` + `toTypedEvent`: `event:` / `data:` lines,
//                             `:`-prefixed comments skipped, JSON `data` decoded, an eventless or
//                             malformed frame dropped, an unknown event type dropped.
//    • stream lifecycle     = idle → streaming → (done | error); `delta` frames accumulate into
//                             `text`; `confirm_request` pauses; a non-OK HTTP response finalises as
//                             "stream_http_{status}"; `tool_call` / `tool_result` do not mutate the
//                             reducer state (the web feeds them to `onEvent` only).
//    • AiOutputPanel branch = nothing while idle+empty; "Helix error: {message}" in error; the
//                             thinking indicator while streaming before the first delta; else the
//                             accumulated prose.
//

import Foundation

// MARK: - Request (web `useAiStream({ url, body })`)

/// The paint-preview-draft stream request — the native mirror of the web
/// `useAiStream({ url: numericVehicleId > 0 ? '/ai/vehicles/${id}/paint-preview/draft' :
/// '/ai/vehicles/0/paint-preview/draft', body: styleHint ? { style_hint } : {} })`. `vehicleID` is an
/// optional `Int` carrying the already-coerced `Number(vehicleId)` value so the web `numericVehicleId`
/// coercion and the `haveInputs` gate are reproduced exactly; the vehicleID lives in the URL (the
/// handler scopes the prompt) and only the optional one-word `style_hint` travels in the BODY.
public struct PaintPreviewRequest: Sendable, Equatable {
    public var vehicleID: Int?
    public var styleHint: String?

    public init(vehicleID: Int?, styleHint: String? = nil) {
        self.vehicleID = vehicleID
        self.styleHint = styleHint
    }

    /// Web `numericVehicleId = typeof vehicleId === 'number' && Number.isFinite(vehicleId) ? vehicleId
    /// : 0`. The coercion already ran at the source boundary, so a `nil` vehicle collapses to the `0`
    /// sentinel and any concrete `Int` is finite by construction.
    public var numericVehicleID: Int {
        vehicleID ?? 0
    }

    /// Web `haveInputs = numericVehicleId > 0` — the single `canStart` source of truth the projection
    /// consumes. A non-positive vehicle id keeps the button disabled and ships the `/0/` sentinel URL.
    public var haveInputs: Bool {
        numericVehicleID > 0
    }

    /// The bare route the stream is opened against (the client prepends `/api/v1`, web convention).
    /// DYNAMIC: the resolved vehicle path when a positive id is in scope, else the `/0/` sentinel the
    /// disabled button never POSTs (web `numericVehicleId > 0 ? '/ai/vehicles/${id}/…' :
    /// '/ai/vehicles/0/…'`).
    public var path: String {
        numericVehicleID > 0
            ? "/ai/vehicles/\(numericVehicleID)/paint-preview/draft"
            : "/ai/vehicles/0/paint-preview/draft"
    }

    /// The `.trim()`-ed style hint, or `nil` when absent / blank after trimming (web `typeof styleHint
    /// === 'string' && styleHint.trim() !== '' ? styleHint.trim() : undefined`).
    public var trimmedStyleHint: String? {
        guard let styleHint else { return nil }
        let trimmed = styleHint.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// The snake_case JSON body — `{ style_hint }` when a non-blank hint is present, else the empty
    /// `{}` (web `useMemo(() => { const payload = {}; if (styleHint?.trim()) payload.style_hint =
    /// styleHint.trim(); return payload }, …)`). The vehicleID is in the URL, never the body.
    public var body: [String: String] {
        guard let hint = trimmedStyleHint else { return [:] }
        return ["style_hint": hint]
    }

    /// The encoded request body, with keys sorted so the bytes are deterministic under test
    /// (`{}` when no hint, `{"style_hint":"…"}` when present).
    public func encodedBody() throws -> Data {
        try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }
}

// MARK: - Stream events (web `AiStreamEvent` union)

/// The discriminated stream event — the native port of the web `AiStreamEvent` union. Only the
/// fields the card reads are typed; the web `onEvent`-only frames (`tool_call` / `tool_result` /
/// `confirm_request`) carry just enough to assert the parse + the (no-op) reducer behaviour.
public enum PaintPreviewStreamEvent: Sendable, Equatable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(id: String, name: String, ok: Bool)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String, usageIn: Int, usageOut: Int)
    case failure(message: String)
}

// MARK: - SSE frame parsing (web `parseSSEFrame` + `toTypedEvent`)

/// A single Server-Sent-Events frame parser — the native port of the web `parseSSEFrame` +
/// `toTypedEvent`. It reads the `event:` / `data:` lines (with or without the space after the
/// colon), skips `:`-prefixed comments, JSON-decodes the joined `data`, and narrows the
/// `(event, data)` pair into a typed `PaintPreviewStreamEvent`, returning `nil` for an eventless,
/// malformed, or unknown frame so the consumer can skip it without corrupting the stream.
public enum PaintPreviewSSEFrame {
    public static func parse(_ raw: String) -> PaintPreviewStreamEvent? {
        var event = ""
        var dataParts: [String] = []
        for line in raw.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
            if line.hasPrefix(":") { continue }
            if line.hasPrefix("event: ") {
                event = String(line.dropFirst("event: ".count))
            } else if line.hasPrefix("data: ") {
                dataParts.append(String(line.dropFirst("data: ".count)))
            } else if line.hasPrefix("event:") {
                event = String(line.dropFirst("event:".count)).trimmingPrefixSpaces()
            } else if line.hasPrefix("data:") {
                dataParts.append(String(line.dropFirst("data:".count)).trimmingPrefixSpaces())
            }
        }
        if event.isEmpty { return nil }
        let dataString = dataParts.joined(separator: "\n")
        guard let object = decodeObject(dataString) else { return nil }
        return typedEvent(event: event, data: object)
    }

    /// Decodes the joined `data` payload into a JSON object. An empty payload, a non-object, or a
    /// parse failure yields `nil` (web: a frame whose `data` is null / non-object is dropped).
    private static func decodeObject(_ dataString: String) -> [String: Any]? {
        guard !dataString.isEmpty, let bytes = dataString.data(using: .utf8) else { return nil }
        let parsed = try? JSONSerialization.jsonObject(with: bytes)
        return parsed as? [String: Any]
    }

    /// Narrows a parsed `(event, data)` pair into the typed union — the port of `toTypedEvent`. An
    /// unknown event type or a payload missing the required fields yields `nil`. Each event's field
    /// validation lives in a small decoder so this dispatch stays flat.
    private static func typedEvent(event: String, data: [String: Any]) -> PaintPreviewStreamEvent? {
        switch event {
        case "delta": delta(data)
        case "tool_call": toolCall(data)
        case "tool_result": toolResult(data)
        case "confirm_request": confirmRequest(data)
        case "done": done(data)
        case "error": .failure(message: data["message"] as? String ?? "unknown")
        default: nil
        }
    }

    private static func delta(_ data: [String: Any]) -> PaintPreviewStreamEvent? {
        guard let text = data["text"] as? String else { return nil }
        return .delta(text: text)
    }

    private static func toolCall(_ data: [String: Any]) -> PaintPreviewStreamEvent? {
        guard let id = data["id"] as? String, let name = data["name"] as? String else { return nil }
        return .toolCall(id: id, name: name)
    }

    private static func toolResult(_ data: [String: Any]) -> PaintPreviewStreamEvent? {
        guard let id = data["id"] as? String,
              let name = data["name"] as? String,
              let ok = data["ok"] as? Bool else { return nil }
        return .toolResult(id: id, name: name, ok: ok)
    }

    private static func confirmRequest(_ data: [String: Any]) -> PaintPreviewStreamEvent? {
        guard let continuationID = data["continuation_id"] as? String,
              let tool = data["tool"] as? String,
              let summary = data["summary"] as? String else { return nil }
        return .confirmRequest(continuationID: continuationID, tool: tool, summary: summary)
    }

    private static func done(_ data: [String: Any]) -> PaintPreviewStreamEvent {
        let usage = data["usage"] as? [String: Any]
        return .done(
            finishReason: data["finish_reason"] as? String ?? "stop",
            usageIn: intValue(usage?["in"]),
            usageOut: intValue(usage?["out"])
        )
    }

    /// Coerces a JSON number (which `JSONSerialization` may surface as `NSNumber`) to `Int`.
    private static func intValue(_ value: Any?) -> Int {
        (value as? NSNumber)?.intValue ?? 0
    }
}

private extension String {
    /// Drops leading ASCII spaces — the native peer of the web `.trimStart()` applied to the
    /// no-space `event:` / `data:` line forms.
    func trimmingPrefixSpaces() -> String {
        var view = self[...]
        while view.first == " " {
            view = view.dropFirst()
        }
        return String(view)
    }
}

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the native port of the web `AiStreamState`
/// (`idle | streaming | paused-confirm | done | error`).
public enum PaintPreviewStreamState: String, Sendable, Equatable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error
}

/// One immutable view of the stream — the native peer of `useAiStream`'s reactive surface
/// (`state` + accumulated `text` + terminal `error`).
public struct PaintPreviewStreamSnapshot: Sendable, Equatable {
    public var state: PaintPreviewStreamState
    public var text: String
    public var error: String?

    public init(state: PaintPreviewStreamState = .idle, text: String = "", error: String? = nil) {
        self.state = state
        self.text = text
        self.error = error
    }

    /// The pristine, never-started snapshot (web initial `idle` / empty text / no error).
    public static let idle = PaintPreviewStreamSnapshot()
}

/// The pure stream reducer — the native port of `useAiStream`'s `handleEvent` + `finalizeError`
/// transitions. Folding the parsed events over `start()` reproduces the web accumulation exactly,
/// so the delta concatenation, the terminal `done` / `error`, the `confirm_request` pause, the
/// `tool_*` no-ops, and the `stream_http_{status}` HTTP failure are all unit tested without a
/// network.
public enum PaintPreviewStreamReducer {
    /// The snapshot at `start()` — web `setState('streaming'); setText(''); setError(null)`.
    public static func start() -> PaintPreviewStreamSnapshot {
        PaintPreviewStreamSnapshot(state: .streaming, text: "", error: nil)
    }

    /// Applies one event to a snapshot (web `handleEvent`).
    public static func reduce(
        _ snapshot: PaintPreviewStreamSnapshot,
        _ event: PaintPreviewStreamEvent
    ) -> PaintPreviewStreamSnapshot {
        var next = snapshot
        switch event {
        case let .delta(text):
            next.text += text
        case .confirmRequest:
            next.state = .pausedConfirm
        case .done:
            next.state = .done
        case let .failure(message):
            next.state = .error
            next.error = message
        case .toolCall, .toolResult:
            break
        }
        return next
    }

    /// Folds a sequence of events over a fresh `start()` snapshot — the convenience used by the
    /// real streaming source and the unit tests to replay a whole frame sequence.
    public static func fold(_ events: [PaintPreviewStreamEvent]) -> PaintPreviewStreamSnapshot {
        events.reduce(start()) { reduce($0, $1) }
    }

    /// A non-OK HTTP response finalises the stream as an error whose message is
    /// "stream_http_{status}" (web `finalizeError('stream_http_' + res.status)`).
    public static func httpFailure(status: Int) -> PaintPreviewStreamSnapshot {
        PaintPreviewStreamSnapshot(state: .error, text: "", error: "stream_http_\(status)")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

/// The structural output-panel branch — the native port of the `AiOutputPanel` render. It carries
/// no localized prose (that is applied at the projection boundary, P1/S10), so the branch logic is
/// asserted in isolation against the web `hasAnything` / error / thinking / prose order.
public enum PaintPreviewOutputKind: Sendable, Equatable {
    /// Web `!hasAnything` (idle, no text, never started) → the panel renders nothing; natively a
    /// friendly hint (the P4 "never a blank box" rule).
    case empty
    /// Web `text === '' && state === 'streaming'` → the thinking indicator.
    case thinking
    /// Web fallthrough → the accumulated prose.
    case prose(String)
    /// Web `state === 'error'` → "Helix error: {message}". `message` is the raw stream error
    /// (empty when the frame carried none; the localized "unknown" is applied in the projection).
    case failed(message: String)
}

/// Derives the output-panel branch from a stream snapshot — the exact `AiOutputPanel` order:
/// error → (empty+streaming) thinking → prose, with the leading `!hasAnything` guard mapping the
/// untouched idle stream to `.empty`.
public enum PaintPreviewOutput {
    public static func derive(_ snapshot: PaintPreviewStreamSnapshot) -> PaintPreviewOutputKind {
        let hasAnything = !snapshot.text.isEmpty
            || snapshot.state == .streaming
            || snapshot.state == .error
            || snapshot.state == .done
        if !hasAnything { return .empty }
        if snapshot.state == .error { return .failed(message: snapshot.error ?? "") }
        if snapshot.text.isEmpty, snapshot.state == .streaming { return .thinking }
        return .prose(snapshot.text)
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

/// The Ask-Helix action's derived flags — the native port of the `AIFeatureCard` button contract:
/// the visible label flips on `isStreaming`, and the control is disabled when `!canStart` or while
/// streaming (web `disabled = !canStart || isStreaming`).
public struct PaintPreviewAction: Sendable, Equatable {
    public let isStreaming: Bool
    public let isDisabled: Bool

    public init(isStreaming: Bool, isDisabled: Bool) {
        self.isStreaming = isStreaming
        self.isDisabled = isDisabled
    }

    /// Derives the flags from the gate (`canStart = haveInputs`) and the stream state.
    public static func derive(
        canStart: Bool,
        state: PaintPreviewStreamState
    ) -> PaintPreviewAction {
        let streaming = state == .streaming
        return PaintPreviewAction(isStreaming: streaming, isDisabled: !canStart || streaming)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds VoiceOver strings from already-localized parts, so the spoken content is asserted without
/// rendering the view.
public enum PaintPreviewAccessibility {
    /// The action button's spoken name — web `aria-label = "{askHelix} · {buttonLabel}"`.
    public static func actionLabel(ask: String, context: String) -> String {
        "\(ask) · \(context)"
    }

    /// The output panel's spoken label — "{title}: {body}".
    public static func outputLabel(_ title: String, _ body: String) -> String {
        "\(title): \(body)"
    }
}
