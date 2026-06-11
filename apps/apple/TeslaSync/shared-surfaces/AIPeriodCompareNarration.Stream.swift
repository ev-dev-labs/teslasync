//
//  AIPeriodCompareNarration.Stream.swift
//  TeslaSync — P4 shared surface · 0037 · AIPeriodCompareNarration (Apple)
//
//  The SSE streaming core for the Helix period-compare narration card — the dependency-free
//  (Foundation-only) port of the web `useAiStream` machinery composed by
//  web/src/components/ai/AIPeriodCompareNarration.tsx: the `AiStreamEvent` union, the
//  `parseSSEFrame` + `toTypedEvent` frame parser, and the `handleEvent` + `finalizeError`
//  delta-accumulating reducer. Split out of the adapter so each file stays within the lint budget
//  while keeping the stream parity in one focused, unit-tested place. No store, no SwiftUI, no
//  networking lives here — the reducer is a pure fold over parsed frames.
//
//  Parity notes (reproduced verbatim from the web source — do NOT "fix" the behaviour):
//    • SSE frame parse  = port of `parseSSEFrame` + `toTypedEvent`: `event:` / `data:` lines,
//                        `:`-prefixed comments skipped, JSON `data` decoded, an eventless or
//                        malformed frame dropped, an unknown event type dropped.
//    • stream lifecycle = idle → streaming → (done | error); `delta` frames accumulate into `text`;
//                        `confirm_request` pauses; a non-OK HTTP response finalises as
//                        "stream_http_{status}"; `tool_call` / `tool_result` do not mutate state.
//

import Foundation

// MARK: - Stream events (web `AiStreamEvent` union)

/// The discriminated stream event — the native port of the web `AiStreamEvent` union. Only the
/// fields the card reads are typed; the web `onEvent`-only frames (`tool_call` / `tool_result` /
/// `confirm_request`) carry just enough to assert the parse + the (no-op) reducer behaviour.
public enum PeriodCompareNarrationStreamEvent: Sendable, Equatable {
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
/// `(event, data)` pair into a typed `PeriodCompareNarrationStreamEvent`, returning `nil` for an
/// eventless, malformed, or unknown frame so the consumer can skip it without corrupting the stream.
public enum PeriodCompareNarrationSSEFrame {
    public static func parse(_ raw: String) -> PeriodCompareNarrationStreamEvent? {
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
    private static func typedEvent(event: String, data: [String: Any]) -> PeriodCompareNarrationStreamEvent? {
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

    private static func delta(_ data: [String: Any]) -> PeriodCompareNarrationStreamEvent? {
        guard let text = data["text"] as? String else { return nil }
        return .delta(text: text)
    }

    private static func toolCall(_ data: [String: Any]) -> PeriodCompareNarrationStreamEvent? {
        guard let id = data["id"] as? String, let name = data["name"] as? String else { return nil }
        return .toolCall(id: id, name: name)
    }

    private static func toolResult(_ data: [String: Any]) -> PeriodCompareNarrationStreamEvent? {
        guard let id = data["id"] as? String,
              let name = data["name"] as? String,
              let ok = data["ok"] as? Bool else { return nil }
        return .toolResult(id: id, name: name, ok: ok)
    }

    private static func confirmRequest(_ data: [String: Any]) -> PeriodCompareNarrationStreamEvent? {
        guard let continuationID = data["continuation_id"] as? String,
              let tool = data["tool"] as? String,
              let summary = data["summary"] as? String else { return nil }
        return .confirmRequest(continuationID: continuationID, tool: tool, summary: summary)
    }

    private static func done(_ data: [String: Any]) -> PeriodCompareNarrationStreamEvent {
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
public enum PeriodCompareNarrationStreamState: String, Sendable, Equatable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error
}

/// One immutable view of the stream — the native peer of `useAiStream`'s reactive surface
/// (`state` + accumulated `text` + terminal `error`).
public struct PeriodCompareNarrationStreamSnapshot: Sendable, Equatable {
    public var state: PeriodCompareNarrationStreamState
    public var text: String
    public var error: String?

    public init(
        state: PeriodCompareNarrationStreamState = .idle,
        text: String = "",
        error: String? = nil
    ) {
        self.state = state
        self.text = text
        self.error = error
    }

    /// The pristine, never-started snapshot (web initial `idle` / empty text / no error).
    public static let idle = PeriodCompareNarrationStreamSnapshot()
}

/// The pure stream reducer — the native port of `useAiStream`'s `handleEvent` + `finalizeError`
/// transitions. Folding the parsed events over `start()` reproduces the web accumulation exactly,
/// so the delta concatenation, the terminal `done` / `error`, the `confirm_request` pause, the
/// `tool_*` no-ops, and the `stream_http_{status}` HTTP failure are all unit tested without a
/// network.
public enum PeriodCompareNarrationStreamReducer {
    /// The snapshot at `start()` — web `setState('streaming'); setText(''); setError(null)`.
    public static func start() -> PeriodCompareNarrationStreamSnapshot {
        PeriodCompareNarrationStreamSnapshot(state: .streaming, text: "", error: nil)
    }

    /// Applies one event to a snapshot (web `handleEvent`).
    public static func reduce(
        _ snapshot: PeriodCompareNarrationStreamSnapshot,
        _ event: PeriodCompareNarrationStreamEvent
    ) -> PeriodCompareNarrationStreamSnapshot {
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
    public static func fold(_ events: [PeriodCompareNarrationStreamEvent]) -> PeriodCompareNarrationStreamSnapshot {
        events.reduce(start()) { reduce($0, $1) }
    }

    /// A non-OK HTTP response finalises the stream as an error whose message is
    /// "stream_http_{status}" (web `finalizeError('stream_http_' + res.status)`).
    public static func httpFailure(status: Int) -> PeriodCompareNarrationStreamSnapshot {
        PeriodCompareNarrationStreamSnapshot(state: .error, text: "", error: "stream_http_\(status)")
    }
}
