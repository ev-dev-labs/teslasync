//
//  AIThinkingIndicator.Projection.swift
//  TeslaSync — P4 shared surface · 0053 · AIThinkingIndicator (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state — the native port of the
//  web `const text = label ?? t('helix.thinking', 'Helix is thinking')`. The view is a pure function
//  of this value; every branch is unit tested.
//

import Foundation

// MARK: - Resolved view-state (web `text`)

/// The resolved, view-ready state — the single label the full indicator and the compact dots voice.
public struct AIThinkingResolved: Sendable, Equatable {
    public let label: String

    public init(label: String) {
        self.label = label
    }
}

// MARK: - Projection (override ?? default)

/// Pure projection from the input snapshot + the already-localized default to the resolved label.
/// The web expression is `label ?? t('helix.thinking', 'Helix is thinking')` — a nullish fallback.
/// Native additionally treats an empty / whitespace-only override as absent so the `role="status"`
/// label is never voiced blank (a null-safety refinement, not behavior the web relied on).
public enum AIThinkingProjection {
    public static func resolve(_ input: AIThinkingIndicatorInput, defaultLabel: String) -> AIThinkingResolved {
        guard let override = input.labelOverride else {
            return AIThinkingResolved(label: defaultLabel)
        }
        let trimmed = override.trimmingCharacters(in: .whitespacesAndNewlines)
        return AIThinkingResolved(label: trimmed.isEmpty ? defaultLabel : override)
    }
}
