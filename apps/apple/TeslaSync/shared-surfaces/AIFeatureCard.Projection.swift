//
//  AIFeatureCard.Projection.swift
//  TeslaSync — P4 shared surface · 0018 · AIFeatureCard (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state — the native port of the
//  web `AiOutputPanel` render branches plus the `AIFeatureCard` button derivations. The view is a
//  pure function of `AIFeatureCardResolved`; every branch is unit tested without rendering.
//

import Foundation

// MARK: - Output panel state (web `AiOutputPanel` branches)

/// The resolved render state of the streamed-output panel — the native port of the web
/// `AiOutputPanel` conditional. The panel collapses to nothing when there is nothing to show (web
/// `hasAnything` false, plus the done-with-no-text case where the feature's `children` carry the
/// real output — avoids a blank panel, never a blank box).
public enum AIFeatureOutputState: Equatable, Sendable {
    /// Web `!hasAnything` (idle + empty) or `done` with no text → the panel renders nothing.
    case hidden
    /// Web `text.length === 0 && state === 'streaming'` → the animated thinking indicator.
    case thinking
    /// Web default branch → the accumulated narrative text (`whitespace-pre-wrap`).
    case text(String)
    /// Web `state === 'error'` → the Helix error row (message, or "unknown" when empty).
    case error(String)
}

// MARK: - Resolved view-state

/// The resolved, view-ready state — the output-panel branch plus the button derivations and the
/// carried connectivity axis. Computed once by ``AIFeatureCardProjection`` so the view holds no
/// decision logic.
public struct AIFeatureCardResolved: Equatable, Sendable {
    public let phase: AIFeatureStreamPhase
    public let connection: AIFeatureCardConnection
    public let canStart: Bool
    public let buttonDisabled: Bool
    public let isStreaming: Bool
    public let output: AIFeatureOutputState

    public init(
        phase: AIFeatureStreamPhase,
        connection: AIFeatureCardConnection,
        canStart: Bool,
        buttonDisabled: Bool,
        isStreaming: Bool,
        output: AIFeatureOutputState
    ) {
        self.phase = phase
        self.connection = connection
        self.canStart = canStart
        self.buttonDisabled = buttonDisabled
        self.isStreaming = isStreaming
        self.output = output
    }
}

// MARK: - Projection (input → resolved)

/// Pure projection from the input snapshot to the resolved view-state. The output branch mirrors
/// the web `AiOutputPanel` precedence exactly: error first, then streaming-with-no-text (thinking),
/// then accumulated text; everything else collapses the panel.
public enum AIFeatureCardProjection {
    /// The web `AiOutputPanel` render decision, as a pure value.
    public static func outputState(phase: AIFeatureStreamPhase, text: String) -> AIFeatureOutputState {
        let hasText = !text.isEmpty
        if case let .error(message) = phase {
            return .error(message)
        }
        if AIFeatureCardLogic.thinkingVisible(phase: phase, hasText: hasText) {
            return .thinking
        }
        // Web shows the (possibly empty) text paragraph whenever `hasAnything`. We collapse the
        // done-with-no-text case to `hidden` so the panel is never a blank box — in that case the
        // feature's `children` slot is the real output (matches the web call-site contract).
        if hasText {
            return .text(text)
        }
        return .hidden
    }

    /// Resolves the full view-state from an input snapshot.
    public static func resolve(_ input: AIFeatureCardInput) -> AIFeatureCardResolved {
        AIFeatureCardResolved(
            phase: input.phase,
            connection: input.connection,
            canStart: input.canStart,
            buttonDisabled: AIFeatureCardLogic.buttonDisabled(
                canStart: input.canStart,
                phase: input.phase,
                connection: input.connection
            ),
            isStreaming: input.phase.isStreaming,
            output: outputState(phase: input.phase, text: input.text)
        )
    }
}
