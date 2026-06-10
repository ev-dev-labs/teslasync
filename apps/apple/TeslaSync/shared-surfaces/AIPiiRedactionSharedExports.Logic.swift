//
//  AIPiiRedactionSharedExports.Logic.swift
//  TeslaSync — P4 shared surface · 0038 · AIPiiRedactionSharedExports (Apple)
//
//  The pure state enums + decision logic + accessibility seam for the "Plan PII redactions
//  before sharing" Helix panel — the SwiftUI parity of
//  components/ai/AIPiiRedactionSharedExports.tsx. Foundation-only, view-free, so the
//  stream-lifecycle button logic (web `AIFeatureCard` + `AiOutputPanel` branches), the
//  contextual empty-hint, the export-type catalog, and the spoken summary are all unit tested
//  in isolation without rendering a view.
//
//  Web fidelity: the source drives a single input predicate — `canStart = haveInputs` where
//  `haveInputs = exportType !== ''`. There is NO vehicle dimension on this surface (unlike its
//  AINLAutomationBuilder sibling); the only thing the user must do to enable the action is pick
//  one of the canonical shared export types.
//

import Foundation

// MARK: - Top-level render axis (web `withAiFeature` gate + P4 leaf gate-error)

/// The top-level render axis the view switches on — the gate (web `withAiFeature`) plus the
/// P4 leaf gate-error state. `ready` defers to the stream-lifecycle body.
public enum PiiRedactionExportsRenderState: Equatable, Sendable {
    case gateLoading
    case gatedOff
    case gateError(String)
    case ready
}

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the native port of the web
/// `'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'`. `pausedConfirm` blocks a new
/// `start()` (web `canStart`), `streaming` flips the button to "Helix is thinking…".
public enum PiiRedactionExportsStreamPhase: Equatable, Sendable {
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
public enum PiiRedactionExportsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Feature gate (web `withAiFeature` / `useAiEnabled`)

/// The AI-Off gate state (ADR-015) — the native mirror of `useAiEnabled(feature)`. `loading`
/// shows skeleton chrome while the gate resolves; `off` collapses the surface to nothing (web
/// `withAiFeature` returns `null`); `on` renders the card.
public enum PiiRedactionExportsGate: String, Sendable, Equatable, CaseIterable {
    case loading
    case on
    case off
}

// MARK: - Export-type catalog (web `SHARED_EXPORT_TYPES`)

/// The canonical shared export types the redaction planner gates on — the native mirror of the
/// web `SHARED_EXPORT_TYPES` tuple. The declaration ORDER matches the web array exactly so the
/// rendered menu lists the options in the same order. Each `rawValue` is the canonical backend
/// slug (the value the SSE body sends) AND the i18n key suffix the localized label resolves on,
/// kept aligned with `internal/ai/tools/export_redaction_plan.go:SharedExportTypes()`.
public enum PiiRedactionExportType: String, Sendable, Equatable, CaseIterable {
    case drives
    case charging
    case trips
    case analytics
    case backup
    case account

    /// The canonical backend slug (web `SharedExportType` value).
    public var slug: String {
        rawValue
    }

    /// The per-type i18n key — web `t('exports.aiRedaction.exportType.${typeValue}', …)`.
    public var labelKey: String {
        "exports.aiRedaction.exportType.\(rawValue)"
    }

