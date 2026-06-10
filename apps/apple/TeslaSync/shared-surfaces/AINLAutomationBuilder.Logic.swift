//
//  AINLAutomationBuilder.Logic.swift
//  TeslaSync — P4 shared surface · 0030 · AINLAutomationBuilder (Apple)
//
//  The pure state enums + decision logic + accessibility seam for the "Draft from natural
//  language" Helix panel, split out of `…Adapter.swift` (one file ≤ 400 lines per the
//  SwiftLint contract). Foundation-only, view-free, so the stream-lifecycle button logic
//  (web `AIFeatureCard` + `AiOutputPanel` branches), the contextual empty-hint, and the
//  spoken summary are all unit tested in isolation without rendering a view.
//

import Foundation

// MARK: - Top-level render axis (web `withAiFeature` gate + P4 leaf gate-error)

/// The top-level render axis the view switches on — the gate (web `withAiFeature`) plus the
/// P4 leaf gate-error state. `ready` defers to the stream-lifecycle body.
public enum NLAutomationBuilderRenderState: Equatable, Sendable {
    case gateLoading
    case gatedOff
    case gateError(String)
    case ready
}

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the native port of the web
/// `'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'`. `pausedConfirm` blocks a new
/// `start()` (web `canStart`), `streaming` flips the button to "Helix is thinking…".
public enum NLAutomationBuilderStreamPhase: Equatable, Sendable {
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
/// axis rendered as the header chip + banner. `live` hides the banner.
public enum NLAutomationBuilderConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Feature gate (web `withAiFeature` / `useAiEnabled`)

/// The AI-Off gate state (ADR-015) — the native mirror of `useAiEnabled(feature)`. `loading`
/// shows skeleton chrome while the gate resolves; `off` collapses the surface to nothing (web
/// `withAiFeature` returns `null`); `on` renders the card.
public enum NLAutomationBuilderGate: String, Sendable, Equatable, CaseIterable {
    case loading
    case on
    case off
}

// MARK: - Contextual empty hint (P4 friendly empty/disabled state)

/// Why the "Ask Helix" action cannot start yet — surfaced as the friendly hint under the
/// description so the resting card is never a blank/confusing surface (P4 empty contract).
/// Mirrors the two web `canStart` input predicates (`vehicleId != null`, `prompt non-empty`).
public enum NLAutomationBuilderHint: Equatable, Sendable {
    case selectVehicle
    case describeAutomation
}

// MARK: - Pure button / output logic (web `AIFeatureCard` + `AiOutputPanel` branches)

/// The pure, view-free decision logic ported from the web component + `AIFeatureCard` +
/// `AiOutputPanel`. Each function is a direct translation of a web boolean so the view is a
/// pure function of these and every branch is unit tested.
public enum NLAutomationBuilderLogic {
    /// The top-level render axis: `off` collapses the surface; a non-empty gate error shows the
    /// `QueryError` peer; `loading` shows skeleton chrome; otherwise the ready card.
    public static func renderState(
        gate: NLAutomationBuilderGate,
        gateError: String?
    ) -> NLAutomationBuilderRenderState {
        if gate == .off { return .gatedOff }
        if let gateError, !gateError.isEmpty { return .gateError(gateError) }
        if gate == .loading { return .gateLoading }
        return .ready
    }

    /// Web `isBusy = stream.state === 'streaming' || stream.state === 'paused-confirm'`.
    public static func isBusy(_ phase: NLAutomationBuilderStreamPhase) -> Bool {
        phase == .streaming || phase == .pausedConfirm
    }

    /// Web `canStart = vehicleId != null && prompt.trim().length > 0`. The vehicle predicate is
    /// `!= nil` (NOT `> 0`) — faithful to the web source, where the body sends `vehicle_id:
    /// vehicleId ?? 0` so a present id is honoured verbatim. A `paused-confirm` stream also
    /// blocks a fresh start (the web hook leaves the connection paused for the continuation).
    public static func canStart(
        vehicleID: Int64?,
        prompt: String,
        phase: NLAutomationBuilderStreamPhase
    ) -> Bool {
        vehicleID != nil && !isBlank(prompt) && phase != .pausedConfirm
    }

    /// Web `buttonDisabled = !canStart || isStreaming`, widened with the native leaf contract so
    /// the action cannot fire while offline (no stream is possible).
    public static func buttonDisabled(
        vehicleID: Int64?,
        prompt: String,
        phase: NLAutomationBuilderStreamPhase,
        connection: NLAutomationBuilderConnection
    ) -> Bool {
        let canStart = canStart(vehicleID: vehicleID, prompt: prompt, phase: phase)
        return !canStart || phase == .streaming || connection == .offline
    }

    /// Web `AiOutputPanel` `hasAnything = text.length > 0 || state ∈ {streaming, error, done}`.
    public static func outputVisible(phase: NLAutomationBuilderStreamPhase, hasText: Bool) -> Bool {
        hasText || phase == .streaming || phase == .done || phase.isError
    }

    /// Web `text.length === 0 && state === 'streaming'` → the animated thinking indicator.
    public static func thinkingVisible(phase: NLAutomationBuilderStreamPhase, hasText: Bool) -> Bool {
        !hasText && phase == .streaming
    }

    /// Whether the resting "invite" card is showing (gate on, nothing streamed yet) — the
    /// native friendly idle/empty state (the web card with no output panel content yet).
    public static func isIdleInvite(phase: NLAutomationBuilderStreamPhase, hasText: Bool) -> Bool {
        !hasText && phase == .idle
    }

    /// The contextual empty hint shown when the action can't start for an *input* reason (not
    /// while the stream is busy/paused). Returns the first unmet web `canStart` predicate so the
    /// user knows exactly what to do next.
    public static func emptyHint(
        vehicleID: Int64?,
        prompt: String,
        phase: NLAutomationBuilderStreamPhase
    ) -> NLAutomationBuilderHint? {
        guard phase != .streaming, phase != .pausedConfirm else { return nil }
        if vehicleID == nil { return .selectVehicle }
        if isBlank(prompt) { return .describeAutomation }
        return nil
    }

    /// Web `prompt.trim().length === 0` — whitespace-only prompts do not enable the action.
    private static func isBlank(_ prompt: String) -> Bool {
        prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary for the card from already-localised parts, so the spoken
/// content is asserted without rendering the view. Mirrors the visible reading order: the
/// title, then the current stream status — the Helix error for an `error` stream, the thinking
/// label while the SSE is open with no text yet, or the streamed narrative once it arrives.
public enum NLAutomationBuilderAccessibility {
    /// The localised label set the summary interleaves with the live stream state.
    public struct Labels: Sendable, Equatable {
        public let title: String
        public let thinking: String
        public let errorLabel: String
        public let errorUnknown: String

        public init(title: String, thinking: String, errorLabel: String, errorUnknown: String) {
            self.title = title
            self.thinking = thinking
            self.errorLabel = errorLabel
            self.errorUnknown = errorUnknown
        }
    }

    public static func summary(
        labels: Labels,
        phase: NLAutomationBuilderStreamPhase,
        streamText: String
    ) -> String {
        var parts: [String] = [labels.title]
        if case let .error(message) = phase {
            let resolved = message.isEmpty ? labels.errorUnknown : message
            parts.append("\(labels.errorLabel) \(resolved)")
        } else if phase == .streaming, streamText.isEmpty {
            parts.append(labels.thinking)
        } else if !streamText.isEmpty {
            parts.append(streamText)
        }
        return parts.joined(separator: ". ")
    }
}
