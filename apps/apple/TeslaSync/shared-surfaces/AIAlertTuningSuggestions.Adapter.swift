//
//  AIAlertTuningSuggestions.Adapter.swift
//  TeslaSync — P4 shared surface · 0004 · AIAlertTuningSuggestions (Apple)
//
//  The testable, dependency-free core for the Helix alert-tuning card — the SwiftUI parity of
//  web/src/components/ai/AIAlertTuningSuggestions.tsx and the shared `useAiStream` + `AIFeatureCard`
//  + `AiOutputPanel` primitives it composes. Everything here is pure Foundation (no store, no
//  SwiftUI, no bundle) so the request body, the SSE frame parsing, the delta-accumulating stream
//  reducer, the typed `AlertRuleDraftPatch` capture, and the output / action derivations are unit
//  tested in isolation against the exact web expressions.
//
//  Parity notes (reproduced verbatim from the web source — do NOT "fix" the behaviour):
//    • request URL    = `/ai/alerts/rules/{ruleId}/tune/draft` (the bare route; the client prepends
//                       `/api/v1`). The path interpolates the AlertRule id being tuned.
//    • request body   = `{}` when vehicleId is null, else `{ "vehicle_id": vehicleId }` (snake_case).
//                       The empty body for the missing-vehicle case is preserved exactly.
//    • patch capture  = a `tool_result` frame with name `draft_alert_rule_patch`, `ok == true`,
//                       `data.status == "ok"`, and a `data.proposed` object yields a typed
//                       `AlertRuleDraftPatch`: value_num / value_min / value_max / cooldown_min are
//                       taken only when numeric; severity / trigger_mode / op only when a non-empty
//                       string. Every other field the LLM might emit is dropped (the panel must not
//                       over-write fields the user did not consent to changing).
//    • SSE frame parse = port of `parseSSEFrame` + `toTypedEvent`: `event:` / `data:` lines,
//                       `:`-prefixed comments skipped, JSON `data` decoded, an eventless or
//                       malformed frame dropped, an unknown event type dropped.
//    • stream lifecycle = idle → streaming → (done | error); `delta` frames accumulate into `text`;
//                       `confirm_request` pauses; a non-OK HTTP response finalises as
//                       "stream_http_{status}"; `tool_call` does not mutate the reducer state.
//    • AiOutputPanel branch = nothing while idle+empty; "Helix error: {message}" in error; the
//                       thinking indicator while streaming before the first delta; else the
//                       accumulated prose.
//

import Foundation

// MARK: - Request (web `useAiStream({ url, body })`)

/// The alert-tuning draft stream request — the native mirror of the web
/// `useAiStream({ url: '/ai/alerts/rules/${ruleId}/tune/draft', body })`. `vehicleID` is optional so
/// the web `vehicleId == null ? {} : { vehicle_id: vehicleId }` body branch is reproduced exactly.
public struct AlertTuningDraftRequest: Sendable, Equatable {
    /// The AlertRule id being tuned. Interpolated into the bare route.
    public var ruleID: Int
    /// Optional in-scope vehicle for the tool's firing-history window. Forwarded as `vehicle_id`
    /// when non-nil; omitted (empty body) when nil — the web optional `vehicle_id` contract.
    public var vehicleID: Int?

    public init(ruleID: Int, vehicleID: Int? = nil) {
        self.ruleID = ruleID
        self.vehicleID = vehicleID
    }

    /// The bare route the stream is opened against (the client prepends `/api/v1`, web convention).
    public var path: String {
        "/ai/alerts/rules/\(ruleID)/tune/draft"
    }

    /// The snake_case JSON body — `{}` when `vehicleID` is nil, else `{ "vehicle_id": vehicleID }`.
    public var body: [String: Int] {
        guard let vehicleID else { return [:] }
        return ["vehicle_id": vehicleID]
    }

    /// The encoded request body, with keys sorted so the bytes are deterministic under test.
    public func encodedBody() throws -> Data {
        try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }
}

// MARK: - Stream events (web `AiStreamEvent` union)

/// The discriminated stream event — the native port of the web `AiStreamEvent` union. The
/// `toolResult` case carries the fields the capture logic reads (`status` + the extracted patch) so
/// the parse + the reducer's proposal capture are asserted without a network.
public enum AlertTuningStreamEvent: Sendable, Equatable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(id: String, name: String, ok: Bool, status: String?, patch: AlertRuleDraftPatch?)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String, usageIn: Int, usageOut: Int)
    case failure(message: String)
}

// MARK: - SSE frame parsing (web `parseSSEFrame` + `toTypedEvent`)