    /// The web default label — the slug with its first letter upper-cased
    /// (web `typeValue.charAt(0).toUpperCase() + typeValue.slice(1)`).
    public var defaultLabel: String {
        rawValue.prefix(1).uppercased() + rawValue.dropFirst()
    }
}

// MARK: - Contextual empty hint (P4 friendly empty/disabled state)

/// Why the "Ask Helix" action cannot start yet — surfaced as the friendly hint under the
/// description so the resting card is never a blank/confusing surface (P4 empty contract).
/// Mirrors the single web `canStart` predicate (`exportType !== ''`).
public enum PiiRedactionExportsHint: Equatable, Sendable {
    case pickExportType
}

// MARK: - Pure button / output logic (web `AIFeatureCard` + `AiOutputPanel` branches)

/// The pure, view-free decision logic ported from the web component + `AIFeatureCard` +
/// `AiOutputPanel`. Each function is a direct translation of a web boolean so the view is a
/// pure function of these and every branch is unit tested.
public enum PiiRedactionExportsLogic {
    /// The top-level render axis: `off` collapses the surface; a non-empty gate error shows the
    /// `QueryError` peer; `loading` shows skeleton chrome; otherwise the ready card.
    public static func renderState(
        gate: PiiRedactionExportsGate,
        gateError: String?
    ) -> PiiRedactionExportsRenderState {
        if gate == .off { return .gatedOff }
        if let gateError, !gateError.isEmpty { return .gateError(gateError) }
        if gate == .loading { return .gateLoading }
        return .ready
    }

    /// Web `isBusy = stream.state === 'streaming' || stream.state === 'paused-confirm'`.
    public static func isBusy(_ phase: PiiRedactionExportsStreamPhase) -> Bool {
        phase == .streaming || phase == .pausedConfirm
    }

    /// Web `canStart = haveInputs` where `haveInputs = exportType !== ''`. A `paused-confirm`
    /// stream also blocks a fresh start (the web hook leaves the connection paused for the
    /// continuation), so the native predicate widens the web boolean with that leaf guard.
    public static func canStart(
        exportType: PiiRedactionExportType?,
        phase: PiiRedactionExportsStreamPhase
    ) -> Bool {
        exportType != nil && phase != .pausedConfirm
    }

    /// Web `buttonDisabled = !canStart || isStreaming`, widened with the native leaf contract so
    /// the action cannot fire while offline (no stream is possible).
    public static func buttonDisabled(
        exportType: PiiRedactionExportType?,
        phase: PiiRedactionExportsStreamPhase,
        connection: PiiRedactionExportsConnection
    ) -> Bool {
        let canStart = canStart(exportType: exportType, phase: phase)
        return !canStart || phase == .streaming || connection == .offline
    }

    /// Web `AiOutputPanel` `hasAnything = text.length > 0 || state ∈ {streaming, error, done}`.
    public static func outputVisible(
        phase: PiiRedactionExportsStreamPhase,
        hasText: Bool
    ) -> Bool {
        hasText || phase == .streaming || phase == .done || phase.isError
    }

    /// Web `text.length === 0 && state === 'streaming'` → the animated thinking indicator.
    public static func thinkingVisible(
        phase: PiiRedactionExportsStreamPhase,
        hasText: Bool
    ) -> Bool {
        !hasText && phase == .streaming
    }

    /// Whether the resting "invite" card is showing (gate on, nothing streamed yet) — the
    /// native friendly idle/empty state (the web card with no output panel content yet).
    public static func isIdleInvite(
        phase: PiiRedactionExportsStreamPhase,
        hasText: Bool
    ) -> Bool {
        !hasText && phase == .idle
    }

    /// The contextual empty hint shown when the action can't start for an *input* reason (not
    /// while the stream is busy/paused) — the web `emptyHint` shown when `!haveInputs`. Returns
    /// the single unmet web `canStart` predicate so the user knows exactly what to do next.
    public static func emptyHint(
        exportType: PiiRedactionExportType?,
        phase: PiiRedactionExportsStreamPhase
    ) -> PiiRedactionExportsHint? {
        guard phase != .streaming, phase != .pausedConfirm else { return nil }
        if exportType == nil { return .pickExportType }
        return nil
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary for the card from already-localised parts, so the spoken
/// content is asserted without rendering the view. Mirrors the visible reading order: the
/// title, then the current stream status — the Helix error for an `error` stream, the thinking
/// label while the SSE is open with no text yet, or the streamed narrative once it arrives.
public enum PiiRedactionExportsAccessibility {
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
        phase: PiiRedactionExportsStreamPhase,
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
