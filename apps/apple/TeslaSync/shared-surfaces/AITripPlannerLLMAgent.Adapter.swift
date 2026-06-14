//
//  AITripPlannerLLMAgent.Adapter.swift
//  TeslaSync — P4 shared surface · 0055 · AITripPlannerLLMAgent (Apple)
//
//  The testable, dependency-free core for the Helix trip-planner card — the SwiftUI parity of
//  web/src/components/ai/AITripPlannerLLMAgent.tsx and the shared `useAiStream` / `AIFeatureCard` /
//  `AiOutputPanel` primitives it composes. Pure Foundation, so the request body, SSE parsing, stream
//  reducer, and output / action derivations are unit tested against the exact web expressions.
//
//  Parity notes (reproduced from the web source — do NOT "fix" the behaviour):
//    • inputs rule = `haveInputs = !!vehicleId && origin != null && destination != null` (a non-zero
//      vehicle id AND both corridor endpoints; negatives stay truthy, mirroring JS `!!(-3)`).
//    • request body = the 7-field object posted to POST /ai/trips/plan/draft (snake_case; nested
//      origin/destination `{ lat, lng, name }`). `vehicle_id = numericVehicleId || 0`; a missing
//      endpoint ships `{ lat: 0, lng: 0, name: '' }`; every scalar `?? <web default>`. The id lives in
//      the BODY (verbatim web wire keys); the URL is a bare static route to the SAME backend endpoint.
//    • float bytes = encoded with `JSONEncoder` (shortest round-trippable form), so `speed_factor: 1.0`
//      → `1` and a coordinate → `37.7749` — byte-faithful to JS `JSON.stringify` (`JSONSerialization`
//      would corrupt fractional doubles to `37.774900000000002`).
//    • SSE + reducer = port of `parseSSEFrame` / `toTypedEvent` + `handleEvent` / `finalizeError`:
//      idle → streaming → (done | error); `delta` accumulates; `confirm_request` pauses; a non-OK HTTP
//      response finalises as "stream_http_{status}"; comments / malformed / unknown / `tool_*` no-op.
//

import Foundation

// MARK: - Location (web `TripLocationLike`)

/// A corridor endpoint — the native mirror of the web `TripLocationLike` (`{ lat, lng, name? }`). The
/// `name` is optional (the web `name?` prop); the encoded body coalesces a missing name to `""`.
public struct TripPlannerAgentLocation: Sendable, Equatable {
    public var lat: Double
    public var lng: Double
    public var name: String?

    public init(lat: Double, lng: Double, name: String? = nil) {
        self.lat = lat
        self.lng = lng
        self.name = name
    }
}

// MARK: - Request (web `useAiStream({ url, body })`)

/// The trip-plan draft request — the native mirror of the web
/// `useAiStream({ url: '/ai/trips/plan/draft', body: { … } })`. `vehicleID` + `origin` + `destination`
/// drive `haveInputs`; the remaining optional plan parameters mirror the web `number` props and fall
/// back to the web defaults in the encoded body. The field names reproduce the web wire contract
/// verbatim (this surface posts to the SAME existing backend endpoint).
public struct TripPlannerAgentRequest: Sendable, Equatable {
    /// The bare route the stream is opened against (the client prepends `/api/v1`, web convention).
    public static let path = "/ai/trips/plan/draft"

    // Gating inputs (web `haveInputs = !!vehicleId && origin != null && destination != null`).
    public var vehicleID: Int?
    public var origin: TripPlannerAgentLocation?
    public var destination: TripPlannerAgentLocation?
    // Plan parameters (web `number` props; defaulted in the body).
    public var currentSoc: Int?
    public var chargeLimitSoc: Int?
    public var minArrivalSoc: Int?
    public var speedFactor: Double?

    public init(
        vehicleID: Int?,
        origin: TripPlannerAgentLocation? = nil,
        destination: TripPlannerAgentLocation? = nil,
        currentSoc: Int? = nil,
        chargeLimitSoc: Int? = nil,
        minArrivalSoc: Int? = nil,
        speedFactor: Double? = nil
    ) {
        self.vehicleID = vehicleID
        self.origin = origin
        self.destination = destination
        self.currentSoc = currentSoc
        self.chargeLimitSoc = chargeLimitSoc
        self.minArrivalSoc = minArrivalSoc
        self.speedFactor = speedFactor
    }

    /// Web `haveInputs = !!vehicleId && origin != null && destination != null`: a non-zero vehicle id
    /// AND both corridor endpoints present. Negatives stay truthy (mirroring JS `!!`).
    public var haveInputs: Bool {
        (vehicleID ?? 0) != 0 && origin != nil && destination != nil
    }

