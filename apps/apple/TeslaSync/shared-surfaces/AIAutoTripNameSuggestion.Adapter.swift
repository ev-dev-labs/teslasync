//
//  AIAutoTripNameSuggestion.Adapter.swift
//  TeslaSync — P4 shared surface · 0007 · AIAutoTripNameSuggestion (Apple)
//
//  The testable, dependency-light core for the auto trip-name suggestion surface — the SwiftUI
//  parity of `components/ai/AIAutoTripNameSuggestion.tsx`. Everything here is pure (Foundation
//  only): the AI stream lifecycle (web `AiStreamState`), the discriminated event union (web
//  `AiStreamEvent`), the structured rate-limit info (web `AiLimitInfo`), the accumulated stream
//  snapshot (web `useAiStream` result), the verbatim port of the hook's `parseSSEFrame` /
//  `toTypedEvent` SSE parser and its `handleEvent` reducer, the `useMemo` draft-URL builder, and
//  the VoiceOver label builders. No store, no bundle, no rendered view, so each piece is unit
//  tested in isolation.
//
//  Parity note: the web surface is an `AIFeatureCard` driven by `useAiStream`. The feature POSTs
//  an empty body to `/ai/trips/{tripID}/name/draft` and renders the streamed, propose-only name
//  suggestion. This core reproduces that exact data path: the SSE frame → typed event mapping,
//  the delta-accumulation + terminal done/error reduction, and the draft endpoint the hook opens.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a
/// bundle: the production app passes the P1/S10 facade, while tests pass the identity resolver.
public typealias AITripNameResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing AI stream lifecycle — the native mirror of the web `AiStreamState`
/// (`'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'`). `pausedConfirm` is reached
/// when a `confirm_request` frame arrives; the server then closes the connection and the surface
/// keeps the paused state until a fresh `start()` against the continuation endpoint.
public enum AiStreamLifecycle: String, Sendable, Equatable, CaseIterable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error
}

// MARK: - Structured rate-limit info (web `AiLimitInfo`)

/// The structured rate-limit / cost-cap info parsed from a terminal `error` SSE frame (web
/// `AiLimitInfo`). Only present when the frame carried a `reason`; legacy plain-error frames
/// yield `nil`, which the surface treats as "fall back to the generic error tile".
public struct AiLimitInfo: Sendable, Equatable {
    public let reason: String
    public let retryAfterS: Int
    public let bannerLevel: String
    public let baselineAvailable: Bool
    public let message: String

    public init(
        reason: String,
        retryAfterS: Int,
        bannerLevel: String,
        baselineAvailable: Bool,
        message: String
    ) {
        self.reason = reason
        self.retryAfterS = retryAfterS
        self.bannerLevel = bannerLevel
        self.baselineAvailable = baselineAvailable
        self.message = message
    }
}

// MARK: - Event union (web `AiStreamEvent`)

/// The discriminated union of every event the backend SSE writer emits — the native mirror of
/// the web `AiStreamEvent`. The discriminator is the case; the payloads match the typed Go
/// structs in `internal/ai/stream/writer.go`.
public enum AiStreamEvent: Sendable, Equatable {
    case delta(text: String)
    case toolCall(id: String, name: String)
    case toolResult(id: String, name: String, ok: Bool, error: String?)
    case confirmRequest(continuationID: String, tool: String, summary: String)
    case done(finishReason: String, usageIn: Int, usageOut: Int)
    case error(
        message: String,
        reason: String?,
        retryAfterS: Int?,
        bannerLevel: String?,
        baselineAvailable: Bool?
    )
}

// MARK: - Stream snapshot (web `useAiStream` reactive result)

/// The accumulated, view-ready stream state — the native mirror of the reactive surface the web
/// `useAiStream` hook exposes (`state`, `text`, `error`, `limit`). A pure value so the reducer
/// and the projection are exhaustively testable without a live connection.
public struct AiStreamSnapshot: Sendable, Equatable {
    public var lifecycle: AiStreamLifecycle
    public var text: String
    public var error: String?
    public var limit: AiLimitInfo?

    public init(
        lifecycle: AiStreamLifecycle = .idle,
        text: String = "",
        error: String? = nil,
        limit: AiLimitInfo? = nil
    ) {
        self.lifecycle = lifecycle
        self.text = text
        self.error = error
        self.limit = limit
    }

    /// The idle snapshot before any stream has run (web initial state).
    public static let idle = AiStreamSnapshot()

    /// The freshly-opened snapshot — the verbatim port of the web `start()` reset block
    /// (`setState('streaming'); setText(''); setError(null); setLimit(null)`).
    public static let started = AiStreamSnapshot(lifecycle: .streaming)

    /// `true` once a stream has run at least once — the web `AiOutputPanel` visibility gate
    /// (`text || streaming || error || done`). Drives whether the output panel renders content.
    public var hasOutput: Bool {
        !text.isEmpty || lifecycle == .streaming || lifecycle == .error || lifecycle == .done
    }
}

