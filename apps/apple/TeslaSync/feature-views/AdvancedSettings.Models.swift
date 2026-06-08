//
//  AdvancedSettings.Models.swift
//  TeslaSync — P4 feature view · 0198 · AdvancedSettings (Apple)
//
//  The Foundation-only value types for the "Restore confirmation prompts" panel — the SwiftUI parity
//  of features/settings/components/AdvancedSettings.tsx. Holds the persisted action-id constants (web
//  confirmSilence.ts `STORAGE_KEY` + the `discard-draft` / `unsaved-navigation` ids), the injected
//  pre-localized copy the pure projector needs (web `useSilenceKeyLabel` switch), and the render
//  phase / load-status / freshness enums. Free of SwiftUI so the projection logic compiles and tests
//  on a plain host.
//

import Foundation

// MARK: - Persisted identity (web confirmSilence.ts)

/// The stable, namespaced silence-key ids + the persistence key, mirroring `web/src/lib/confirmSilence.ts`
/// VERBATIM so the native store reads/writes the exact same payload the web app does.
public enum AdvancedSettingsConfig {
    /// Web `STORAGE_KEY = 'teslasync:confirm-silence:v1'` — a JSON array of silenced action ids.
    public static let storageKey = "teslasync:confirm-silence:v1"
    /// Web `discard-draft` action id (the "Discard unsaved draft" confirm).
    public static let discardDraftKey = "discard-draft"
    /// Web `unsaved-navigation` action id (the "Leave page with unsaved changes" confirm).
    public static let unsavedNavigationKey = "unsaved-navigation"
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized strings the projector needs — the web `useSilenceKeyLabel` switch (known ids get
/// a friendly label; unknown ids fall back to the raw key) plus the VoiceOver role word spoken before
/// each row. Injected so the projection stays Foundation-only and host-testable (the view resolves the
/// real catalog copy through the P1/S10 facade).
public struct AdvancedSettingsCopy: Sendable, Equatable {
    /// Web `t('settings.advanced.restoreConfirms.keys.discardDraft', 'Discard unsaved draft')`.
    public var discardDraftLabel: String
    /// Web `t('settings.advanced.restoreConfirms.keys.unsavedNavigation', 'Leave page with unsaved changes')`.
    public var unsavedNavigationLabel: String
    /// The VoiceOver role spoken before each silenced-prompt label (native a11y enrichment).
    public var promptRole: String

    public init(
        discardDraftLabel: String = "Discard unsaved draft",
        unsavedNavigationLabel: String = "Leave page with unsaved changes",
        promptRole: String = "Silenced prompt"
    ) {
        self.discardDraftLabel = discardDraftLabel
        self.unsavedNavigationLabel = unsavedNavigationLabel
        self.promptRole = promptRole
    }

    /// English fallbacks (match the web source literals) — used by previews + tests.
    public static let fallback = AdvancedSettingsCopy()
}

// MARK: - Render phase (the body envelope around the web two-branch list)

/// What the panel body should render. The web component shows exactly two branches — an `EmptyState`
/// when `silenced.length === 0` and the `<ul>` of restore rows otherwise — so the native surface
/// reproduces both, plus the standard P4 load envelope (loading skeleton / error retry) so every
/// prompt-required state renders. Never a blank box.
public enum AdvancedSettingsPhase: Sendable, Equatable {
    /// The persisted set is being read (initial fetch — skeleton chrome).
    case loading
    /// Resolved with ≥1 silenced prompt (web `<ul>` rows).
    case content
    /// Resolved with no silenced prompts (web `EmptyState`).
    case empty
    /// The persisted set could not be read (the standard P4 error envelope).
    case error(String)
}

/// The bound store's load status (read in flight / resolved / failed). The `UserDefaults` store
/// mirrors web `confirmSilence.load()` (a corrupt payload is treated as empty, never an error), so the
/// `.failed` case is reached only through an injected/remote store — but the view, previews, and tests
/// all render it, satisfying the "every state must render" contract.
public enum AdvancedSettingsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-state freshness (ADR-013): drives the freshness chip + the cached-rows banner. A purely-local
/// store is normally `.live`; `.stale` / `.offline` render the standard envelope when the seam reports
/// them (e.g. a future cross-device sync of silenced prompts).
public enum AdvancedSettingsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}