    /// The encoded snake_case JSON body — field names verbatim from the web wire contract; values
    /// mirror `numericVehicleId || 0`, the `origin ? {…} : { lat: 0, lng: 0, name: '' }` fallback, and
    /// the `?? default` scalar fallbacks. Keys are sorted so the bytes are deterministic under test.
    /// `JSONEncoder` keeps fractional coordinates byte-faithful to JS `JSON.stringify`.
    public func encodedBody() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(body)
    }

    /// The encodable body payload — the native mirror of the web `useMemo` object.
    var body: TripPlannerAgentRequestBody {
        TripPlannerAgentRequestBody(
            vehicleID: vehicleID ?? 0,
            origin: TripPlannerAgentEndpoint(origin),
            destination: TripPlannerAgentEndpoint(destination),
            currentSoc: currentSoc ?? 80,
            chargeLimitSoc: chargeLimitSoc ?? 90,
            minArrivalSoc: minArrivalSoc ?? 20,
            speedFactor: speedFactor ?? 1.0
        )
    }
}

/// One encoded corridor endpoint — web `origin ? { lat, lng, name: name ?? '' } : { lat: 0, lng: 0,
/// name: '' }`.
struct TripPlannerAgentEndpoint: Encodable, Equatable {
    let lat: Double
    let lng: Double
    let name: String

    init(_ location: TripPlannerAgentLocation?) {
        lat = location?.lat ?? 0
        lng = location?.lng ?? 0
        name = location?.name ?? ""
    }
}

/// The snake_case wire body. `Encodable` (not `[String: Any]`) so `JSONEncoder` renders fractional
/// coordinates with the shortest round-trippable form — byte-faithful to JS `JSON.stringify`.
struct TripPlannerAgentRequestBody: Encodable, Equatable {
    let vehicleID: Int
    let origin: TripPlannerAgentEndpoint
    let destination: TripPlannerAgentEndpoint
    let currentSoc: Int
    let chargeLimitSoc: Int
    let minArrivalSoc: Int
    let speedFactor: Double

    enum CodingKeys: String, CodingKey {
        case vehicleID = "vehicle_id"
        case origin
        case destination
        case currentSoc = "current_soc"
        case chargeLimitSoc = "charge_limit_soc"
        case minArrivalSoc = "min_arrival_soc"
        case speedFactor = "speed_factor"
    }
}

// MARK: - Stream events (web `AiStreamEvent` union)

/// The discriminated stream event — the native port of the web `AiStreamEvent` union (only the
/// fields the card reads are typed; `tool_*` / `confirm_request` carry enough to assert the no-ops).
public enum TripPlannerAgentStreamEvent: Sendable, Equatable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(id: String, name: String, ok: Bool)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String, usageIn: Int, usageOut: Int)
    case failure(message: String)
}

// MARK: - SSE frame parsing (web `parseSSEFrame` + `toTypedEvent`)

