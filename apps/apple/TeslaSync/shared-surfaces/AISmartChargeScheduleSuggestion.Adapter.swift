//
//  AISmartChargeScheduleSuggestion.Adapter.swift
//  TeslaSync — P4 shared surface · 0047 · AISmartChargeScheduleSuggestion (Apple)
//
//  The testable, dependency-free core for the Helix smart-charge-schedule card — the SwiftUI parity
//  of web/src/components/ai/AISmartChargeScheduleSuggestion.tsx and the shared `useAiStream` /
//  `AIFeatureCard` / `AiOutputPanel` primitives it composes. Pure Foundation (no store, SwiftUI, or
//  bundle), so the request body, SSE parsing, stream reducer, and output / action derivations are
//  unit tested in isolation against the exact web expressions.
//
//  Parity notes (reproduced from the web source — do NOT "fix" the behaviour):
//    • inputs rule    = `haveInputs = !!vehicleId && !!ratePlanId` — BOTH a truthy (non-zero) vehicle
//                       id AND a non-empty rate plan id (DISTINCT from the predictive surface's single
//                       `> 0` gate; negatives stay truthy, mirroring `!!(-3)`).
//    • request body   = the 9-field object posted to POST /ai/charging/schedule/draft (snake_case;
//                       `vehicle_id` = `numericVehicleId || 0`, every other field `?? <web default>`).
//                       The field names mirror the web wire contract verbatim — this is a frontend
//                       parity surface posting to the SAME existing backend route, not a new Go/DB
//                       field. The id lives in the BODY; the URL is a bare static route.
//    • depart_by      = web `(!departBy) ? now : (isNaN ? now : d).toISOString()`. The native picker
//                       yields a `Date?`; the adapter formats it as a JS-`toISOString()`-shaped UTC
//                       instant and falls back to an injected `now` — so depart_by is ALWAYS present.
//    • SSE + reducer  = port of `parseSSEFrame` / `toTypedEvent` and `handleEvent` / `finalizeError`:
//                       `event:`/`data:` lines, comments + malformed + unknown frames dropped; idle →
//                       streaming → (done | error); `delta` accumulates; `confirm_request` pauses; a
//                       non-OK HTTP response finalises as "stream_http_{status}"; `tool_*` are no-ops.
//    • AiOutputPanel  = nothing while idle+empty; "Helix error: {message}" in error; the thinking
//                       indicator while streaming before the first delta; else the accumulated prose.
//

import Foundation

// MARK: - Request (web `useAiStream({ url, body })`)

/// The smart-charge-schedule draft request — the native mirror of the web
/// `useAiStream({ url: '/ai/charging/schedule/draft', body: { … } })`. `vehicleID` + `ratePlanID`
/// drive `haveInputs`; the remaining optional schedule parameters mirror the web `number` / `boolean`
/// props and fall back to the web defaults in the encoded body. The field names reproduce the web
/// wire contract verbatim (this surface posts to the SAME existing backend endpoint).
public struct SmartChargeScheduleRequest: Sendable, Equatable {
    /// The bare route the stream is opened against (the client prepends `/api/v1`, web convention).
    public static let path = "/ai/charging/schedule/draft"

    // Gating inputs (web `haveInputs = !!vehicleId && !!ratePlanId`).
    public var vehicleID: Int?
    public var ratePlanID: String?
    // Schedule parameters (web `number` / `boolean` props; defaulted in the body).
    public var targetSoc: Int?
    public var currentSoc: Int?
    /// The selected departure instant (native date picker); the web normalizes a datetime-local
    /// string the same way. `nil` falls back to `now` (the body always carries one).
    public var departBy: Date?
    public var maxAmps: Int?
    public var batteryCapacityKwh: Int?
    public var chargerVoltage: Int?
    public var preferOffPeak: Bool?
    /// The clock used for the `depart_by` fallback (web `new Date()`). Injected for deterministic bytes.
    public var now: Date

    public init(
        vehicleID: Int?,
        ratePlanID: String? = nil,
        targetSoc: Int? = nil,
        currentSoc: Int? = nil,
        departBy: Date? = nil,
        maxAmps: Int? = nil,
        batteryCapacityKwh: Int? = nil,
        chargerVoltage: Int? = nil,
        preferOffPeak: Bool? = nil,
        now: Date = Date()
    ) {
        self.vehicleID = vehicleID
        self.ratePlanID = ratePlanID
        self.targetSoc = targetSoc
        self.currentSoc = currentSoc
        self.departBy = departBy
        self.maxAmps = maxAmps
        self.batteryCapacityKwh = batteryCapacityKwh
        self.chargerVoltage = chargerVoltage
        self.preferOffPeak = preferOffPeak
        self.now = now
    }

