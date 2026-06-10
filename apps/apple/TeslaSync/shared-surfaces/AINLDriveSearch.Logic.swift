//
//  AINLDriveSearch.Logic.swift
//  TeslaSync — P4 shared surface · 0032 · AINLDriveSearch (Apple)
//
//  The pure state enums + decision logic + accessibility seam for the "Find a drive in natural
//  language" Helix panel. Foundation-only, view-free, so the stream-lifecycle button logic
//  (web `AIFeatureCard` + `AiOutputPanel` branches), the contextual empty-hint, and the spoken
//  summary are all unit tested in isolation without rendering a view.
//

import Foundation

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the native port of the web
/// `'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'`. This read-only search never
/// reaches `pausedConfirm` (no tool needs confirmation), but the full union is modelled for
/// fidelity. `streaming` flips the button to "Helix is thinking…"; `error` surfaces inside the
/// output panel.
public enum NLDriveSearchStreamPhase: Equatable, Sendable {
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
public enum NLDriveSearchConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Feature gate (web `withAiFeature` / `useAiEnabled`)

/// The AI-Off gate state (ADR-015) — the native mirror of `useAiEnabled(feature)`.
/// `loading` shows skeleton chrome while the gate resolves; `off` collapses the surface to
/// nothing (web `withAiFeature` returns `null`); `on` renders the card.
public enum NLDriveSearchGate: String, Sendable, Equatable, CaseIterable {
    case loading
    case on
    case off
}

// MARK: - Contextual empty hint (P4 friendly empty/disabled state)

/// Why the "Ask Helix" action cannot start yet — surfaced as the friendly hint under the
/// description so the resting card is never a blank/confusing surface (P4 empty contract).
/// Mirrors the single web `canStart` predicate (`prompt.trim().length > 0`): the only reason
/// the action is blocked for an input reason is an empty prompt.
public enum NLDriveSearchHint: Equatable, Sendable {
    case enterPrompt
}

// MARK: - Pure button / output logic (web `AIFeatureCard` + `AiOutputPanel` branches)

/// The pure, view-free decision logic ported from the web component + `AIFeatureCard` +
/// `AiOutputPanel`. Each function is a direct translation of a web boolean so the view is a
/// pure function of these and every branch is unit tested.
public enum NLDriveSearchLogic {
    /// Web `isBusy = stream.state === 'streaming'` (the union's `paused-confirm` is included
    /// for fidelity though this read-only surface never enters it).
    public static func isBusy(_ phase: NLDriveSearchStreamPhase) -> Bool {
        phase == .streaming || phase == .pausedConfirm
    }

    /// Web `canStart = prompt.trim().length > 0`. Delegates to the request projection so the
    /// trimming stays in one place.
    public static func canStart(prompt: String) -> Bool {
        NLDriveSearchRequest.project(rawPrompt: prompt).canStart
    }

    /// Web `buttonDisabled = !canStart || isStreaming`, widened with the native leaf contract
    /// so the action cannot fire while offline (no stream is possible).
    public static func buttonDisabled(
        prompt: String,
        phase: NLDriveSearchStreamPhase,
        connection: NLDriveSearchConnection
    ) -> Bool {
        !canStart(prompt: prompt)
            || phase == .streaming
            || connection == .offline
    }

    /// Web `AiOutputPanel` `hasAnything = text.length > 0 || state ∈ {streaming, error, done}`.
    public static func outputVisible(phase: NLDriveSearchStreamPhase, hasText: Bool) -> Bool {
        hasText || phase == .streaming || phase == .done || phase.isError
    }

    /// Web `text.length === 0 && state === 'streaming'` → the animated thinking indicator.
    public static func thinkingVisible(phase: NLDriveSearchStreamPhase, hasText: Bool) -> Bool {
        !hasText && phase == .streaming
    }

    /// Whether the resting "invite" card is showing (gate on, nothing streamed yet) — the
    /// native friendly idle state.
    public static func isIdleInvite(phase: NLDriveSearchStreamPhase, hasText: Bool) -> Bool {
        !hasText && phase == .idle
    }

    /// The contextual empty hint shown when the action can't start for an *input* reason (not
    /// while the stream is busy). Returns `.enterPrompt` when the trimmed prompt is empty (the
    /// single unmet web `canStart` predicate) so the user knows exactly what to do next.
    public static func emptyHint(
        prompt: String,
        phase: NLDriveSearchStreamPhase
    ) -> NLDriveSearchHint? {
        guard phase != .streaming, phase != .pausedConfirm else { return nil }
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .enterPrompt }
        return nil
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver overview for the card from already-localised parts, so the spoken
/// content is asserted without rendering the view. The summary is the title plus a short
/// status phrase (thinking / results-ready / error) — it deliberately does NOT inline the full
/// streamed answer (the output panel voices that itself), avoiding a double read.
public enum NLDriveSearchAccessibility {
    /// The localised label set the summary interleaves with the live phase.
    public struct Labels: Sendable, Equatable {
        public let title: String
        public let thinking: String
        public let resultsReady: String
        public let error: String

        public init(title: String, thinking: String, resultsReady: String, error: String) {
            self.title = title
            self.thinking = thinking
            self.resultsReady = resultsReady
            self.error = error
        }
    }

    public static func summary(
        labels: Labels,
        phase: NLDriveSearchStreamPhase,
        hasAnswer: Bool
    ) -> String {
        var parts: [String] = [labels.title]
        switch phase {
        case .streaming:
            parts.append(labels.thinking)
        case .done where hasAnswer:
            parts.append(labels.resultsReady)
        case let .error(message):
            let detail = message.isEmpty ? labels.error : "\(labels.error) \(message)"
            parts.append(detail)
        case .idle, .pausedConfirm, .done:
            break
        }
        return parts.joined(separator: ". ")
    }
}
