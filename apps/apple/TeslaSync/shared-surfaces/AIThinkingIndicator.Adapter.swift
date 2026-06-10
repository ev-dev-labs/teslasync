//
//  AIThinkingIndicator.Adapter.swift
//  TeslaSync — P4 shared surface · 0053 · AIThinkingIndicator (Apple)
//
//  The testable, dependency-light core for the AI "thinking" indicator — the SwiftUI parity of
//  `components/ai/AIThinkingIndicator.tsx`. Everything here is pure (Foundation only): the i18n
//  resolver seam (the native shape of the web `useTranslation` `t(key, fallback)` call), the input
//  snapshot (the web `label?` prop), the surface metadata (diagnostics slug + the two label keys the
//  web source resolves), and the VoiceOver label builder. No store, no bundle, no rendered view, so
//  each piece is unit tested in isolation.
//
//  Parity note: the web source is the ONLY AI component that reads just `useTranslation` (no
//  `useAiStream`) — it is purely presentational, the streaming-pending affordance shown while every
//  other AI surface waits for its first SSE token. It therefore has no fetch / error / empty / stale
//  / offline data branch to mirror; reproducing such chrome would invent state the web source does
//  not have. The genuine render branches are (1) the full skeleton indicator vs the compact in-button
//  dots (the file's two exports), (2) motion vs Reduce Motion, and (3) the default label vs a caller
//  override. This core models exactly those, and nothing it does not have.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass a deterministic resolver.
public typealias AIThinkingResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Input (web `AIThinkingIndicatorProps`)

/// One coalesced snapshot of the surface's inputs — the optional leading-label override (web
/// `label?` prop). The view binds the model over this; the resolved label is a pure function of the
/// override plus the localized default.
public struct AIThinkingIndicatorInput: Sendable, Equatable {
    /// Optional caller override for the leading label (web `label` prop). When `nil`, the surface
    /// falls back to the localized default (`helix.thinking` → "Helix is thinking").
    public var labelOverride: String?

    public init(labelOverride: String? = nil) {
        self.labelOverride = labelOverride
    }
}

// MARK: - Surface metadata (diagnostics slug + web label keys)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened` and
/// the two i18n keys the web source references for its label.
public enum AIThinkingIndicatorMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIThinkingIndicator"

    /// The web runtime default label (`text = label ?? t('helix.thinking', 'Helix is thinking')`).
    public static let defaultLabelKey = "helix.thinking"
    public static let defaultLabelFallback = "Helix is thinking"

    /// The documented alternative label (the JSDoc default `t('ai.common.thinking', 'AI is thinking')`),
    /// available to callers that want the generic verb instead of the Helix brand.
    public static let altLabelKey = "ai.common.thinking"
    public static let altLabelFallback = "AI is thinking"
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver string from already-localized parts, so the spoken content is
/// asserted without rendering the view. The web container is `role="status" aria-live="polite"` with
/// only the label voiced (the dots, skeleton lines, and Helix mark are all `aria-hidden`); the spoken
/// name is therefore the resolved thinking label verbatim.
public enum AIThinkingAccessibility {
    /// The status label spoken for the indicator — the resolved thinking text (parity: the
    /// accessible name equals the single visible label).
    public static func statusLabel(_ resolvedLabel: String) -> String {
        resolvedLabel
    }
}
