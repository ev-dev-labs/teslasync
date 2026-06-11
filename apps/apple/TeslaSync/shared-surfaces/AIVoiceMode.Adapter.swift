//
//  AIVoiceMode.Adapter.swift
//  TeslaSync — P4 shared surface · 0059 · AIVoiceMode (Apple)
//
//  The testable, dependency-free core for the Helix voice-mode panel — the SwiftUI parity of
//  web/src/components/ai/AIVoiceMode.tsx and the shared `useAiStream` + `AIFeatureCard` +
//  `AiOutputPanel` primitives it composes. Everything here is pure Foundation (no store, no
//  SwiftUI, no speech engine) so the request URL + body, the SSE frame parsing, the
//  delta-accumulating stream reducer, the TTS sentence chunker (port of `popCompleteSentences`),
//  the voice session-id minting, and the output / action derivations are unit tested in isolation
//  against the exact web expressions.
//
//  Parity notes (reproduced from the web source — do NOT "fix" the behaviour):
//    • request URL    = `'/ai/voice/chat'` — a FIXED route (the client prepends `/api/v1`). The
//                       transcribed text rides in the BODY, never the path; raw audio never leaves
//                       the device.
//    • request body   = `{ message: transcript.trim(), session_id: sessionId }` (web
//                       `useMemo(() => ({ message: transcript.trim(), session_id: sessionId }), …)`).
//                       Both are JSON strings, snake_case `session_id` per the backend contract.
//    • session id     = `voice_${Date.now()}_${rand}` — minted once per mount; the backend binds it
//                       so `stream_chatbot_response` refuses cross-session lookups.
//    • SSE frame parse= port of `parseSSEFrame` + `toTypedEvent`: `event:` / `data:` lines,
//                       `:`-prefixed comments skipped, JSON `data` decoded, an eventless or
//                       malformed or unknown frame dropped.
//    • stream reducer = idle → streaming → (done | error); `delta` frames accumulate into `text`;
//                       `confirm_request` pauses; a non-OK HTTP response finalises as
//                       "stream_http_{status}"; `tool_call` / `tool_result` do not mutate state.
//    • TTS chunker    = port of `SENTENCE_BOUNDARY_RE = /([.!?])\s+/` + `popCompleteSentences`:
//                       buffer until a sentence terminator followed by whitespace, flush the
//                       completed sentences (trimmed), keep the remainder.
//    • AiOutputPanel  = nothing while idle+empty (natively a friendly hint — the P4 "never a blank
//                       box" rule); "Helix error: {message}" in error; the thinking indicator while
//                       streaming before the first delta; else the accumulated prose.
//

import Foundation

// MARK: - Request (web `useAiStream({ url, body })`)

/// The voice-chat stream request — the native mirror of
/// `useAiStream({ url: '/ai/voice/chat', body: { message, session_id } })`. The transcript is sent
/// trimmed (web `transcript.trim()`); the session id is the per-mount stable token.
public struct VoiceModeChatRequest: Sendable, Equatable {
    /// The fixed bare route the stream is opened against (the client prepends `/api/v1`). There is
    /// no path interpolation — the transcribed text rides in the body.
    public static let path = "/ai/voice/chat"

    public var transcript: String
    public var sessionID: String

    public init(transcript: String, sessionID: String) {
        self.transcript = transcript
        self.sessionID = sessionID
    }

    /// The bare route the stream is opened against. Always the fixed voice-chat path.
    public var path: String {
        Self.path
    }

