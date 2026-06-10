//
//  AIStateMachineDebuggerNarrator.Adapter.swift
//  TeslaSync — P4 shared surface · 0050 · AIStateMachineDebuggerNarrator (Apple)
//
//  The testable, dependency-free core for the Helix FSM-trace narrator card — the SwiftUI parity of
//  web/src/components/ai/AIStateMachineDebuggerNarrator.tsx and the shared `useAiStream` +
//  `AIFeatureCard` + `AiOutputPanel` primitives it composes. Everything here is pure Foundation (no
//  store, no SwiftUI, no bundle) so the request URL, the (vehicle_id, from_unix, to_unix) scope body,
//  the SSE frame parsing, the delta-accumulating stream reducer, and the output / action derivations
//  are unit tested in isolation against the exact web expressions.
//
//  Parity notes (reproduced verbatim from the web source — do NOT "fix" the behaviour):
//    • scope gate           = `haveScope = typeof vehicleId === 'number' && Number.isFinite(vehicleId)
//                             && vehicleId > 0 && typeof fromUnix === 'number' && Number.isFinite(
//                             fromUnix) && fromUnix > 0 && typeof toUnix === 'number' &&
//                             Number.isFinite(toUnix) && toUnix > fromUnix`. Unlike 0028's
//                             window-only explainer, the FSM narrator's scope is a TRIPLE: a positive
//                             vehicle AND a positive ordered window. The parent surfaces
//                             `number | undefined`; the coercion to a finite integer happens at the
//                             state-holder boundary, so the core models the already-coerced `Int?`
//                             triple. `toUnix` needs no separate `> 0` check — `toUnix > fromUnix > 0`
//                             already implies it.
//    • request URL          = `'/ai/system/fsm/narrate'` — STATIC. POSTed against the bare route (the
//                             client prepends `/api/v1`).
//    • request body         = `useMemo` → `haveScope ? { vehicle_id, from_unix, to_unix } :
//                             { vehicle_id: 0, from_unix: 0, to_unix: 0 }`. The in-scope triple is the
//                             payload so the LLM cannot widen it; an invalid scope ships the
//                             `{0,0,0}` sentinel the disabled button never POSTs.
//    • canStart             = `haveScope` — a positive vehicle with a positive ordered window; nil /
//                             non-positive / inverted scopes keep the button disabled and ship the
//                             `{0,0,0}` body.
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

/// The FSM-narrate stream request — the native mirror of the web
/// `useAiStream({ url: '/ai/system/fsm/narrate', body: haveScope ? { vehicle_id, from_unix, to_unix }
/// : { vehicle_id: 0, from_unix: 0, to_unix: 0 } })`. `vehicleID` / `fromUnix` / `toUnix` are optional
/// `Int`s carrying the already-coerced `Number(...)` values so the web `haveScope` gate and the body
/// shape are reproduced exactly. The URL is static and the in-scope triple lives in the BODY so the
/// LLM cannot widen it.
public struct FSMNarratorRequest: Sendable, Equatable {
    /// The bare route the stream is opened against (the client prepends `/api/v1`, web convention).
    /// Static for every scope (web `url: '/ai/system/fsm/narrate'`).
    public static let path = "/ai/system/fsm/narrate"

    public var vehicleID: Int?
    public var fromUnix: Int?
    public var toUnix: Int?

    public init(vehicleID: Int?, fromUnix: Int?, toUnix: Int?) {
        self.vehicleID = vehicleID
        self.fromUnix = fromUnix
        self.toUnix = toUnix
    }

    /// Web `haveScope`: a finite positive `vehicleId`, a finite positive `fromUnix`, and a finite
    /// `toUnix > fromUnix`. The `Number.isFinite` guard is vacuous for `Int` (always finite); the
    /// string→number coercion already happened at the source boundary, so only the `> 0` /
    /// `to > from` ordering remains. This is the single `canStart` source of truth the projection
    /// consumes.
    public var haveScope: Bool {
        guard let vehicleID, let fromUnix, let toUnix else { return false }
        return vehicleID > 0 && fromUnix > 0 && toUnix > fromUnix
    }

    /// The snake_case JSON body — the in-scope `{ vehicle_id, from_unix, to_unix }` triple when the
    /// scope is valid, else the `{ vehicle_id: 0, from_unix: 0, to_unix: 0 }` sentinel (web
    /// `useMemo(() => haveScope ? { vehicle_id, from_unix, to_unix } : { vehicle_id: 0, from_unix: 0,
    /// to_unix: 0 }, …)`). The disabled button never POSTs the sentinel, but the hook is still
    /// constructed with a stable body.
    public var body: [String: Int] {
        guard haveScope, let vehicleID, let fromUnix, let toUnix else {
            return ["vehicle_id": 0, "from_unix": 0, "to_unix": 0]
        }
        return ["vehicle_id": vehicleID, "from_unix": fromUnix, "to_unix": toUnix]
    }

    /// The encoded request body — keys sorted for deterministic bytes under test
    /// (`{"from_unix":…,"to_unix":…,"vehicle_id":…}`).
    public func encodedBody() throws -> Data {
        try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }
}

// MARK: - Stream events (web `AiStreamEvent` union)

