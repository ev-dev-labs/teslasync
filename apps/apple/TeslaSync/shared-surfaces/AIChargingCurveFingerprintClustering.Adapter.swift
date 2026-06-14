//
//  AIChargingCurveFingerprintClustering.Adapter.swift
//  TeslaSync — P4 shared surface · 0010 · AIChargingCurveFingerprintClustering (Apple)
//
//  The testable, dependency-free core for the Helix charging-curve fingerprint clustering card — the
//  SwiftUI parity of web/src/components/ai/AIChargingCurveFingerprintClustering.tsx and the shared
//  `useAiStream` + `AIFeatureCard` + `AiOutputPanel` primitives it composes. Everything here is pure
//  Foundation (no store, no SwiftUI, no bundle) so the vehicle-id coercion, the request body, the SSE
//  frame parsing, the delta-accumulating stream reducer, and the output / action derivations are unit
//  tested in isolation against the exact web expressions.
//
//  Parity notes (reproduced verbatim from the web source — do NOT "fix" the behaviour):
//    • numericVehicleId      = `typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)`. The
//                              parent surfaces `vehicleId?: string | number`; the JS `Number(...)`
//                              string coercion is reproduced exactly (empty / whitespace → 0, numeric
//                              string → value, other string / `undefined` → NaN).
//    • request URL + body    = the static '/ai/charging/curves/clusters/explain' route (no path
//                              param) with `{ vehicle_id: Number.isFinite(numeric) ? numeric : 0 }` —
//                              snake_case; the body is always present (id in the body, not the path).
//    • canStart (haveInputs) = `Number.isFinite(numericVehicleId) && numericVehicleId > 0` — a finite,
//                              strictly-positive id; nil / "" / 0 / negative / NaN keep it disabled.
//    • SSE frame parse       = port of `parseSSEFrame` + `toTypedEvent`: `event:` / `data:` lines,
//                              `:`-prefixed comments skipped, JSON `data` decoded, an eventless,
//                              malformed, or unknown-type frame dropped.
//    • stream lifecycle      = idle → streaming → (done | error); `delta` frames accumulate into
//                              `text`; `confirm_request` pauses; a non-OK HTTP response finalises as
//                              "stream_http_{status}"; `tool_call` / `tool_result` are reducer no-ops.
//    • AiOutputPanel branch  = nothing while idle+empty; "Helix error: {message}" in error; the
//                              thinking indicator while streaming before the first delta; else prose.
//

import Foundation

// MARK: - Vehicle id coercion (web `typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)`)

/// The active-vehicle input as the parent surfaces it — the native mirror of the web
/// `vehicleId?: string | number`. The derived members reproduce the web body coercion
/// (`Number.isFinite(numericVehicleId) ? numericVehicleId : 0`) and the `canStart` gate
/// (`Number.isFinite(numericVehicleId) && numericVehicleId > 0`) exactly, so a nil / empty /
/// non-numeric / non-positive id keeps the Explain button disabled.
public enum ChargeCurveFingerprintVehicleID: Sendable, Equatable {
    /// Web `undefined` — the active-vehicle context is unresolved at first paint.
    case absent
    /// Web `number` — a resolved numeric id passed straight through.
    case number(Double)
    /// Web `string` — a numeric string the active-vehicle context surfaced; coerced via `Number(...)`.
    case string(String)

    /// Web `typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)`. May be NaN / ±Infinity for
    /// the non-finite cases (absent, non-numeric string), exactly as JavaScript's `Number(...)` yields.
    public var numeric: Double {
        switch self {
        case .absent: .nan
        case let .number(value): value
        case let .string(text): Self.jsNumber(text)
        }
    }

    /// Web `Number.isFinite(numericVehicleId)`.
    public var isFiniteNumeric: Bool {
        numeric.isFinite
    }

    /// Web `Number.isFinite(numericVehicleId) ? numericVehicleId : 0` — the value sent as `vehicle_id`.
    public var bodyValue: Double {
        isFiniteNumeric ? numeric : 0
    }

    /// Web `Number.isFinite(numericVehicleId) && numericVehicleId > 0` — the Explain button gate.
    public var canStart: Bool {
        isFiniteNumeric && numeric > 0
    }