    /// The trimmed message sent to Helix — web `transcript.trim()`. Leading / trailing whitespace
    /// and newlines are stripped so the backend sees the same payload the web client sends.
    public var message: String {
        transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The JSON body — `{ "message": <trimmed>, "session_id": <id> }` (web
    /// `{ message: transcript.trim(), session_id: sessionId }`). Both values are JSON strings;
    /// `session_id` is snake_case per the backend contract.
    public var body: [String: String] {
        ["message": message, "session_id": sessionID]
    }

    /// The encoded request body. Keys are sorted for deterministic bytes under test.
    public func encodedBody() throws -> Data {
        try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
    }
}

// MARK: - Voice session id (web `newVoiceSessionId`)

/// Mints the per-mount voice session id — the native port of
/// `voice_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`. The backend accepts any
/// non-empty id and binds it to the request scope. Injectable clock + suffix keep it deterministic
/// under test.
public enum VoiceModeSession {
    public static let prefix = "voice_"

    /// Builds an id from a millisecond timestamp and an alphanumeric suffix.
    public static func id(millis: Int64, suffix: String) -> String {
        "\(prefix)\(millis)_\(suffix)"
    }

    /// Mints a fresh id from the current time and a random base-36 suffix (8 chars), matching the
    /// web shape exactly.
    public static func newID(now: Date = Date(), random: () -> String = randomSuffix) -> String {
        id(millis: Int64(now.timeIntervalSince1970 * 1000), suffix: random())
    }

    /// An 8-character base-36 suffix (`[0-9a-z]`), the native peer of
    /// `Math.random().toString(36).slice(2, 10)`.
    public static func randomSuffix() -> String {
        let alphabet = Array("0123456789abcdefghijklmnopqrstuvwxyz")
        return String((0 ..< 8).map { _ in alphabet[Int.random(in: 0 ..< alphabet.count)] })
    }
}

// MARK: - TTS sentence chunker (web `popCompleteSentences`)

/// Splits buffered assistant text into complete sentences for incremental speech — the native port
/// of `SENTENCE_BOUNDARY_RE = /([.!?])\s+/` + `popCompleteSentences`. A sentence boundary is a
/// `.`, `!`, or `?` immediately followed by whitespace; the completed sentences are returned
/// trimmed and the unterminated remainder is kept for the next delta (or the final `done` flush).
public enum VoiceModeSentenceChunker {
    public struct Result: Sendable, Equatable {
        public let spoken: [String]
        public let remainder: String

        public init(spoken: [String], remainder: String) {
            self.spoken = spoken
            self.remainder = remainder
        }
    }

    public static func pop(_ buffer: String) -> Result {
        var spoken: [String] = []
        var working = Substring(buffer)
        while let cut = nextCut(in: working) {
            let head = working[..<cut].trimmingCharacters(in: .whitespacesAndNewlines)
            if !head.isEmpty { spoken.append(head) }
            working = dropLeadingWhitespace(working[cut...])
        }
        return Result(spoken: spoken, remainder: String(working))
    }

    /// The index just past a terminator (`.`/`!`/`?`) that is followed by whitespace — web
    /// `match.index + match[1].length` (the cut sits after the terminator, before the whitespace).
    private static func nextCut(in slice: Substring) -> String.Index? {
        var index = slice.startIndex
        while index < slice.endIndex {
            let character = slice[index]
            if character == "." || character == "!" || character == "?" {
                let after = slice.index(after: index)
                if after < slice.endIndex, slice[after].isWhitespace {
                    return after
                }
            }
            index = slice.index(after: index)
        }
        return nil
    }

    /// Drops leading whitespace — web `.replace(/^\s+/, '')` on the remainder.
    private static func dropLeadingWhitespace(_ slice: Substring) -> Substring {
        var view = slice
        while let first = view.first, first.isWhitespace {
            view = view.dropFirst()
        }
        return view
    }
}

// MARK: - TTS feed coordinator (web `handleEvent` delta → speech buffering)

/// The mutable bookkeeping the TTS coordinator carries between stream snapshots — the native peer of
/// the web `ttsBufferRef` (the unspoken remainder) + the consumed-length cursor used to derive the
/// newly-arrived delta from the accumulated stream text.
public struct VoiceModeTtsFeed: Sendable, Equatable {
    public var buffer: String
    public var consumedLength: Int

    public init(buffer: String = "", consumedLength: Int = 0) {
        self.buffer = buffer
        self.consumedLength = consumedLength
    }
}

/// One coordinator step: the carried-forward `feed`, the sentences to speak now, and whether the
/// caller must cancel in-flight speech (web `error` → `speechSynthesis.cancel()`).
public struct VoiceModeTtsStep: Sendable, Equatable {
    public let feed: VoiceModeTtsFeed
    public let sentences: [String]
    public let cancelSpeech: Bool

    public init(feed: VoiceModeTtsFeed, sentences: [String], cancelSpeech: Bool) {
        self.feed = feed
        self.sentences = sentences
        self.cancelSpeech = cancelSpeech
    }
}

/// Pure text-to-speech driver — the native port of the web `handleEvent` TTS path. Diffing the
/// accumulated stream text against the consumed cursor reproduces the per-delta buffering: new text
/// is appended to the buffer, complete sentences are flushed (only while `ttsEnabled`), the buffer
/// is reset when a fresh stream begins (web `streaming && text === ''`), the unterminated tail is
/// spoken on `done`, and `error` clears the buffer + signals a speech cancel. The cursor advances
/// even while muted so toggling TTS on mid-stream speaks only subsequent deltas (web parity).
public enum VoiceModeTtsCoordinator {
    public static func step(
        feed: VoiceModeTtsFeed,
        snapshot: VoiceModeStreamSnapshot,
        ttsEnabled: Bool
    ) -> VoiceModeTtsStep {
        var buffer = feed.buffer
        var consumed = feed.consumedLength
        if snapshot.state == .streaming, snapshot.text.isEmpty {
            buffer = ""
            consumed = 0
        }
        if snapshot.state == .error {
            return VoiceModeTtsStep(
                feed: VoiceModeTtsFeed(buffer: "", consumedLength: snapshot.text.count),
                sentences: [],
                cancelSpeech: true
            )
        }
        var sentences: [String] = []
        let total = snapshot.text.count
        if total > consumed {
            let newText = String(snapshot.text.dropFirst(consumed))
            consumed = total
            if ttsEnabled {
                buffer += newText
                let result = VoiceModeSentenceChunker.pop(buffer)
                buffer = result.remainder
                sentences = result.spoken
            }
        }
        if snapshot.state == .done, ttsEnabled {
            let tail = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
            buffer = ""
            if !tail.isEmpty { sentences.append(tail) }
        }
        return VoiceModeTtsStep(
            feed: VoiceModeTtsFeed(buffer: buffer, consumedLength: consumed),
            sentences: sentences,
            cancelSpeech: false
        )
    }
}

// MARK: - Accessibility (testable seam)

/// Builds VoiceOver strings from already-localized parts, so the spoken content is asserted without
/// rendering the view.
public enum VoiceModeAccessibility {
    /// The action button's spoken name — web `aria-label = "{askHelix} · {buttonLabel}"`
    /// ("Ask Helix · Speak to Helix").
    public static func actionLabel(ask: String, context: String) -> String {
        "\(ask) · \(context)"
    }

    /// The output panel's spoken label — "{title}: {body}".
    public static func outputLabel(_ title: String, _ body: String) -> String {
        "\(title): \(body)"
    }
}