// MARK: - Reducer (verbatim port of the web `handleEvent` switch)

/// Pure reduction of one parsed event onto the accumulated snapshot — the native port of the
/// web hook's `handleEvent` (delta appends, confirm pauses, done/​error terminate, tool frames
/// are inert) plus the `start()` reset. Unit tested event-for-event.
public enum AiStreamReducer {
    /// The web `start()` transition: streaming with a cleared text/error/limit.
    public static func started() -> AiStreamSnapshot {
        .started
    }

    /// The web loop's terminal fallback: a stream that closes while still `streaming` is promoted
    /// to `done` (a `pausedConfirm`/terminal state is left untouched).
    public static func closed(_ snapshot: AiStreamSnapshot) -> AiStreamSnapshot {
        guard snapshot.lifecycle == .streaming else { return snapshot }
        var next = snapshot
        next.lifecycle = .done
        return next
    }

    /// The web cancel path: an in-flight stream returns to `idle`; a terminal state is untouched.
    public static func cancelled(_ snapshot: AiStreamSnapshot) -> AiStreamSnapshot {
        guard snapshot.lifecycle == .streaming else { return snapshot }
        var next = snapshot
        next.lifecycle = .idle
        return next
    }

    /// The web `finalizeError`: capture the message and flip to `error`.
    public static func failed(_ snapshot: AiStreamSnapshot, message: String) -> AiStreamSnapshot {
        var next = snapshot
        next.error = message
        next.lifecycle = .error
        return next
    }

    /// Reduce one event onto the snapshot — the body of the web `handleEvent` switch.
    public static func reduce(_ snapshot: AiStreamSnapshot, _ event: AiStreamEvent) -> AiStreamSnapshot {
        var next = snapshot
        switch event {
        case let .delta(text):
            next.text += text
        case .toolCall, .toolResult:
            break
        case .confirmRequest:
            next.lifecycle = .pausedConfirm
        case .done:
            next.lifecycle = .done
        case let .error(message, reason, retryAfterS, bannerLevel, baselineAvailable):
            if let reason, !reason.isEmpty {
                next.limit = AiLimitInfo(
                    reason: reason,
                    retryAfterS: retryAfterS ?? 0,
                    bannerLevel: bannerLevel ?? "",
                    baselineAvailable: baselineAvailable ?? true,
                    message: message
                )
            }
            next.error = message
            next.lifecycle = .error
        }
        return next
    }
}

// MARK: - SSE frame parser (verbatim port of the web `parseSSEFrame` + `toTypedEvent`)

