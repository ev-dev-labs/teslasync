//
//  AIChatbotIndicator.Projection.swift
//  TeslaSync — P4 shared surface · 0012 · AIChatbotIndicator (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state — the native port of the
//  web composition (`withAiFeature('chatbot-llm')` gate → the cyan Helix chip or `null`) plus the
//  P4 leaf contract. The view is a pure function of this value; every branch is unit tested.
//

import Foundation

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the rendered body while `connection` decorates
/// the presented badge with the freshness axis.
public struct AIChatbotResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Gate disabled (web `withAiFeature` off → `null`) → no AI surface renders (ADR-015).
        case gatedOff
        /// Settings still resolving → a neutral skeleton chip (no AI branding leaks).
        case loading
        /// Settings query failed → a neutral retry chip (no AI branding leaks).
        case unavailable
        /// Gate enabled → the cyan Helix badge, decorated by `connection`.
        case presented
    }

    public let phase: Phase
    public let connection: AIChatbotConnection

    public init(phase: Phase, connection: AIChatbotConnection) {
        self.phase = phase
        self.connection = connection
    }
}

// MARK: - Projection (gate → phase)

/// Pure projection from the input snapshot to the resolved view-state. The gate decides the phase —
/// `enabled` presents the badge, `disabled` withdraws the surface (faithful `withAiFeature` `null`),
/// and the two non-terminal gate states (`unresolved` / `failed`) render neutral chrome so the P4
/// "every state renders, never a blank box" contract holds without leaking whether AI is on.
public enum AIChatbotProjection {
    public static func resolve(_ input: AIChatbotIndicatorInput) -> AIChatbotResolved {
        let phase: AIChatbotResolved.Phase = switch AIChatbotGate.evaluate(input) {
        case .disabled:
            .gatedOff
        case .unresolved:
            .loading
        case .failed:
            .unavailable
        case .enabled:
            .presented
        }
        return AIChatbotResolved(phase: phase, connection: input.connection)
    }
}
