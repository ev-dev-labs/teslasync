//
//  withAiFeature.Adapter.swift
//  TeslaSync — P4 shared surface · 0062 · withAiFeature (Apple)
//
//  The testable, dependency-light core for the AI-Off visibility gate — the SwiftUI parity of
//  components/ai/withAiFeature.tsx. The web source is a higher-order component (ADR-015): it folds
//  `useAiEnabled(feature)` and renders `null` unless the feature is on end-to-end; when on it wraps
//  the inner element in a `<div data-ai-feature data-testid>` marker so the off-mode invariant tests
//  have a stable selector, and it throws at construction for an unknown feature id. This file is the
//  Foundation-only heart of the native peer: the registry guard, the fail-closed gate truth table
//  (the verbatim port of `useAiEnabled`), the coalesced input snapshot, and the marker builder. No
//  SwiftUI, no store, no network — so every branch is unit testable in isolation.
//
//  Parity note: the gate is a pure function of three things the web hook reads — whether the feature
//  id is registered (`AI_FEATURES[feature]`), the resolution + AI mode of the settings query
//  (`useSettings` → `settings.ai_mode`), and the per-feature opt-in flag
//  (`settings.ai_features[feature] === true`). Every non-enabled condition collapses to the same
//  fail-closed verdict (web `false` → `null`), mirroring the backend `guard.Wrap` 404 (ADR-015 §I6).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened`
/// (P1/S11). The web HOC is anonymous (it has no slug of its own); the prompt assigns this surface
/// the canonical slug `withAiFeature`, kept here (SwiftUI-free) so the state-holder can emit
/// telemetry without depending on the view layer.
public enum AiFeatureGateSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "withAiFeature"
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the settings snapshot backing the gate — the orthogonal connectivity axis the
/// native P4 leaf contract layers over every surface. The transparent HOC renders no freshness
/// chrome of its own (the inner content owns all visible UI), so this axis only drives the one-shot
/// auto-refresh + telemetry timing, never an added chip or banner.
public enum AiFeatureGateConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Settings inputs (web `useSettings` → `useAiEnabled`)

/// The resolution state of the settings query backing the gate — the native shape of the
/// `useSettings` lifecycle the web `useAiEnabled` reads. `loading` and `failed` both fail the gate
/// closed (web `if (!settings) return false`); `resolved` lets the mode + flag decide.
public enum AiFeatureGateSettingsStatus: String, Sendable, Equatable, CaseIterable {
    case loading
    case resolved
    case failed
}

/// The AI mode from settings (web `settings.ai_mode`). `off` blocks every AI surface
/// unconditionally (ADR-015 §I1); `local` / `cloud` permit a per-feature opt-in. A missing mode
/// (`nil`) is treated as off-equivalent, matching the web `ai_mode === undefined` guard.
public enum AiFeatureGateMode: String, Sendable, Equatable, CaseIterable {
    case off
    case local
    case cloud
}

/// One coalesced snapshot of the gate's inputs — the registered feature id (web
/// `withAiFeature(feature, …)`), the settings resolution state, the AI mode, the per-feature opt-in
/// flag (web `settings.ai_features[feature] === true`), and the P4 connectivity axis. The gate is a
/// pure function of the first four fields.
public struct AiFeatureGateInput: Sendable, Equatable {
    public var featureID: String
    public var status: AiFeatureGateSettingsStatus
    public var mode: AiFeatureGateMode?
    public var featureEnabled: Bool
    public var connection: AiFeatureGateConnection

    public init(
        featureID: String,
        status: AiFeatureGateSettingsStatus = .loading,
        mode: AiFeatureGateMode? = nil,
        featureEnabled: Bool = false,
        connection: AiFeatureGateConnection = .live
    ) {
        self.featureID = featureID
        self.status = status
        self.mode = mode
        self.featureEnabled = featureEnabled
        self.connection = connection
    }
}

// MARK: - Registry guard (web `AI_FEATURES[feature]` + the HOC construction-time throw)

/// The error the construction-time guard raises for an unregistered feature id — the native peer of
/// the web HOC's `throw new Error("withAiFeature: unknown AI feature id …")`, which fires the first
/// time the module is imported so a typo is caught early rather than silently rendering nothing
/// forever.
public enum AiFeatureGateError: Error, Equatable {
    case unknownFeature(String)
}