/// A single Server-Sent-Events frame parser — the native port of the web `parseSSEFrame` +
/// `toTypedEvent`. It reads the `event:` / `data:` lines (with or without the space after the
/// colon), skips `:`-prefixed comments, JSON-decodes the joined `data`, and narrows the
/// `(event, data)` pair into a typed `AlertTuningStreamEvent`, returning `nil` for an eventless,
/// malformed, or unknown frame so the consumer can skip it without corrupting the stream.
public enum AlertTuningSSEFrame {
    public static func parse(_ raw: String) -> AlertTuningStreamEvent? {
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
    /// unknown event type or a payload missing the required fields yields `nil`.
    private static func typedEvent(event: String, data: [String: Any]) -> AlertTuningStreamEvent? {
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

    private static func delta(_ data: [String: Any]) -> AlertTuningStreamEvent? {
        guard let text = data["text"] as? String else { return nil }
        return .delta(text: text)
    }

    private static func toolCall(_ data: [String: Any]) -> AlertTuningStreamEvent? {
        guard let id = data["id"] as? String, let name = data["name"] as? String else { return nil }
        return .toolCall(id: id, name: name)
    }

    /// Parses a `tool_result` frame, extracting the `status` + the typed patch from `data.data`. The
    /// envelope shape mirrors the web `ev.data as { proposed?, status? }`: the tool's typed reply
    /// lives under the `data` key of the SSE frame, and the capture logic reads `status` + `proposed`
    /// from there.
    private static func toolResult(_ data: [String: Any]) -> AlertTuningStreamEvent? {
        guard let id = data["id"] as? String,
              let name = data["name"] as? String,
              let ok = data["ok"] as? Bool else { return nil }
        let payload = data["data"] as? [String: Any]
        let status = payload?["status"] as? String
        let patch = (payload?["proposed"] as? [String: Any]).map(AlertRuleDraftPatch.extract(fromProposed:))
        return .toolResult(id: id, name: name, ok: ok, status: status, patch: patch)
    }

    private static func confirmRequest(_ data: [String: Any]) -> AlertTuningStreamEvent? {
        guard let continuationID = data["continuation_id"] as? String,
              let tool = data["tool"] as? String,
              let summary = data["summary"] as? String else { return nil }
        return .confirmRequest(continuationID: continuationID, tool: tool, summary: summary)
    }

    private static func done(_ data: [String: Any]) -> AlertTuningStreamEvent {
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
public enum AlertTuningStreamState: String, Sendable, Equatable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error
}

/// One immutable view of the stream — the native peer of `useAiStream`'s reactive surface
/// (`state` + accumulated `text` + terminal `error`) plus the component-state `proposal` the alert-
/// tuning card captures from `tool_result` frames.
public struct AlertTuningStreamSnapshot: Sendable, Equatable {
    public var state: AlertTuningStreamState
    public var text: String
    public var error: String?
    public var proposal: AlertRuleDraftPatch?

    public init(
        state: AlertTuningStreamState = .idle,
        text: String = "",
        error: String? = nil,
        proposal: AlertRuleDraftPatch? = nil
    ) {
        self.state = state
        self.text = text
        self.error = error
        self.proposal = proposal
    }

    /// The pristine, never-started snapshot (web initial idle / empty text / no error / no proposal).
    public static let idle = AlertTuningStreamSnapshot()
}

/// The pure stream reducer — the native port of `useAiStream`'s `handleEvent` + `finalizeError` plus
/// the component's `tool_result` proposal capture. Folding the parsed events over `start()`
/// reproduces the web behaviour exactly, so the delta accumulation, the terminal `done` / `error`,
/// the `confirm_request` pause, the `tool_call` no-op, the typed patch capture, and the
/// `stream_http_{status}` HTTP failure are all unit tested without a network.
public enum AlertTuningStreamReducer {
    /// The tool name the capture logic accepts (web `ev.name === 'draft_alert_rule_patch'`).
    public static let patchToolName = "draft_alert_rule_patch"

    /// The snapshot at `start()` — web `handleSuggest` does `setProposal(null)` then the hook does
    /// `setState('streaming'); setText(''); setError(null)`. So a fresh suggest clears the proposal.
    public static func start() -> AlertTuningStreamSnapshot {
        AlertTuningStreamSnapshot(state: .streaming, text: "", error: nil, proposal: nil)
    }

    /// Applies one event to a snapshot (web `handleEvent` + the hook's state transitions).
    public static func reduce(
        _ snapshot: AlertTuningStreamSnapshot,
        _ event: AlertTuningStreamEvent
    ) -> AlertTuningStreamSnapshot {
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
        case let .toolResult(_, name, ok, status, patch):
            if name == patchToolName, ok, status == "ok", let patch {
                next.proposal = patch
            }
        case .toolCall:
            break
        }
        return next
    }

    /// Folds a sequence of events over a fresh `start()` snapshot — the convenience used by the real
    /// streaming source and the unit tests to replay a whole frame sequence.
    public static func fold(_ events: [AlertTuningStreamEvent]) -> AlertTuningStreamSnapshot {
        events.reduce(start()) { reduce($0, $1) }
    }

    /// A non-OK HTTP response finalises the stream as an error whose message is "stream_http_{status}"
    /// (web `finalizeError('stream_http_' + res.status)`).
    public static func httpFailure(status: Int) -> AlertTuningStreamSnapshot {
        AlertTuningStreamSnapshot(state: .error, text: "", error: "stream_http_\(status)")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

/// The structural output-panel branch — the native port of the `AiOutputPanel` render. It carries no
/// localized prose (that is applied at the projection boundary, P1/S10), so the branch logic is
/// asserted in isolation against the web `hasAnything` / error / thinking / prose order.
public enum AlertTuningOutputKind: Sendable, Equatable {
    /// Web `!hasAnything` (idle, no text, never started) → the panel renders nothing; natively a
    /// friendly hint (the P4 "never a blank box" rule).
    case empty
    /// Web `text === '' && state === 'streaming'` → the thinking indicator.
    case thinking
    /// Web fallthrough → the accumulated prose.
    case prose(String)
    /// Web `state === 'error'` → "Helix error: {message}". `message` is the raw stream error.
    case failed(message: String)
}

/// Derives the output-panel branch from a stream snapshot — the exact `AiOutputPanel` order:
/// error → (empty+streaming) thinking → prose, with the leading `!hasAnything` guard mapping the
/// untouched idle stream to `.empty`.
public enum AlertTuningOutput {
    public static func derive(_ snapshot: AlertTuningStreamSnapshot) -> AlertTuningOutputKind {
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

// MARK: - Action derivation (web `AIFeatureCard` Suggest button + the Apply button)

/// The Suggest action's derived flags — the native port of the `AIFeatureCard` button contract: the
/// visible label flips on `isStreaming`, and the control is disabled when `!canStart` or while
/// streaming (web `disabled = !canStart || isStreaming`). For this card `canStart` is
/// `ruleId != nil && state != 'paused-confirm'`.
public struct AlertTuningAction: Sendable, Equatable {
    public let isStreaming: Bool
    public let isDisabled: Bool

    public init(isStreaming: Bool, isDisabled: Bool) {
        self.isStreaming = isStreaming
        self.isDisabled = isDisabled
    }

    /// Derives the flags from the gate (`canStart`) and the stream state.
    public static func derive(canStart: Bool, state: AlertTuningStreamState) -> AlertTuningAction {
        let streaming = state == .streaming
        return AlertTuningAction(isStreaming: streaming, isDisabled: !canStart || streaming)
    }
}

/// The "busy" predicate shared by the Suggest no-op guard and the Apply button — web
/// `isBusy = stream.state === 'streaming' || stream.state === 'paused-confirm'`.
public enum AlertTuningBusy {
    public static func isBusy(_ state: AlertTuningStreamState) -> Bool {
        state == .streaming || state == .pausedConfirm
    }

    /// Web `canStart = !!ruleId && stream.state !== 'paused-confirm'`.
    public static func canStart(ruleID: Int?, state: AlertTuningStreamState) -> Bool {
        ruleID != nil && state != .pausedConfirm
    }

    /// The Apply button's disabled rule — web `disabled={proposal == null || isBusy}`.
    public static func applyDisabled(hasProposal: Bool, state: AlertTuningStreamState) -> Bool {
        !hasProposal || isBusy(state)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds VoiceOver strings from already-localized parts, so the spoken content is asserted without
/// rendering the view.
public enum AlertTuningAccessibility {
    /// The Suggest button's spoken name — web `aria-label = "{askHelix} · {buttonLabel}"`.
    public static func actionLabel(ask: String, context: String) -> String {
        "\(ask) · \(context)"
    }

    /// The output panel's spoken label — "{title}: {body}".
    public static func outputLabel(_ title: String, _ body: String) -> String {
        "\(title): \(body)"
    }

    /// One proposed-patch row spoken as "{field}: {value}" (the literal schema field + its value).
    public static func proposalRow(field: String, value: String) -> String {
        "\(field): \(value)"
    }
}
