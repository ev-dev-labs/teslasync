//
//  AIYearReviewNarration.Adapter.swift
//  TeslaSync — P4 shared surface · 0061 · AIYearReviewNarration (Apple)
//
//  The testable, dependency-free core for the Helix year-in-review narration card — the SwiftUI
//  parity of web/src/components/ai/AIYearReviewNarration.tsx and the shared `useAiStream` +
//  `AIFeatureCard` + `AiOutputPanel` primitives it composes. Everything here is pure Foundation (no
//  store, no SwiftUI, no bundle) so the request URL + body, the SSE frame parsing, the
//  delta-accumulating stream reducer, and the output / action derivations are unit tested in
//  isolation against the exact web expressions.
//
//  Parity notes (reproduced verbatim from the web source — do NOT "fix" the behaviour):
//    • request URL          = `/ai/analytics/year-in-review/narrate` — a STATIC path (no path
//                             params), POSTed against the bare route (the client prepends `/api/v1`).
//    • request body         = `{ vehicle_id: vehicleId ?? 0, year: defaultYear }` (web
//                             `useMemo(() => ({ vehicle_id: vehicleId ?? 0, year: defaultYear }), …)`),
//                             where `defaultYear = new Date().getFullYear() - 1` (the previous
//                             calendar year — most year reviews happen after year end).
//    • canStart              = `vehicleId != null` — a PRESENT vehicle id; `0` passes (`0 != null`),
//                             only `nil` keeps the button disabled (this rule lives in the
//                             projection). Distinct from an "is positive" gate.
//    • SSE frame parse       = port of `parseSSEFrame` + `toTypedEvent`: `event:` / `data:` lines,
//                             `:`-prefixed comments skipped, JSON `data` decoded, an eventless or
//                             malformed frame dropped, an unknown event type dropped.
//    • stream lifecycle      = idle → streaming → (done | error); `delta` frames accumulate into
//                             `text`; `confirm_request` pauses; a non-OK HTTP response finalises as
//                             "stream_http_{status}"; `tool_call` / `tool_result` do not mutate the
//                             reducer state (the web feeds them to `onEvent` only).
//    • AiOutputPanel branch  = nothing while idle+empty; "Helix error: {message}" in error; the
//                             thinking indicator while streaming before the first delta; else the
//                             accumulated prose.
//

import Foundation

// MARK: - Request (web `useAiStream({ url, body })`)

/// The year-in-review narration stream request — the native mirror of the web
/// `useAiStream({ url: '/ai/analytics/year-in-review/narrate', body: { vehicle_id: vehicleId ?? 0,
/// year: defaultYear } })`. The URL is static (no path params); the `vehicleID` is an optional Int so
/// the web `vehicleId ?? 0` body coalescing and the `vehicleId != null` button gate are reproduced
/// exactly. `year` is the previous calendar year by default (web `new Date().getFullYear() - 1`).
public struct YearReviewNarrationRequest: Sendable, Equatable {
    /// The bare path the stream is opened against (the client prepends `/api/v1`, web convention). It
    /// is static — the vehicle + year travel in the body, not the URL.
    public static let path = "/ai/analytics/year-in-review/narrate"

    /// The vehicle the review is for. Optional so the web `vehicleId ?? 0` coalescing (and the
    /// `vehicleId != null` button gate) round-trip; `nil` still produces a well-formed `vehicle_id: 0`
    /// body (web sends it even while the button is disabled).
    public var vehicleID: Int?

    /// The review year — the previous calendar year by default (web `getFullYear() - 1`).
    public var year: Int

    public init(vehicleID: Int?, year: Int) {
        self.vehicleID = vehicleID
        self.year = year
    }

    /// The JSON body — `{ vehicle_id: vehicleId ?? 0, year: defaultYear }`. `vehicle_id` coalesces a
    /// missing vehicle to `0` exactly like the web `vehicleId ?? 0`.
    public var body: [String: Int] {
        ["vehicle_id": vehicleID ?? 0, "year": year]
    }

    /// The encoded request body. Keys are sorted for deterministic bytes under test, so the wire form
    /// is `{"vehicle_id":<n>,"year":<n>}` (web `JSON.stringify` of the memoised body object).
    public func encodedBody() throws -> Data {
        try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }

    /// The default review year — the previous calendar year (web `new Date().getFullYear() - 1`). The
    /// clock + calendar are injectable so the live source uses the device's, and tests pin a fixed
    /// instant for determinism.
    public static func defaultYear(now: Date = Date(), calendar: Calendar = .current) -> Int {
        calendar.component(.year, from: now) - 1
    }
}

// MARK: - Stream events (web `AiStreamEvent` union)