/// Validates a feature id against the canonical AI-feature registry — the native mirror of the web
/// `AI_FEATURES[feature]` lookup. The registry itself is the generated `AIFeatureRegistry` (the
/// native peer of `web/src/ai/features.ts`), reused here rather than duplicated so backend, web, and
/// Apple cannot drift.
public enum AiFeatureRegistryGuard {
    /// `true` iff `feature` is a registered AI feature id (web `Boolean(AI_FEATURES[feature])`).
    public static func isKnown(_ feature: String) -> Bool {
        AIFeatureRegistry.all.contains { $0.id == feature }
    }

    /// Throws ``AiFeatureGateError/unknownFeature(_:)`` for an unregistered id — the native peer of
    /// the web HOC's construction-time throw. Callers that want the fail-closed runtime posture
    /// (web `useAiEnabled` → `false`) use ``AiFeatureGate/evaluate(_:)`` instead, which folds this
    /// guard into the `unknownFeature` verdict.
    public static func validate(_ feature: String) throws {
        guard isKnown(feature) else { throw AiFeatureGateError.unknownFeature(feature) }
    }
}

// MARK: - Gate (verbatim port of `useAiEnabled(feature)`)

/// The resolved AI-Off gate verdict — the native mirror of `withAiFeature` / `useAiEnabled`. The web
/// hook collapses every non-enabled condition into a single `false` → `null`; this enum preserves
/// the distinction the native peer needs for diagnostics and tests while keeping the exact same
/// fail-closed verdict via ``isPresented``.
public enum AiFeatureGate: String, Sendable, Equatable, CaseIterable {
    /// The feature id is not in the registry (web `if (!AI_FEATURES[feature]) return false`).
    case unknownFeature
    /// The settings query has not resolved yet (web `if (!settings) return false`).
    case unresolved
    /// The settings query failed (web `if (!settings) return false`).
    case failed
    /// Resolved, but AI mode is off/undefined or the per-feature flag is not exactly `true`
    /// (web `ai_mode === 'off'` / `flags[feature] !== true` → `false`).
    case disabled
    /// Resolved, AI mode on, and the per-feature flag is exactly `true` (web `true`).
    case enabled

    /// The web `useAiEnabled` boolean — `true` only in ``enabled``. Anything else is fail-closed,
    /// so the wrapped surface is withdrawn (web `null`).
    public var isPresented: Bool {
        self == .enabled
    }

    /// Evaluate the gate from an input snapshot — the verbatim port of the `useAiEnabled` truth
    /// table:
    ///   1. `AI_FEATURES[feature]` missing → fail closed (`unknownFeature`).
    ///   2. settings unresolved / failed → fail closed.
    ///   3. `ai_mode` missing or `off` → fail closed (`disabled`).
    ///   4. `ai_features[feature] !== true` → fail closed (`disabled`).
    ///   5. otherwise → `enabled`.
    public static func evaluate(_ input: AiFeatureGateInput) -> AiFeatureGate {
        guard AiFeatureRegistryGuard.isKnown(input.featureID) else { return .unknownFeature }
        switch input.status {
        case .loading:
            return .unresolved
        case .failed:
            return .failed
        case .resolved:
            guard let mode = input.mode, mode != .off else { return .disabled }
            return input.featureEnabled ? .enabled : .disabled
        }
    }

    /// The web `useAiEnabled` boolean verdict for an input — `evaluate(_:).isPresented`. Exposed as
    /// a named entry point so the fail-closed truth table is asserted directly.
    public static func isEnabled(_ input: AiFeatureGateInput) -> Bool {
        evaluate(input).isPresented
    }
}

// MARK: - Marker (web `data-ai-feature` / `data-testid` + `displayName`)

/// Builds the stable identifiers the web wrapper stamps onto its host `<div>`, reproduced natively
/// so the off-mode invariant UI tests have the same selector contract.
public enum AiFeatureMarker {
    /// The accessibility identifier applied to the presented inner content — the native peer of the
    /// web `data-testid`. Defaults to the web fallback `ai-feature-<id>` (web
    /// `meta.uiTestIds[0] ?? \`ai-feature-${feature}\``); a caller that knows the feature's
    /// registered ui-test id passes it explicitly via `testID`.
    public static func identifier(feature: String, testID: String? = nil) -> String {
        testID ?? "ai-feature-\(feature)"
    }

    /// The human-readable debug name for the wrapped surface — the native peer of the web
    /// `Wrapped.displayName = \`withAiFeature(${feature}, ${innerName})\``, surfaced so a developer
    /// inspecting the gate can see which feature flag controls it.
    public static func displayName(feature: String, inner: String) -> String {
        "withAiFeature(\(feature), \(inner))"
    }
}
