//
//  withAiFeature.Projection.swift
//  TeslaSync — P4 shared surface · 0062 · withAiFeature (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state — the native port of the
//  web HOC's render decision (`useAiEnabled(feature)` → wrap the inner in the marker `<div>` or
//  return `null`). The view is a pure function of this value; every branch is unit tested.
//
//  Faithful-parity note: the web HOC is transparent — it has exactly two outcomes, the wrapped
//  inner (gate enabled) or nothing (every fail-closed verdict). It renders no skeleton, error,
//  empty, stale, or offline chrome of its own, so neither does this surface; adding such chrome
//  would contradict the web source (which returns `null`, never a fallback panel). The richer gate
//  verdict (`unknownFeature` / `unresolved` / `failed` / `disabled`) is preserved on the resolved
//  value for diagnostics + tests, but all four map to the single `withdrawn` outcome.
//

import Foundation

// MARK: - Resolved view-state (web render branches)

/// The resolved, view-ready state — `outcome` selects whether the inner content renders (decorated
/// by the marker identifier) or the surface is withdrawn, while `gate` carries the precise verdict
/// and `connection` carries the P4 freshness axis for the model's refresh/telemetry timing.
public struct AiFeatureGateResolved: Sendable, Equatable {
    /// What the HOC renders — the two web outcomes.
    public enum Outcome: String, Sendable, Equatable, CaseIterable {
        /// Gate enabled → render the wrapped inner content with the marker identifier.
        case presented
        /// Every fail-closed verdict → render nothing (web `withAiFeature` returns `null`).
        case withdrawn
    }

    public let gate: AiFeatureGate
    public let outcome: Outcome
    public let connection: AiFeatureGateConnection
    public let markerIdentifier: String

    public init(
        gate: AiFeatureGate,
        outcome: Outcome,
        connection: AiFeatureGateConnection,
        markerIdentifier: String
    ) {
        self.gate = gate
        self.outcome = outcome
        self.connection = connection
        self.markerIdentifier = markerIdentifier
    }

    /// `true` when the inner content renders — the web `useAiEnabled` verdict surfaced on the
    /// resolved value so the view stays a pure read.
    public var isPresented: Bool {
        outcome == .presented
    }
}

// MARK: - Projection (gate → outcome)

/// Pure projection from the input snapshot to the resolved view-state. The gate decides the
/// outcome — `enabled` presents the marked inner, every other verdict withdraws the surface
/// (faithful `withAiFeature` `null`). The marker identifier is resolved here (web
/// `meta.uiTestIds[0] ?? \`ai-feature-${feature}\``) so the view never recomputes it.
public enum AiFeatureGateProjection {
    public static func resolve(_ input: AiFeatureGateInput, testID: String? = nil) -> AiFeatureGateResolved {
        let gate = AiFeatureGate.evaluate(input)
        let outcome: AiFeatureGateResolved.Outcome = gate.isPresented ? .presented : .withdrawn
        let identifier = AiFeatureMarker.identifier(feature: input.featureID, testID: testID)
        return AiFeatureGateResolved(
            gate: gate,
            outcome: outcome,
            connection: input.connection,
            markerIdentifier: identifier
        )
    }
}
