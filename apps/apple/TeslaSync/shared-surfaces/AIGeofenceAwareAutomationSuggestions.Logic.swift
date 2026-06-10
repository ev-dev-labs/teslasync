//
//  AIGeofenceAwareAutomationSuggestions.Logic.swift
//  TeslaSync — P4 shared surface · 0020 · AIGeofenceAwareAutomationSuggestions (Apple)
//
//  The pure state enums + decision logic + accessibility seam split out of `…Adapter.swift`
//  (one file ≤ 400 lines per the SwiftLint contract). Foundation-only, view-free, so the
//  stream-lifecycle button logic (web `AIFeatureCard` + `AiOutputPanel` branches), the
//  contextual empty-hint, and the spoken summary are all unit tested in isolation without
//  rendering a view.
//

import Foundation

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the native port of the web
/// `'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'`. `pausedConfirm` blocks a
/// new `start()` (web `canStart`), `streaming` flips the button to "Helix is thinking…".
public enum GeofenceAutomationStreamPhase: Equatable, Sendable {
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

/// The freshness of the bound feature-gate / context snapshot — the orthogonal
/// connectivity axis rendered as the header chip + banner. `live` hides the banner.
public enum GeofenceAutomationConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Feature gate (web `withAiFeature` / `useAiEnabled`)

/// The AI-Off gate state (ADR-015) — the native mirror of `useAiEnabled(feature)`.
/// `loading` shows skeleton chrome while the gate resolves; `off` collapses the surface to
/// nothing (web `withAiFeature` returns `null`); `on` renders the card.
public enum GeofenceAutomationGate: String, Sendable, Equatable, CaseIterable {
    case loading
    case on
    case off
}

// MARK: - Contextual empty hint (P4 friendly empty/disabled state)

/// Why the "Ask Helix" action cannot start yet — surfaced as the friendly hint under the
/// description so the resting card is never a blank/confusing surface (P4 empty contract).
/// Mirrors the two web `canStart` input predicates (`vehicleId > 0`, `prompt non-empty`).
public enum GeofenceAutomationHint: Equatable, Sendable {
    case selectVehicle
    case describeAutomation
}

// MARK: - Pure button / output logic (web `AIFeatureCard` + `AiOutputPanel` branches)

/// The pure, view-free decision logic ported from the web component + `AIFeatureCard` +
/// `AiOutputPanel`. Each function is a direct translation of a web boolean so the view is
/// a pure function of these and every branch is unit tested.
public enum GeofenceAutomationLogic {
    /// Web `isBusy = stream.state === 'streaming' || stream.state === 'paused-confirm'`.
    public static func isBusy(_ phase: GeofenceAutomationStreamPhase) -> Bool {
        phase == .streaming || phase == .pausedConfirm
    }

    /// Web `canStart = (vehicleId ?? 0) > 0 && prompt.trim().length > 0 &&
    /// stream.state !== 'paused-confirm'`.
    public static func canStart(
        vehicleID: Int64,
        prompt: String,
        phase: GeofenceAutomationStreamPhase
    ) -> Bool {
        vehicleID > 0 && !isBlank(prompt) && phase != .pausedConfirm
    }

    /// Web `buttonDisabled = !canStart || isStreaming`, widened with the native leaf
    /// contract so the action cannot fire while offline (no stream is possible).
    public static func buttonDisabled(
        vehicleID: Int64,
        prompt: String,
        phase: GeofenceAutomationStreamPhase,
        connection: GeofenceAutomationConnection
    ) -> Bool {
        let canStart = canStart(vehicleID: vehicleID, prompt: prompt, phase: phase)
        return !canStart || phase == .streaming || connection == .offline
    }

    /// Web `AiOutputPanel` `hasAnything = text.length > 0 || state ∈ {streaming, error, done}`.
    public static func outputVisible(phase: GeofenceAutomationStreamPhase, hasText: Bool) -> Bool {
        hasText || phase == .streaming || phase == .done || phase.isError
    }

    /// Web `text.length === 0 && state === 'streaming'` → the animated thinking indicator.
    public static func thinkingVisible(phase: GeofenceAutomationStreamPhase, hasText: Bool) -> Bool {
        !hasText && phase == .streaming
    }

    /// Whether the resting "invite" card is showing (gate on, nothing streamed yet, no
    /// draft captured) — the native friendly idle state.
    public static func isIdleInvite(
        phase: GeofenceAutomationStreamPhase,
        hasDraft: Bool,
        hasText: Bool
    ) -> Bool {
        !hasDraft && !hasText && phase == .idle
    }

    /// The contextual empty hint shown when the action can't start for an *input* reason
    /// (not while the stream is busy/paused). Returns the first unmet web `canStart`
    /// predicate so the user knows exactly what to do next.
    public static func emptyHint(
        vehicleID: Int64,
        prompt: String,
        phase: GeofenceAutomationStreamPhase
    ) -> GeofenceAutomationHint? {
        guard phase != .streaming, phase != .pausedConfirm else { return nil }
        if vehicleID <= 0 { return .selectVehicle }
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
/// content is asserted without rendering the view. Mirrors the visible reading order:
/// title, then (when a proposal is captured) the proposed name, its description, the
/// trigger/condition/action counts, the validator reason, and the rejected verdict.
public enum GeofenceAutomationAccessibility {
    /// The localised label set the summary interleaves with the draft data.
    public struct Labels: Sendable, Equatable {
        public let title: String
        public let proposed: String
        public let unnamed: String
        public let triggers: String
        public let conditions: String
        public let actions: String
        public let rejected: String

        public init(
            title: String,
            proposed: String,
            unnamed: String,
            triggers: String,
            conditions: String,
            actions: String,
            rejected: String
        ) {
            self.title = title
            self.proposed = proposed
            self.unnamed = unnamed
            self.triggers = triggers
            self.conditions = conditions
            self.actions = actions
            self.rejected = rejected
        }
    }

    public static func summary(labels: Labels, draft: GeofenceAutomationDraft?) -> String {
        var parts: [String] = [labels.title]
        if let draft {
            let name = draft.input.name.isEmpty ? labels.unnamed : draft.input.name
            parts.append("\(labels.proposed): \(name)")
            if !draft.input.description.isEmpty {
                parts.append(draft.input.description)
            }
            parts.append(
                "\(labels.triggers): \(draft.input.triggers.count). "
                    + "\(labels.conditions): \(draft.input.conditions.count). "
                    + "\(labels.actions): \(draft.input.actions.count)"
            )
            if let reason = draft.validationError, !reason.isEmpty {
                parts.append(reason)
            }
            if !draft.isOK {
                parts.append(labels.rejected)
            }
        }
        return parts.joined(separator: ". ")
    }
}