/// Parses a single SSE block into a typed `AiStreamEvent` — the native port of the web
/// `parseSSEFrame` + `toTypedEvent`. Returns `nil` on a malformed or unknown frame so the
/// consumer can skip it instead of corrupting the stream (web "future server adds an event a
/// older client drops"). Pure; covered field-by-field by the tests.
public enum AiSseFrameParser {
    /// Parse the raw multi-line frame (no trailing blank line) into an event, or `nil`.
    public static func parse(_ raw: String) -> AiStreamEvent? {
        var event = ""
        var dataParts: [String] = []
        for line in raw.components(separatedBy: "\n") {
            if line.hasPrefix(":") {
                continue
            } else if line.hasPrefix("event: ") {
                event = String(line.dropFirst("event: ".count))
            } else if line.hasPrefix("data: ") {
                dataParts.append(String(line.dropFirst("data: ".count)))
            } else if line.hasPrefix("event:") {
                event = trimLeadingSpaces(String(line.dropFirst("event:".count)))
            } else if line.hasPrefix("data:") {
                dataParts.append(trimLeadingSpaces(String(line.dropFirst("data:".count))))
            }
        }
        guard !event.isEmpty else { return nil }
        let dataStr = dataParts.joined(separator: "\n")
        guard !dataStr.isEmpty,
              let bytes = dataStr.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: bytes),
              let dict = object as? [String: Any]
        else { return nil }
        return toTypedEvent(event, dict)
    }

    /// Narrow `(event, data)` into the union — the web `toTypedEvent` switch. Each arm delegates to
    /// a small per-event builder so the dispatch stays flat (the `typeof` field guards live in the
    /// builders + the JSON scalar helpers below).
    static func toTypedEvent(_ event: String, _ data: [String: Any]) -> AiStreamEvent? {
        switch event {
        case "delta": parseDelta(data)
        case "tool_call": parseToolCall(data)
        case "tool_result": parseToolResult(data)
        case "confirm_request": parseConfirm(data)
        case "done": parseDone(data)
        case "error": parseError(data)
        default: nil
        }
    }

    private static func parseDelta(_ data: [String: Any]) -> AiStreamEvent? {
        guard let text = string(data["text"]) else { return nil }
        return .delta(text: text)
    }

    private static func parseToolCall(_ data: [String: Any]) -> AiStreamEvent? {
        guard let id = string(data["id"]), let name = string(data["name"]) else { return nil }
        return .toolCall(id: id, name: name)
    }

    private static func parseToolResult(_ data: [String: Any]) -> AiStreamEvent? {
        guard let id = string(data["id"]),
              let name = string(data["name"]),
              let ok = bool(data["ok"])
        else { return nil }
        return .toolResult(id: id, name: name, ok: ok, error: string(data["error"]))
    }

    private static func parseConfirm(_ data: [String: Any]) -> AiStreamEvent? {
        guard let continuationID = string(data["continuation_id"]),
              let tool = string(data["tool"]),
              let summary = string(data["summary"])
        else { return nil }
        return .confirmRequest(continuationID: continuationID, tool: tool, summary: summary)
    }

    private static func parseDone(_ data: [String: Any]) -> AiStreamEvent? {
        let usage = data["usage"] as? [String: Any]
        return .done(
            finishReason: string(data["finish_reason"]) ?? "stop",
            usageIn: number(usage?["in"]).map { Int($0) } ?? 0,
            usageOut: number(usage?["out"]).map { Int($0) } ?? 0
        )
    }

    private static func parseError(_ data: [String: Any]) -> AiStreamEvent? {
        let rawBanner = string(data["banner_level"])
        let bannerLevel = (rawBanner == "warn" || rawBanner == "critical" || rawBanner == "")
            ? rawBanner : nil
        return .error(
            message: string(data["message"]) ?? "unknown",
            reason: string(data["reason"]),
            retryAfterS: number(data["retry_after_s"]).map { Int($0) },
            bannerLevel: bannerLevel,
            baselineAvailable: bool(data["baseline_available"])
        )
    }

    // MARK: JSON scalar helpers (mirror the web `typeof` guards)

    /// `typeof value === 'string'`.
    static func string(_ value: Any?) -> String? {
        value as? String
    }

    /// `typeof value === 'boolean'` — excludes numbers (which bridge to `NSNumber` too) by
    /// checking the CoreFoundation boolean type id, so `ok: 1` is rejected exactly as the web's
    /// `typeof !== 'boolean'` guard rejects it.
    static func bool(_ value: Any?) -> Bool? {
        guard let value, CFGetTypeID(value as CFTypeRef) == CFBooleanGetTypeID() else { return nil }
        return (value as? NSNumber)?.boolValue
    }

    /// `typeof value === 'number'` — excludes booleans for the same reason as `bool(_:)`.
    static func number(_ value: Any?) -> Double? {
        guard let value, CFGetTypeID(value as CFTypeRef) != CFBooleanGetTypeID() else { return nil }
        return (value as? NSNumber)?.doubleValue
    }

    private static func trimLeadingSpaces(_ value: String) -> String {
        String(value.drop(while: { $0 == " " }))
    }
}

// MARK: - Draft endpoint (web `useMemo` URL builder)

/// Builds the propose-only draft path the stream is opened against — the native port of the web
/// `useMemo` (`tripId ? '/ai/trips/{encoded}/name/draft' : '/ai/trips/0/name/draft'`). Pure +
/// deterministic so the encoding + fallback are asserted.
public enum AITripNameEndpoint {
    /// The AI feature id this surface is gated by (web `withAiFeature('auto-trip-naming', …)`).
    public static let featureID = "auto-trip-naming"

    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIAutoTripNameSuggestion"

    /// The draft path for a trip, or the `0` sentinel when no trip is bound (web fallback).
    public static func draftPath(tripID: String?) -> String {
        guard let tripID, !tripID.isEmpty else { return "/ai/trips/0/name/draft" }
        return "/ai/trips/\(encode(tripID))/name/draft"
    }

    /// `encodeURIComponent` parity — percent-encodes everything except the JS unreserved set
    /// (`A-Za-z0-9 - _ . ! ~ * ' ( )`).
    static func encode(_ component: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.!~*'()")
        return component.addingPercentEncoding(withAllowedCharacters: allowed) ?? component
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken content is
/// asserted without rendering the view. The action button reads the universal Helix CTA then the
/// per-feature verb (web `aria-label = "{askHelix} · {buttonLabel}"`); the output reads its role
/// then its content.
public enum AITripNameAccessibility {
    /// The action button's accessibility label: "{askHelix} · {buttonLabel}" (web aria-label).
    public static func actionLabel(askHelix: String, buttonLabel: String) -> String {
        "\(askHelix) · \(buttonLabel)"
    }

    /// The streamed-suggestion output label: "{role}: {text}".
    public static func suggestionLabel(role: String, text: String) -> String {
        "\(role): \(text)"
    }

    /// The error output label: "{errorLabel} {message}" (web "Helix error: {error}").
    public static func errorLabel(prefix: String, message: String) -> String {
        "\(prefix) \(message)"
    }
}