/// The discriminated stream event — the native port of the web `AiStreamEvent` union. Only the
/// fields the card reads are typed; the web `onEvent`-only frames (`tool_call` / `tool_result` /
/// `confirm_request`) carry just enough to assert the parse + the (no-op) reducer behaviour.
public enum YearReviewNarrationStreamEvent: Sendable, Equatable {
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
/// `(event, data)` pair into a typed event, returning `nil` for an eventless, malformed, or unknown
/// frame so the consumer can skip it without corrupting the stream.
public enum YearReviewNarrationSSEFrame {
    public static func parse(_ raw: String) -> YearReviewNarrationStreamEvent? {
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
    private static func typedEvent(
        event: String,
        data: [String: Any]
    ) -> YearReviewNarrationStreamEvent? {
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

    private static func delta(_ data: [String: Any]) -> YearReviewNarrationStreamEvent? {
        guard let text = data["text"] as? String else { return nil }
        return .delta(text: text)
    }

    private static func toolCall(_ data: [String: Any]) -> YearReviewNarrationStreamEvent? {
        guard let id = data["id"] as? String, let name = data["name"] as? String else { return nil }
        return .toolCall(id: id, name: name)
    }

    private static func toolResult(_ data: [String: Any]) -> YearReviewNarrationStreamEvent? {
        guard let id = data["id"] as? String,
              let name = data["name"] as? String,
              let ok = data["ok"] as? Bool else { return nil }
        return .toolResult(id: id, name: name, ok: ok)
    }

    private static func confirmRequest(
        _ data: [String: Any]
    ) -> YearReviewNarrationStreamEvent? {
        guard let continuationID = data["continuation_id"] as? String,
              let tool = data["tool"] as? String,
              let summary = data["summary"] as? String else { return nil }
        return .confirmRequest(continuationID: continuationID, tool: tool, summary: summary)
    }

    private static func done(_ data: [String: Any]) -> YearReviewNarrationStreamEvent {
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
public enum YearReviewNarrationStreamState: String, Sendable, Equatable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error
}

/// One immutable view of the stream — the native peer of `useAiStream`'s reactive surface
/// (`state` + accumulated `text` + terminal `error`).
public struct YearReviewNarrationStreamSnapshot: Sendable, Equatable {
    public var state: YearReviewNarrationStreamState
    public var text: String
    public var error: String?

    public init(
        state: YearReviewNarrationStreamState = .idle,
        text: String = "",
        error: String? = nil
    ) {
        self.state = state
        self.text = text
        self.error = error
    }

    /// The pristine, never-started snapshot (web initial `idle` / empty text / no error).
    public static let idle = YearReviewNarrationStreamSnapshot()
}

/// The pure stream reducer — the native port of `useAiStream`'s `handleEvent` + `finalizeError`
/// transitions. Folding the parsed events over `start()` reproduces the web accumulation exactly,
/// so the delta concatenation, the terminal `done` / `error`, the `confirm_request` pause, the
/// `tool_*` no-ops, and the `stream_http_{status}` HTTP failure are all unit tested without a
/// network.
public enum YearReviewNarrationStreamReducer {
    /// The snapshot at `start()` — web `setState('streaming'); setText(''); setError(null)`.
    public static func start() -> YearReviewNarrationStreamSnapshot {
        YearReviewNarrationStreamSnapshot(state: .streaming, text: "", error: nil)
    }

    /// Applies one event to a snapshot (web `handleEvent`).
    public static func reduce(
        _ snapshot: YearReviewNarrationStreamSnapshot,
        _ event: YearReviewNarrationStreamEvent
    ) -> YearReviewNarrationStreamSnapshot {
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
    public static func fold(
        _ events: [YearReviewNarrationStreamEvent]
    ) -> YearReviewNarrationStreamSnapshot {
        events.reduce(start()) { reduce($0, $1) }
    }

    /// A non-OK HTTP response finalises the stream as an error whose message is
    /// "stream_http_{status}" (web `finalizeError('stream_http_' + res.status)`).
    public static func httpFailure(status: Int) -> YearReviewNarrationStreamSnapshot {
        YearReviewNarrationStreamSnapshot(state: .error, text: "", error: "stream_http_\(status)")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

/// The structural output-panel branch — the native port of the `AiOutputPanel` render. It carries
/// no localized prose (that is applied at the projection boundary, P1/S10), so the branch logic is
/// asserted in isolation against the web `hasAnything` / error / thinking / prose order.
public enum YearReviewNarrationOutputKind: Sendable, Equatable {
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
public enum YearReviewNarrationOutput {
    public static func derive(
        _ snapshot: YearReviewNarrationStreamSnapshot
    ) -> YearReviewNarrationOutputKind {
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
public struct YearReviewNarrationAction: Sendable, Equatable {
    public let isStreaming: Bool
    public let isDisabled: Bool

    public init(isStreaming: Bool, isDisabled: Bool) {
        self.isStreaming = isStreaming
        self.isDisabled = isDisabled
    }

    /// Derives the flags from the gate (`canStart = vehicleId != null`) and the stream state.
    public static func derive(
        canStart: Bool,
        state: YearReviewNarrationStreamState
    ) -> YearReviewNarrationAction {
        let streaming = state == .streaming
        return YearReviewNarrationAction(isStreaming: streaming, isDisabled: !canStart || streaming)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds VoiceOver strings from already-localized parts, so the spoken content is asserted without
/// rendering the view.
public enum YearReviewNarrationAccessibility {
    /// The action button's spoken name — web `aria-label = "{askHelix} · {buttonLabel}"`.
    public static func actionLabel(ask: String, context: String) -> String {
        "\(ask) · \(context)"
    }

    /// The output panel's spoken label — "{title}: {body}".
    public static func outputLabel(_ title: String, _ body: String) -> String {
        "\(title): \(body)"
    }
}