    /// Web `haveInputs = !!vehicleId && !!ratePlanId`: a non-zero vehicle id AND a non-empty rate plan
    /// id. Negatives stay truthy (mirroring JS `!!`), unlike the predictive surface's `> 0` rule.
    public var haveInputs: Bool {
        (vehicleID ?? 0) != 0 && !(ratePlanID ?? "").isEmpty
    }

    /// The `depart_by` ISO string — web `(!departBy) ? now : (isNaN ? now : d).toISOString()`; the
    /// native picker can't be invalid, so it is "selected instant else now" in UTC. Always present.
    public var departByISO: String {
        SmartChargeScheduleISO8601.string(from: departBy ?? now)
    }

    /// The snake_case JSON body — field names verbatim from the web wire contract; values mirror
    /// `numericVehicleId || 0` and the `?? default` fallbacks (out-of-inputs ships the unposted 0).
    public var body: [String: Any] {
        [
            "vehicle_id": vehicleID ?? 0,
            "target_soc": targetSoc ?? 80,
            "depart_by": departByISO,
            "rate_plan_id": ratePlanID ?? "",
            "max_amps": maxAmps ?? 32,
            "battery_capacity_kwh": batteryCapacityKwh ?? 75,
            "charger_voltage": chargerVoltage ?? 240,
            "prefer_off_peak": preferOffPeak ?? true,
            "current_soc": currentSoc ?? 20
        ]
    }

    /// The encoded body, keys sorted so the bytes are deterministic under test (order is irrelevant
    /// to the backend).
    public func encodedBody() throws -> Data {
        try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }
}

// MARK: - ISO-8601 instant formatting (web `Date.toISOString()`)

/// Formats a `Date` as a JS-`toISOString()`-shaped UTC instant (`yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`), so
/// the native `depart_by` matches the web wire shape. A fresh formatter per call keeps it a pure,
/// Sendable-safe function (the formatter is configured once and discarded — no shared mutable state).
public enum SmartChargeScheduleISO8601 {
    public static func string(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date)
    }
}

// MARK: - Stream events (web `AiStreamEvent` union)

/// The discriminated stream event — the native port of the web `AiStreamEvent` union. Only the
/// fields the card reads are typed; the web `onEvent`-only frames (`tool_call` / `tool_result` /
/// `confirm_request`) carry just enough to assert the parse + the (no-op) reducer behaviour.
public enum SmartChargeScheduleStreamEvent: Sendable, Equatable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(id: String, name: String, ok: Bool)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String, usageIn: Int, usageOut: Int)
    case failure(message: String)
}

// MARK: - SSE frame parsing (web `parseSSEFrame` + `toTypedEvent`)