/// A single SSE frame parser — the native port of web `parseSSEFrame` + `toTypedEvent`: reads
/// `event:` / `data:` lines (with or without the space), skips `:`-comments, JSON-decodes the joined
/// `data`, and narrows to a typed event (`nil` for an eventless / malformed / unknown frame).
public enum TripPlannerAgentSSEFrame {
    public static func parse(_ raw: String) -> TripPlannerAgentStreamEvent? {
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

    /// Decodes the joined `data` payload into a JSON object — `nil` for empty / non-object / failure.
    private static func decodeObject(_ dataString: String) -> [String: Any]? {
        guard !dataString.isEmpty, let bytes = dataString.data(using: .utf8) else { return nil }
        let parsed = try? JSONSerialization.jsonObject(with: bytes)
        return parsed as? [String: Any]
    }

    /// Narrows a parsed `(event, data)` pair into the typed union (port of `toTypedEvent`); an unknown
    /// event or a payload missing required fields yields `nil`, with per-event decoders below.
    private static func typedEvent(event: String, data: [String: Any]) -> TripPlannerAgentStreamEvent? {
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

    private static func delta(_ data: [String: Any]) -> TripPlannerAgentStreamEvent? {
        guard let text = data["text"] as? String else { return nil }
        return .delta(text: text)
    }

    private static func toolCall(_ data: [String: Any]) -> TripPlannerAgentStreamEvent? {
        guard let id = data["id"] as? String, let name = data["name"] as? String else { return nil }
        return .toolCall(id: id, name: name)
    }

    private static func toolResult(_ data: [String: Any]) -> TripPlannerAgentStreamEvent? {
        guard let id = data["id"] as? String,
              let name = data["name"] as? String,
              let ok = data["ok"] as? Bool else { return nil }
        return .toolResult(id: id, name: name, ok: ok)
    }

    private static func confirmRequest(_ data: [String: Any]) -> TripPlannerAgentStreamEvent? {
        guard let continuationID = data["continuation_id"] as? String,
              let tool = data["tool"] as? String,
              let summary = data["summary"] as? String else { return nil }
        return .confirmRequest(continuationID: continuationID, tool: tool, summary: summary)
    }

    private static func done(_ data: [String: Any]) -> TripPlannerAgentStreamEvent {
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
    /// Drops leading ASCII spaces — the native peer of the web `.trimStart()` on the no-space form.
    func trimmingPrefixSpaces() -> String {
        var view = self[...]
        while view.first == " " {
            view = view.dropFirst()
        }
        return String(view)
    }
}

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the native port of `AiStreamState`.
public enum TripPlannerAgentStreamState: String, Sendable, Equatable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error
}

/// One immutable view of the stream — `state` + accumulated `text` + terminal `error`.
public struct TripPlannerAgentStreamSnapshot: Sendable, Equatable {
    public var state: TripPlannerAgentStreamState
    public var text: String
    public var error: String?

    public init(
        state: TripPlannerAgentStreamState = .idle,
        text: String = "",
        error: String? = nil
    ) {
        self.state = state
        self.text = text
        self.error = error
    }

    /// The pristine, never-started snapshot (web initial `idle` / empty text / no error).
    public static let idle = TripPlannerAgentStreamSnapshot()
}

/// The pure stream reducer — the native port of `useAiStream`'s `handleEvent` + `finalizeError`.
/// Folding the parsed events over `start()` reproduces the web accumulation exactly (delta concat,
/// terminal `done` / `error`, `confirm_request` pause, `tool_*` no-ops, `stream_http_{status}`).
public enum TripPlannerAgentStreamReducer {
    /// The snapshot at `start()` — web `setState('streaming'); setText(''); setError(null)`.
    public static func start() -> TripPlannerAgentStreamSnapshot {
        TripPlannerAgentStreamSnapshot(state: .streaming, text: "", error: nil)
    }

    /// Applies one event to a snapshot (web `handleEvent`).
    public static func reduce(
        _ snapshot: TripPlannerAgentStreamSnapshot,
        _ event: TripPlannerAgentStreamEvent
    ) -> TripPlannerAgentStreamSnapshot {
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

    /// Folds a sequence of events over a fresh `start()` snapshot — replays a whole frame sequence.
    public static func fold(_ events: [TripPlannerAgentStreamEvent]) -> TripPlannerAgentStreamSnapshot {
        events.reduce(start()) { reduce($0, $1) }
    }

    /// A non-OK HTTP response finalises as "stream_http_{status}" (web `finalizeError`).
    public static func httpFailure(status: Int) -> TripPlannerAgentStreamSnapshot {
        TripPlannerAgentStreamSnapshot(state: .error, text: "", error: "stream_http_\(status)")
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

/// The structural output-panel branch — the native port of the `AiOutputPanel` render (no localized
/// prose, applied in projection) so the branch order is asserted in isolation.
public enum TripPlannerAgentOutputKind: Sendable, Equatable {
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
public enum TripPlannerAgentOutput {
    public static func derive(
        _ snapshot: TripPlannerAgentStreamSnapshot
    ) -> TripPlannerAgentOutputKind {
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

/// The Ask-Helix action's derived flags — the `AIFeatureCard` button contract: the label flips on
/// `isStreaming`, disabled when `!canStart` or streaming (web `disabled = !canStart || isStreaming`).
public struct TripPlannerAgentAction: Sendable, Equatable {
    public let isStreaming: Bool
    public let isDisabled: Bool

    public init(isStreaming: Bool, isDisabled: Bool) {
        self.isStreaming = isStreaming
        self.isDisabled = isDisabled
    }

    /// Derives the flags from the gate (`canStart = haveInputs`) and the stream state.
    public static func derive(
        canStart: Bool,
        state: TripPlannerAgentStreamState
    ) -> TripPlannerAgentAction {
        let streaming = state == .streaming
        return TripPlannerAgentAction(isStreaming: streaming, isDisabled: !canStart || streaming)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds VoiceOver strings from already-localized parts, asserted without rendering the view.
public enum TripPlannerAgentAccessibility {
    /// The action button's spoken name — web `aria-label = "{askHelix} · {buttonLabel}"`.
    public static func actionLabel(ask: String, context: String) -> String {
        "\(ask) · \(context)"
    }

    /// The output panel's spoken label — "{title}: {body}".
    public static func outputLabel(_ title: String, _ body: String) -> String {
        "\(title): \(body)"
    }
}