    /// The native peer of JavaScript's `Number(string)` for the inputs an active-vehicle context can
    /// realistically surface: a leading/trailing-whitespace-trimmed value where an empty result is 0,
    /// a decimal / signed / exponent form is its numeric value, and anything else is NaN. (Exotic JS
    /// literal forms — hex `0x…`, binary `0b…`, octal `0o…` — are out of scope for a vehicle id and
    /// intentionally yield NaN here rather than JS's literal parsing.)
    static func jsNumber(_ raw: String) -> Double {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return 0 }
        return Double(trimmed) ?? .nan
    }
}

// MARK: - Request (web `useAiStream({ url, body })`)

/// The charging-curve fingerprint cluster stream request — the native mirror of the web
/// `useAiStream({ url: '/ai/charging/curves/clusters/explain', body: { vehicle_id:
/// Number.isFinite(numericVehicleId) ? numericVehicleId : 0 } })`. The URL is static (no path param);
/// the id lives in the body and is coerced through `ChargeCurveFingerprintVehicleID`.
public struct ChargeCurveFingerprintRequest: Sendable, Equatable {
    /// The bare route the stream is opened against (the client prepends `/api/v1`, web convention).
    public static let path = "/ai/charging/curves/clusters/explain"

    public var vehicleID: ChargeCurveFingerprintVehicleID

    public init(vehicleID: ChargeCurveFingerprintVehicleID) {
        self.vehicleID = vehicleID
    }

    /// The bare route — always the static explain endpoint (web `url: '/ai/charging/curves/clusters/explain'`).
    public var path: String {
        Self.path
    }

    /// Web `canStart={haveInputs}` — a finite, strictly-positive id.
    public var canStart: Bool {
        vehicleID.canStart
    }

    /// The snake_case JSON body — `{ "vehicle_id": Number.isFinite(numericVehicleId) ? numericVehicleId
    /// : 0 }`. A whole value serialises without a fractional part (4821 → `4821`, 0 → `0`), matching the
    /// bytes `JSON.stringify` emits for the web number.
    public var body: [String: Double] {
        ["vehicle_id": vehicleID.bodyValue]
    }

    /// The encoded request body, with keys sorted so the bytes are deterministic under test.
    public func encodedBody() throws -> Data {
        try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }
}

// MARK: - Stream events (web `AiStreamEvent` union)

