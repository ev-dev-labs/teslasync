//
//  AIQuietHoursSuggestion.Logic.swift
//  TeslaSync — P4 shared surface · 0041 · AIQuietHoursSuggestion (Apple)
//
//  The pure state enums + decision logic + i18n interpolation + accessibility seam for the "Suggest a
//  quiet-hours window" Helix panel, split out of `…Adapter.swift` (one file ≤ 400 lines per the
//  SwiftLint contract). Foundation-only, view-free, so the stream-lifecycle button logic (web
//  `AIFeatureCard` + `AiOutputPanel` branches), the apply gate, the friendly idle hint, the
//  `{{token}}` substitution the web `t(key, vars)` performs, and the spoken summary are all unit
//  tested in isolation without rendering a view.
//

import Foundation

// MARK: - Top-level render axis (web `withAiFeature` gate + P4 leaf gate-error)

/// The top-level render axis the view switches on — the gate (web `withAiFeature`) plus the P4 leaf
/// gate-error state. `ready` defers to the stream-lifecycle body.
public enum QuietHoursSuggestionRenderState: Equatable, Sendable {
    case gateLoading
    case gatedOff
    case gateError(String)
    case ready
}

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the native port of the web
/// `'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'`. This surface treats BOTH `streaming`
/// and `pausedConfirm` as "busy" (web `isBusy = stream.state === 'streaming' || === 'paused-confirm'`,
/// which gates the Suggest action and the Apply button); `streaming` alone flips the button to
/// "Helix is thinking…" and `pausedConfirm` alone also makes the web `canStart` false.
public enum QuietHoursSuggestionStreamPhase: Equatable, Sendable {
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

/// The freshness of the bound feature-gate / context snapshot — the orthogonal connectivity axis
/// rendered as the header chip + banner. `live` hides the banner.
public enum QuietHoursSuggestionConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Feature gate (web `withAiFeature` / `useAiEnabled`)

/// The AI-Off gate state (ADR-015) — the native mirror of `useAiEnabled(feature)`. `loading` shows
/// skeleton chrome while the gate resolves; `off` collapses the surface to nothing (web
/// `withAiFeature` returns `null`); `on` renders the card.
public enum QuietHoursSuggestionGate: String, Sendable, Equatable, CaseIterable {
    case loading
    case on
    case off
}

// MARK: - Pure button / output logic (web component + `AIFeatureCard` + `AiOutputPanel` branches)

/// The pure, view-free decision logic ported from the web component + `AIFeatureCard` +
/// `AiOutputPanel`. Each function is a direct translation of a web boolean so the view is a pure
/// function of these and every branch is unit tested.
public enum QuietHoursSuggestionLogic {
    /// The top-level render axis: `off` collapses the surface; a non-empty gate error shows the
    /// `QueryError` peer; `loading` shows skeleton chrome; otherwise the ready card.
    public static func renderState(
        gate: QuietHoursSuggestionGate,
        gateError: String?
    ) -> QuietHoursSuggestionRenderState {
        if gate == .off { return .gatedOff }
        if let gateError, !gateError.isEmpty { return .gateError(gateError) }
        if gate == .loading { return .gateLoading }
        return .ready
    }

    /// Web `isBusy = stream.state === 'streaming' || stream.state === 'paused-confirm'`.
    public static func isBusy(_ phase: QuietHoursSuggestionStreamPhase) -> Bool {
        phase == .streaming || phase == .pausedConfirm
    }

    /// Web `canStart = stream.state !== 'paused-confirm'`. The panel has no vehicle/prompt inputs (the
    /// request body is the empty object), so the only thing blocking a fresh suggestion is a paused
    /// continuation awaiting confirmation.
    public static func canStart(phase: QuietHoursSuggestionStreamPhase) -> Bool {
        phase != .pausedConfirm
    }

    /// Web `AIFeatureCard` `buttonDisabled = !canStart || isStreaming` (i.e. `paused-confirm ||
    /// streaming`, which equals `isBusy`), widened with the native leaf contract so the action cannot
    /// fire while offline (no stream is possible).
    public static func buttonDisabled(
        phase: QuietHoursSuggestionStreamPhase,
        connection: QuietHoursSuggestionConnection
    ) -> Bool {
        isBusy(phase) || connection == .offline
    }

    /// Web Apply button `disabled={proposal == null || isBusy}` → enabled = `!!proposal && !isBusy`.
    public static func canApply(hasProposal: Bool, phase: QuietHoursSuggestionStreamPhase) -> Bool {
        hasProposal && !isBusy(phase)
    }

    /// Web `AiOutputPanel` `hasAnything = text.length > 0 || state ∈ {streaming, error, done}`.
    public static func outputVisible(phase: QuietHoursSuggestionStreamPhase, hasText: Bool) -> Bool {
        hasText || phase == .streaming || phase == .done || phase.isError
    }

    /// Web `text.length === 0 && state === 'streaming'` → the animated thinking indicator.
    public static func thinkingVisible(phase: QuietHoursSuggestionStreamPhase, hasText: Bool) -> Bool {
        !hasText && phase == .streaming
    }

    /// Whether the resting "invite" card is showing (gate on, nothing proposed yet, nothing streamed)
    /// — the native friendly idle/empty state (the web card with no proposal children and no output
    /// panel content yet), so the surface is never a blank box (P4 empty contract).
    public static func showIdleHint(
        phase: QuietHoursSuggestionStreamPhase,
        hasProposal: Bool,
        hasText: Bool
    ) -> Bool {
        !hasProposal && !hasText && phase == .idle
    }

    /// Native port of the web i18next `t(key, vars)` token substitution: replaces every `{{name}}`
    /// occurrence in the resolved template with the matching value. Unmatched tokens are left intact
    /// (mirroring i18next's missing-interpolation behaviour), so the source phrasing is preserved
    /// verbatim while the view fills the runtime scalars.
    public static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary for the card from already-localised parts, so the spoken content is
/// asserted without rendering the view. Mirrors the visible reading order: the title, then (when a
/// window is proposed) the proposed-window summary, then the live stream status — the Helix error for
/// an `error` stream, the thinking label while the SSE is open with no text yet, or the streamed
/// narrative once it arrives.
public enum QuietHoursSuggestionAccessibility {
    /// The localised label set the summary interleaves with the proposal summary + stream state.
    public struct Labels: Sendable, Equatable {
        public let title: String
        public let proposed: String
        public let thinking: String
        public let errorLabel: String
        public let errorUnknown: String

        public init(
            title: String,
            proposed: String,
            thinking: String,
            errorLabel: String,
            errorUnknown: String
        ) {
            self.title = title
            self.proposed = proposed
            self.thinking = thinking
            self.errorLabel = errorLabel
            self.errorUnknown = errorUnknown
        }
    }

    /// `proposalSummary` is the already-interpolated, comma-joined window/weekday/severities line the
    /// view builds from the captured proposal (passed in so this seam stays a pure ordering function).
    public static func summary(
        labels: Labels,
        proposalSummary: String?,
        phase: QuietHoursSuggestionStreamPhase,
        streamText: String
    ) -> String {
        var parts: [String] = [labels.title]
        if let proposalSummary, !proposalSummary.isEmpty {
            parts.append("\(labels.proposed): \(proposalSummary)")
        }
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
