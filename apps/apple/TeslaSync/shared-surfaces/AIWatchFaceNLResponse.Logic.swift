//
//  AIWatchFaceNLResponse.Logic.swift
//  TeslaSync — P4 shared surface · 0060 · AIWatchFaceNLResponse (Apple)
//
//  The pure state enums + decision logic + accessibility seam for the "Ask Helix about your
//  watch face" panel. Foundation-only, view-free, so the stream-lifecycle button logic (web
//  `AIFeatureCard` + `AiOutputPanel` branches), the over-cap hint, and the spoken summary are
//  all unit tested in isolation without rendering a view.
//

import Foundation

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the native port of the web
/// `'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'`. This read-only narrator never
/// reaches `pausedConfirm` (no tool needs confirmation — the strategy is narrative-only), but
/// the full union is modelled for fidelity and because the web `canStart` explicitly excludes
/// `paused-confirm`. `streaming` flips the button to "Helix is thinking…"; `error` surfaces
/// inside the output panel.
public enum WatchFaceNLStreamPhase: Equatable, Sendable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error(String)

    /// Web `stream.state === 'error'`.
    public var isError: Bool {
        if case .error = self { return true }
        return false
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound feature-gate / context snapshot — the orthogonal connectivity
/// axis rendered as the header chip + banner. `live` hides the banner; `offline` disables the
/// action (no stream is possible).
public enum WatchFaceNLConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Feature gate (web `withAiFeature` / `useAiEnabled`)

/// The AI-Off gate state (ADR-015) — the native mirror of `useAiEnabled(feature)`.
/// `loading` shows skeleton chrome while the gate resolves; `off` collapses the surface to
/// nothing (web `withAiFeature` returns `null`); `on` renders the card.
public enum WatchFaceNLGate: String, Sendable, Equatable, CaseIterable {
    case loading
    case on
    case off
}

// MARK: - Contextual hint (P4 friendly disabled state)

/// Why the "Ask Helix" action cannot start. Unlike the lifetime-stats Q&A analog, this surface
/// allows an empty prompt (the backend answers with a default glance summary), so the only
/// input-driven block is an over-cap prompt — surfaced as the friendly hint under the
/// description so a disabled button is never unexplained (P4 empty/disabled contract).
public enum WatchFaceNLHint: Equatable, Sendable {
    case overCap
}

// MARK: - Pure button / output logic (web `AIFeatureCard` + `AiOutputPanel` branches)

/// The pure, view-free decision logic ported from the web component + `AIFeatureCard` +
/// `AiOutputPanel`. Each function is a direct translation of a web boolean so the view is a
/// pure function of these and every branch is unit tested.
public enum WatchFaceNLLogic {
    /// Web `isBusy = stream.state === 'streaming'`, widened to include `paused-confirm` (the
    /// other "in-flight" lifecycle the web `canStart` guards against).
    public static func isBusy(_ phase: WatchFaceNLStreamPhase) -> Bool {
        phase == .streaming || phase == .pausedConfirm
    }

    /// Web `canStart = messageWithinCap && stream.state !== 'paused-confirm'`. An empty prompt
    /// is allowed (the within-cap gate is true at length 0); only an over-cap prompt or a
    /// paused-confirm stream blocks the start.
    public static func canStart(message: String, phase: WatchFaceNLStreamPhase) -> Bool {
        WatchFaceNLRequest.project(rawMessage: message).isWithinCap && phase != .pausedConfirm
    }

    /// Web button `disabled = !canStart || streaming || paused-confirm`, widened with the
    /// native leaf contract so the action cannot fire while offline (no stream is possible).
    /// `paused-confirm` is already folded into `!canStart`, so it need not be repeated.
    public static func buttonDisabled(
        message: String,
        phase: WatchFaceNLStreamPhase,
        connection: WatchFaceNLConnection
    ) -> Bool {
        !canStart(message: message, phase: phase)
            || phase == .streaming
            || connection == .offline
    }

    /// Web `AiOutputPanel` `hasAnything = text.length > 0 || state ∈ {streaming, error, done}`.
    public static func outputVisible(phase: WatchFaceNLStreamPhase, hasText: Bool) -> Bool {
        hasText || phase == .streaming || phase == .done || phase.isError
    }

    /// Web `text.length === 0 && state === 'streaming'` → the animated thinking indicator.
    public static func thinkingVisible(phase: WatchFaceNLStreamPhase, hasText: Bool) -> Bool {
        !hasText && phase == .streaming
    }

    /// Whether the resting "invite" card is showing (gate on, nothing streamed yet) — the
    /// native friendly idle state.
    public static func isIdleInvite(phase: WatchFaceNLStreamPhase, hasText: Bool) -> Bool {
        !hasText && phase == .idle
    }

    /// The contextual hint shown when the action can't start for an *input* reason (not while
    /// the stream is busy). Empty prompts are allowed, so the only input block is an over-cap
    /// prompt; returns `nil` once the prompt is within the cap.
    public static func hint(message: String, phase: WatchFaceNLStreamPhase) -> WatchFaceNLHint? {
        guard phase != .streaming, phase != .pausedConfirm else { return nil }
        return WatchFaceNLRequest.project(rawMessage: message).isWithinCap ? nil : .overCap
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver overview for the card from already-localised parts, so the spoken
/// content is asserted without rendering the view. The summary is the title plus a short
/// status phrase (thinking / answer-ready / error) — it deliberately does NOT inline the full
/// streamed answer (the output panel voices that itself), avoiding a double read.
public enum WatchFaceNLAccessibility {
    /// The localised label set the summary interleaves with the live phase.
    public struct Labels: Sendable, Equatable {
        public let title: String
        public let thinking: String
        public let answerReady: String
        public let error: String

        public init(title: String, thinking: String, answerReady: String, error: String) {
            self.title = title
            self.thinking = thinking
            self.answerReady = answerReady
            self.error = error
        }
    }

    public static func summary(
        labels: Labels,
        phase: WatchFaceNLStreamPhase,
        hasAnswer: Bool
    ) -> String {
        var parts: [String] = [labels.title]
        switch phase {
        case .streaming:
            parts.append(labels.thinking)
        case .done where hasAnswer:
            parts.append(labels.answerReady)
        case let .error(message):
            let detail = message.isEmpty ? labels.error : "\(labels.error) \(message)"
            parts.append(detail)
        case .idle, .pausedConfirm, .done:
            break
        }
        return parts.joined(separator: ". ")
    }
}
