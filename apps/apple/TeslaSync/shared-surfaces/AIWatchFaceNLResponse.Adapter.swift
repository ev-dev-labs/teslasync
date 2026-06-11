//
//  AIWatchFaceNLResponse.Adapter.swift
//  TeslaSync — P4 shared surface · 0060 · AIWatchFaceNLResponse (Apple)
//
//  The testable projection core for the "Ask Helix about your watch face" panel — the
//  SwiftUI parity of components/ai/AIWatchFaceNLResponse.tsx. Everything here is pure +
//  dependency-free (Foundation only — no SwiftUI, no Observation, no network), so the
//  request-body projection (the web `body` useMemo + `trimmedMessage`), the within-cap gate
//  (web `messageWithinCap`), and the derived `canStart` are all unit tested in isolation
//  without rendering a view.
//
//  Parity note: the web component computes
//    trimmedMessage   = message.trim()
//    body             = { message: trimmedMessage.length > 0 ? trimmedMessage : undefined }
//    messageWithinCap = trimmedMessage.length <= MaxMessageChars
//    canStart         = messageWithinCap && stream.state !== 'paused-confirm'
//  `WatchFaceNLRequest.project(rawMessage:)` reproduces that walk exactly: an empty/whitespace
//  prompt projects to `message == nil` (web `undefined` → the body serialises as `{}` and the
//  backend falls back to its deterministic glance-summary prompt), and the cap mirrors the
//  handler's `aiWatchFaceNLResponseMaxMessageLen` so a parser-rejection 400 never reaches the
//  user. The `paused-confirm` half of `canStart` is a stream-lifecycle concern and lives in
//  `WatchFaceNLLogic`, not the request body.
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id + wiring contract)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`), the
/// AI feature id the web `withAiFeature` gates on, and the backend route the web `useAiStream`
/// opens. Kept here (SwiftUI-free) so the state-holder can emit telemetry and the production
/// source can target the route without depending on the view layer.
public enum WatchFaceNLSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AIWatchFaceNLResponse"
    /// The AI feature id (web `withAiFeature('watch-face-nl-response', …)`).
    public static let featureID = "watch-face-nl-response"
    /// The SSE route the web `useAiStream` opens (POST), sans the `/api/v1` prefix the client
    /// prepends — wired in the backend feature registry + guard-wrapped by
    /// `guard.Wrap('watch-face-nl-response')` (web wiring contract).
    public static let endpointPath = "/ai/watch/respond"
}

// MARK: - Constants (web `MaxMessageChars`)

/// Static caps mirrored from the web component. `maxMessageChars` mirrors the backend
/// handler's `aiWatchFaceNLResponseMaxMessageLen` cap so a parser-rejection 400 never reaches
/// the user — the prompt field enforces it and `WatchFaceNLRequest.isWithinCap` guards it.
public enum WatchFaceNLConstants {
    /// Web `MaxMessageChars = 1000`.
    public static let maxMessageChars = 1000
}

// MARK: - Request projection (web `body` useMemo + `trimmedMessage`)

/// The projected POST body for `/ai/watch/respond` — the native mirror of the web `body`
/// useMemo. The free-form prompt is trimmed (web `trimmedMessage`); an empty/whitespace prompt
/// projects to `message == nil`, which serialises as `{}` so the backend applies its
/// deterministic glance-summary default (web sends `message: undefined`). The view never
/// builds this directly — the model projects it from the user's prompt before handing it to
/// the source's `startStream`.
public struct WatchFaceNLRequest: Equatable, Sendable {
    /// The trimmed prompt, or `nil` when the user left the field empty (web `undefined` →
    /// default glance summary). The wire body omits the key entirely when this is `nil`.
    public let message: String?

    public init(message: String?) {
        self.message = message
    }

    /// Native port of the web `body` useMemo: trim the raw prompt (web `message.trim()`) and
    /// drop it to `nil` when empty so the body matches `{ message?: string }` exactly.
    public static func project(rawMessage: String) -> WatchFaceNLRequest {
        let trimmed = rawMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        return WatchFaceNLRequest(message: trimmed.isEmpty ? nil : trimmed)
    }

    /// Web `messageWithinCap = trimmedMessage.length <= MaxMessageChars`. An empty prompt
    /// (`message == nil`, length 0) is always within the cap — empty is allowed.
    public var isWithinCap: Bool {
        (message?.count ?? 0) <= WatchFaceNLConstants.maxMessageChars
    }

    /// The request-body half of the web `canStart` (`messageWithinCap`). The orthogonal
    /// `state !== 'paused-confirm'` half is a stream-lifecycle concern handled in
    /// `WatchFaceNLLogic.canStart`.
    public var isWithinCapGate: Bool {
        isWithinCap
    }
}
