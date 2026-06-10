//
//  AIChatbotIndicator.Adapter.swift
//  TeslaSync — P4 shared surface · 0012 · AIChatbotIndicator (Apple)
//
//  The testable, dependency-light core for the chatbot AI-mode indicator — the SwiftUI parity of
//  `components/ai/AIChatbotIndicator.tsx`. Everything here is pure (Foundation only): the AI-Off
//  gate truth table (the verbatim port of `useAiEnabled('chatbot-llm')`), the input snapshot that
//  feeds it, the P4 connectivity axis, the surface metadata (feature id + diagnostics slug), and
//  the VoiceOver label builder. No store, no bundle, no rendered view, so each piece is unit tested
//  in isolation.
//
//  Parity note: the web surface is `withAiFeature('chatbot-llm', InnerIndicator)`. The HOC reads
//  `useAiEnabled('chatbot-llm')` (which folds `useSettings`) and renders `null` unless the feature
//  is on end-to-end; when on, the inner body is a small cyan "Helix" chip. This core reproduces the
//  gate's exact fail-closed predicate (unresolved / errored / mode-off / flag-off all withdraw the
//  surface, ADR-015 §I6) and adds the P4 leaf freshness axis the native surface renders over it.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity resolver.
public typealias AIChatbotResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the settings snapshot backing the gate — the orthogonal connectivity axis the
/// presented badge renders as a freshness dot. `live` shows the badge alone; `stale` adds a refresh
/// affordance and triggers a one-shot auto-refresh; `offline` keeps the last-known badge with an
/// offline marker.
public enum AIChatbotConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Settings inputs (web `useSettings` → `useAiEnabled`)

/// The resolution state of the settings query backing the gate — the native shape of the
/// `useSettings` lifecycle the web `useAiEnabled` reads. `loading` and `failed` both fail the gate
/// closed (web `if (!settings) return false`); `resolved` lets the mode + flag decide.
public enum AIChatbotSettingsStatus: String, Sendable, Equatable, CaseIterable {
    case loading
    case resolved
    case failed
}

/// The AI mode from settings (web `settings.ai_mode`). `off` blocks every AI surface unconditionally
/// (ADR-015 §I1); `local` / `cloud` permit a per-feature opt-in. A missing mode (`nil`) is treated
/// as off-equivalent, matching the web `ai_mode === undefined` guard.
public enum AIChatbotMode: String, Sendable, Equatable, CaseIterable {
    case off
    case local
    case cloud
}

/// One coalesced snapshot of the surface's inputs — the settings resolution state, the AI mode, the
/// per-feature opt-in flag (web `settings.ai_features['chatbot-llm'] === true`), and the P4
/// connectivity axis. The view binds the model over this; the gate is a pure function of the first
/// three fields.
public struct AIChatbotIndicatorInput: Sendable, Equatable {
    public var status: AIChatbotSettingsStatus
    public var mode: AIChatbotMode?
    public var featureEnabled: Bool
    public var connection: AIChatbotConnection

    public init(
        status: AIChatbotSettingsStatus = .loading,
        mode: AIChatbotMode? = nil,
        featureEnabled: Bool = false,
        connection: AIChatbotConnection = .live
    ) {
        self.status = status
        self.mode = mode
        self.featureEnabled = featureEnabled
        self.connection = connection
    }
}

// MARK: - Gate (verbatim port of `useAiEnabled('chatbot-llm')`)

/// The resolved AI-Off gate state — the native mirror of `withAiFeature` / `useAiEnabled`. The web
/// hook collapses every non-enabled condition into a single `false` → `null`; this enum preserves
/// the distinction the native surface needs to render the right chrome (a skeleton while the
/// settings resolve, a retry affordance if they fail) while keeping the exact same fail-closed
/// verdict via ``isPresented``.
public enum AIChatbotGate: String, Sendable, Equatable, CaseIterable {
    /// Settings query not yet resolved (web `!settings` → `false`).
    case unresolved
    /// Settings query failed (web `!settings` → `false`).
    case failed
    /// Resolved, but the AI mode is off/undefined or the per-feature flag is not exactly `true`
    /// (web `ai_mode === 'off'` / `flags[feature] !== true` → `false`).
    case disabled
    /// Resolved, AI mode on, and the per-feature flag is exactly `true` (web `true`).
    case enabled

    /// The web `useAiEnabled` boolean — `true` only in ``enabled``. Anything else is fail-closed.
    public var isPresented: Bool {
        self == .enabled
    }

    /// Evaluate the gate from an input snapshot — the verbatim port of the `useAiEnabled` truth
    /// table (`AI_FEATURES[feature]` is statically known for `chatbot-llm`, so the registry guard is
    /// always satisfied here):
    ///   1. settings unresolved/failed → fail closed.
    ///   2. `ai_mode` missing or `off` → fail closed.
    ///   3. `ai_features['chatbot-llm'] !== true` → fail closed.
    ///   4. otherwise → enabled.
    public static func evaluate(_ input: AIChatbotIndicatorInput) -> AIChatbotGate {
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

    /// The web `useAiEnabled` boolean verdict for an input — `evaluate(_:).isPresented`. Exposed as a
    /// named entry point so the fail-closed truth table is asserted directly.
    public static func isEnabled(_ input: AIChatbotIndicatorInput) -> Bool {
        evaluate(input).isPresented
    }
}

// MARK: - Surface metadata (web `withAiFeature` id + diagnostics slug)

/// The static identity of the surface — the AI feature id it is gated by (web
/// `withAiFeature('chatbot-llm', …)`) and the P1/S11 diagnostics slug emitted with `view.opened`.
public enum AIChatbotIndicatorMeta {
    /// The AI feature id this surface is gated by (web `withAiFeature('chatbot-llm', …)`).
    public static let featureID = "chatbot-llm"

    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIChatbotIndicator"
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken content is
/// asserted without rendering the view. The presented badge reads the Helix brand name (web
/// `aria-label = t('helix.ariaLabel','Helix')`), suffixed with the freshness note when the snapshot
/// is not live so a non-sighted user learns the badge reflects a stale / offline state.
public enum AIChatbotAccessibility {
    /// The badge's accessibility label: the brand name when live, else "{brand}, {freshnessNote}".
    public static func badgeLabel(brand: String, connection: AIChatbotConnection, freshnessNote: String) -> String {
        connection == .live ? brand : "\(brand), \(freshnessNote)"
    }
}