/// A single Server-Sent-Events frame parser — the native port of the web `parseSSEFrame` +
/// `toTypedEvent`: reads `event:` / `data:` lines (with or without the space), skips `:`-comments,
/// JSON-decodes the joined `data`, and narrows the pair into a typed event — `nil` for an eventless,
/// malformed, or unknown frame so the consumer skips it without corrupting the stream.
public enum SmartChargeScheduleSSEFrame {
    public static func parse(_ raw: String) -> SmartChargeScheduleStreamEvent? {
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
    private static func typedEvent(event: String, data: [String: Any]) -> SmartChargeScheduleStreamEvent? {
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

    private static func delta(_ data: [String: Any]) -> SmartChargeScheduleStreamEvent? {
        guard let text = data["text"] as? String else { return nil }
        return .delta(text: text)
    }

    private static func toolCall(_ data: [String: Any]) -> SmartChargeScheduleStreamEvent? {
        guard let id = data["id"] as? String, let name = data["name"] as? String else { return nil }
        return .toolCall(id: id, name: name)
    }

    private static func toolResult(_ data: [String: Any]) -> SmartChargeScheduleStreamEvent? {
        guard let id = data["id"] as? String,
              let name = data["name"] as? String,
              let ok = data["ok"] as? Bool else { return nil }
        return .toolResult(id: id, name: name, ok: ok)
    }

    private static func confirmRequest(_ data: [String: Any]) -> SmartChargeScheduleStreamEvent? {
        guard let continuationID = data["continuation_id"] as? String,
              let tool = data["tool"] as? String,
              let summary = data["summary"] as? String else { return nil }
        return .confirmRequest(continuationID: continuationID, tool: tool, summary: summary)
    }

    private static func done(_ data: [String: Any]) -> SmartChargeScheduleStreamEvent {
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
public enum SmartChargeScheduleStreamState: String, Sendable, Equatable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error
}

/// One immutable view of the stream — the native peer of `useAiStream`'s reactive surface
/// (`state` + accumulated `text` + terminal `error`).
public struct SmartChargeScheduleStreamSnapshot: Sendable, Equatable {
    public var state: SmartChargeScheduleStreamState
    public var text: String
    public var error: String?

    public init(
        state: SmartChargeScheduleStreamState = .idle,
        text: String = "",
        error: String? = nil
    ) {
        self.state = state
        self.text = text
        self.error = error
    }

    /// The pristine, never-started snapshot (web initial `idle` / empty text / no error).
    public static let idle = SmartChargeScheduleStreamSnapshot()
}

/// The pure stream reducer — the native port of `useAiStream`'s `handleEvent` + `finalizeError`.
/// Folding the parsed events over `start()` reproduces the web accumulation exactly (delta concat,
/// terminal `done` / `error`, `confirm_request` pause, `tool_*` no-ops, `stream_http_{status}`).
public enum SmartChargeScheduleStreamReducer {
    /// The snapshot at `start()` — web `setState('streaming'); setText(''); setError(null)`.
    public static func start() -> SmartChargeScheduleStreamSnapshot {
        SmartChargeScheduleStreamSnapshot(state: .streaming, text: "", error: nil)
    }

    /// Applies one event to a snapshot (web `handleEvent`).
    public static func reduce(
        _ snapshot: SmartChargeScheduleStreamSnapshot,
        _ event: SmartChargeScheduleStreamEvent
    ) -> SmartChargeScheduleStreamSnapshot {
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
    public static func fold(_ events: [SmartChargeScheduleStreamEvent]) -> SmartChargeScheduleStreamSnapshot {
        events.reduce(start()) { reduce($0, $1) }
    }

    /// A non-OK HTTP response finalises the stream as an error whose message is
    /// "stream_http_{status}" (web `finalizeError('stream_http_' + res.status)`).
    public static func httpFailure(status: Int) -> SmartChargeScheduleStreamSnapshot {
        SmartChargeScheduleStreamSnapshot(state: .error, text: "", error: "stream_http_\(status)")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

/// The structural output-panel branch — the native port of the `AiOutputPanel` render, carrying no
/// localized prose (applied at the projection boundary, P1/S10) so the branch logic is asserted in
/// isolation against the web `hasAnything` / error / thinking / prose order.
public enum SmartChargeScheduleOutputKind: Sendable, Equatable {
    /// Web `!hasAnything` → the panel renders nothing; natively a friendly hint (P4 "never a blank box").
    case empty
    /// Web `text === '' && state === 'streaming'` → the thinking indicator.
    case thinking
    /// Web fallthrough → the accumulated prose.
    case prose(String)
    /// Web `state === 'error'` → "Helix error: {message}" (the localized "unknown" applied in projection).
    case failed(message: String)
}

/// Derives the output-panel branch — the exact `AiOutputPanel` order: error → (empty+streaming)
/// thinking → prose, with the leading `!hasAnything` guard mapping the untouched idle stream to empty.
public enum SmartChargeScheduleOutput {
    public static func derive(
        _ snapshot: SmartChargeScheduleStreamSnapshot
    ) -> SmartChargeScheduleOutputKind {
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
public struct SmartChargeScheduleAction: Sendable, Equatable {
    public let isStreaming: Bool
    public let isDisabled: Bool

    public init(isStreaming: Bool, isDisabled: Bool) {
        self.isStreaming = isStreaming
        self.isDisabled = isDisabled
    }

    /// Derives the flags from the gate (`canStart = haveInputs`) and the stream state.
    public static func derive(
        canStart: Bool,
        state: SmartChargeScheduleStreamState
    ) -> SmartChargeScheduleAction {
        let streaming = state == .streaming
        return SmartChargeScheduleAction(isStreaming: streaming, isDisabled: !canStart || streaming)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds VoiceOver strings from already-localized parts, so the spoken content is asserted without
/// rendering the view.
public enum SmartChargeScheduleAccessibility {
    /// The action button's spoken name — web `aria-label = "{askHelix} · {buttonLabel}"`.
    public static func actionLabel(ask: String, context: String) -> String {
        "\(ask) · \(context)"
    }

    /// The output panel's spoken label — "{title}: {body}".
    public static func outputLabel(_ title: String, _ body: String) -> String {
        "\(title): \(body)"
    }
}