/// The discriminated stream event — the native port of the web `AiStreamEvent` union. Only the
/// fields the card reads are typed; the web `onEvent`-only frames (`tool_call` / `tool_result` /
/// `confirm_request`) carry just enough to assert the parse + the (no-op) reducer behaviour.
public enum FSMNarratorStreamEvent: Sendable, Equatable {
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
/// `(event, data)` pair into a typed `FSMNarratorStreamEvent`, returning `nil` for an eventless,
/// malformed, or unknown frame so the consumer can skip it without corrupting the stream.
public enum FSMNarratorSSEFrame {
    public static func parse(_ raw: String) -> FSMNarratorStreamEvent? {
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
    private static func typedEvent(event: String, data: [String: Any]) -> FSMNarratorStreamEvent? {
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

    private static func delta(_ data: [String: Any]) -> FSMNarratorStreamEvent? {
        guard let text = data["text"] as? String else { return nil }
        return .delta(text: text)
    }

    private static func toolCall(_ data: [String: Any]) -> FSMNarratorStreamEvent? {
        guard let id = data["id"] as? String, let name = data["name"] as? String else { return nil }
        return .toolCall(id: id, name: name)
    }

    private static func toolResult(_ data: [String: Any]) -> FSMNarratorStreamEvent? {
        guard let id = data["id"] as? String,
              let name = data["name"] as? String,
              let ok = data["ok"] as? Bool else { return nil }
        return .toolResult(id: id, name: name, ok: ok)
    }

    private static func confirmRequest(_ data: [String: Any]) -> FSMNarratorStreamEvent? {
        guard let continuationID = data["continuation_id"] as? String,
              let tool = data["tool"] as? String,
              let summary = data["summary"] as? String else { return nil }
        return .confirmRequest(continuationID: continuationID, tool: tool, summary: summary)
    }

    private static func done(_ data: [String: Any]) -> FSMNarratorStreamEvent {
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
public enum FSMNarratorStreamState: String, Sendable, Equatable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error
}

/// One immutable view of the stream — the native peer of `useAiStream`'s reactive surface
/// (`state` + accumulated `text` + terminal `error`).
public struct FSMNarratorStreamSnapshot: Sendable, Equatable {
    public var state: FSMNarratorStreamState
    public var text: String
    public var error: String?

    public init(state: FSMNarratorStreamState = .idle, text: String = "", error: String? = nil) {
        self.state = state
        self.text = text
        self.error = error
    }

    /// The pristine, never-started snapshot (web initial `idle` / empty text / no error).
    public static let idle = FSMNarratorStreamSnapshot()
}

/// The pure stream reducer — the native port of `useAiStream`'s `handleEvent` + `finalizeError`
/// transitions. Folding the parsed events over `start()` reproduces the web accumulation exactly,
/// so the delta concatenation, the terminal `done` / `error`, the `confirm_request` pause, the
/// `tool_*` no-ops, and the `stream_http_{status}` HTTP failure are all unit tested without a
/// network.
public enum FSMNarratorStreamReducer {
    /// The snapshot at `start()` — web `setState('streaming'); setText(''); setError(null)`.
    public static func start() -> FSMNarratorStreamSnapshot {
        FSMNarratorStreamSnapshot(state: .streaming, text: "", error: nil)
    }

    /// Applies one event to a snapshot (web `handleEvent`).
    public static func reduce(
        _ snapshot: FSMNarratorStreamSnapshot,
        _ event: FSMNarratorStreamEvent
    ) -> FSMNarratorStreamSnapshot {
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
    public static func fold(_ events: [FSMNarratorStreamEvent]) -> FSMNarratorStreamSnapshot {
        events.reduce(start()) { reduce($0, $1) }
    }

    /// A non-OK HTTP response finalises the stream as an error whose message is
    /// "stream_http_{status}" (web `finalizeError('stream_http_' + res.status)`).
    public static func httpFailure(status: Int) -> FSMNarratorStreamSnapshot {
        FSMNarratorStreamSnapshot(state: .error, text: "", error: "stream_http_\(status)")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

/// The structural output-panel branch — the native port of the `AiOutputPanel` render. It carries
/// no localized prose (that is applied at the projection boundary, P1/S10), so the branch logic is
/// asserted in isolation against the web `hasAnything` / error / thinking / prose order.
public enum FSMNarratorOutputKind: Sendable, Equatable {
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
public enum FSMNarratorOutput {
    public static func derive(_ snapshot: FSMNarratorStreamSnapshot) -> FSMNarratorOutputKind {
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
public struct FSMNarratorAction: Sendable, Equatable {
    public let isStreaming: Bool
    public let isDisabled: Bool

    public init(isStreaming: Bool, isDisabled: Bool) {
        self.isStreaming = isStreaming
        self.isDisabled = isDisabled
    }

    /// Derives the flags from the gate (`canStart = haveScope`) and the stream state.
    public static func derive(
        canStart: Bool,
        state: FSMNarratorStreamState
    ) -> FSMNarratorAction {
        let streaming = state == .streaming
        return FSMNarratorAction(isStreaming: streaming, isDisabled: !canStart || streaming)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds VoiceOver strings from already-localized parts, so the spoken content is asserted without
/// rendering the view.
public enum FSMNarratorAccessibility {
    /// The action button's spoken name — web `aria-label = "{askHelix} · {buttonLabel}"`.
    public static func actionLabel(ask: String, context: String) -> String {
        "\(ask) · \(context)"
    }

    /// The output panel's spoken label — "{title}: {body}".
    public static func outputLabel(_ title: String, _ body: String) -> String {
        "\(title): \(body)"
    }
}