/// The discriminated stream event — the native port of the web `AiStreamEvent` union. Only the
/// fields the card reads are typed; the web `onEvent`-only frames (`tool_call` / `tool_result` /
/// `confirm_request`) carry just enough to assert the parse + the (no-op) reducer behaviour.
public enum ChargeCurveFingerprintStreamEvent: Sendable, Equatable {
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
/// `(event, data)` pair into a typed `ChargeCurveFingerprintStreamEvent`, returning `nil` for an
/// eventless, malformed, or unknown frame so the consumer can skip it without corrupting the stream.
public enum ChargeCurveFingerprintSSEFrame {
    public static func parse(_ raw: String) -> ChargeCurveFingerprintStreamEvent? {
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
    private static func typedEvent(event: String, data: [String: Any]) -> ChargeCurveFingerprintStreamEvent? {
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

    private static func delta(_ data: [String: Any]) -> ChargeCurveFingerprintStreamEvent? {
        guard let text = data["text"] as? String else { return nil }
        return .delta(text: text)
    }

    private static func toolCall(_ data: [String: Any]) -> ChargeCurveFingerprintStreamEvent? {
        guard let id = data["id"] as? String, let name = data["name"] as? String else { return nil }
        return .toolCall(id: id, name: name)
    }

    private static func toolResult(_ data: [String: Any]) -> ChargeCurveFingerprintStreamEvent? {
        guard let id = data["id"] as? String,
              let name = data["name"] as? String,
              let ok = data["ok"] as? Bool else { return nil }
        return .toolResult(id: id, name: name, ok: ok)
    }

    private static func confirmRequest(_ data: [String: Any]) -> ChargeCurveFingerprintStreamEvent? {
        guard let continuationID = data["continuation_id"] as? String,
              let tool = data["tool"] as? String,
              let summary = data["summary"] as? String else { return nil }
        return .confirmRequest(continuationID: continuationID, tool: tool, summary: summary)
    }

    private static func done(_ data: [String: Any]) -> ChargeCurveFingerprintStreamEvent {
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
public enum ChargeCurveFingerprintStreamState: String, Sendable, Equatable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error
}

/// One immutable view of the stream — the native peer of `useAiStream`'s reactive surface
/// (`state` + accumulated `text` + terminal `error`).
public struct ChargeCurveFingerprintStreamSnapshot: Sendable, Equatable {
    public var state: ChargeCurveFingerprintStreamState
    public var text: String
    public var error: String?

    public init(
        state: ChargeCurveFingerprintStreamState = .idle,
        text: String = "",
        error: String? = nil
    ) {
        self.state = state
        self.text = text
        self.error = error
    }

    /// The pristine, never-started snapshot (web initial `idle` / empty text / no error).
    public static let idle = ChargeCurveFingerprintStreamSnapshot()
}

/// The pure stream reducer — the native port of `useAiStream`'s `handleEvent` + `finalizeError`
/// transitions. Folding the parsed events over `start()` reproduces the web accumulation exactly,
/// so the delta concatenation, the terminal `done` / `error`, the `confirm_request` pause, the
/// `tool_*` no-ops, and the `stream_http_{status}` HTTP failure are all unit tested without a
/// network.
public enum ChargeCurveFingerprintStreamReducer {
    /// The snapshot at `start()` — web `setState('streaming'); setText(''); setError(null)`.
    public static func start() -> ChargeCurveFingerprintStreamSnapshot {
        ChargeCurveFingerprintStreamSnapshot(state: .streaming, text: "", error: nil)
    }

    /// Applies one event to a snapshot (web `handleEvent`).
    public static func reduce(
        _ snapshot: ChargeCurveFingerprintStreamSnapshot,
        _ event: ChargeCurveFingerprintStreamEvent
    ) -> ChargeCurveFingerprintStreamSnapshot {
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
    public static func fold(_ events: [ChargeCurveFingerprintStreamEvent]) -> ChargeCurveFingerprintStreamSnapshot {
        events.reduce(start()) { reduce($0, $1) }
    }

    /// A non-OK HTTP response finalises the stream as an error whose message is
    /// "stream_http_{status}" (web `finalizeError('stream_http_' + res.status)`).
    public static func httpFailure(status: Int) -> ChargeCurveFingerprintStreamSnapshot {
        ChargeCurveFingerprintStreamSnapshot(state: .error, text: "", error: "stream_http_\(status)")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

/// The structural output-panel branch — the native port of the `AiOutputPanel` render. It carries
/// no localized prose (that is applied at the projection boundary, P1/S10), so the branch logic is
/// asserted in isolation against the web `hasAnything` / error / thinking / prose order.
public enum ChargeCurveFingerprintOutputKind: Sendable, Equatable {
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
public enum ChargeCurveFingerprintOutput {
    public static func derive(
        _ snapshot: ChargeCurveFingerprintStreamSnapshot
    ) -> ChargeCurveFingerprintOutputKind {
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
public struct ChargeCurveFingerprintAction: Sendable, Equatable {
    public let isStreaming: Bool
    public let isDisabled: Bool

    public init(isStreaming: Bool, isDisabled: Bool) {
        self.isStreaming = isStreaming
        self.isDisabled = isDisabled
    }

    /// Derives the flags from the gate (`canStart = haveInputs`) and the stream state.
    public static func derive(
        canStart: Bool,
        state: ChargeCurveFingerprintStreamState
    ) -> ChargeCurveFingerprintAction {
        let streaming = state == .streaming
        return ChargeCurveFingerprintAction(isStreaming: streaming, isDisabled: !canStart || streaming)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds VoiceOver strings from already-localized parts, so the spoken content is asserted without
/// rendering the view.
public enum ChargeCurveFingerprintAccessibility {
    /// The action button's spoken name — web `aria-label = "{askHelix} · {buttonLabel}"`.
    public static func actionLabel(ask: String, context: String) -> String {
        "\(ask) · \(context)"
    }

    /// The output panel's spoken label — "{title}: {body}".
    public static func outputLabel(_ title: String, _ body: String) -> String {
        "\(title): \(body)"
    }
}
