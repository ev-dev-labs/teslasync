//
//  SettingsSearch.Models.swift
//  TeslaSync — P4 feature view · 0215 · SettingsSearch (Apple)
//
//  The Foundation-only value types for the settings find-as-you-type box: the indexed-setting DTO (web
//  `SettingsEntry` in features/settings/searchIndex.ts), the injected pre-localized copy, and the
//  render-phase / load-status / connection enums for the result-area envelope (ADR-013). Free of
//  SwiftUI so the scoring core compiles and is unit-tested on a plain host. Parity target:
//  features/settings/components/SettingsSearch.tsx — the controlled `<Input>` that drives the
//  `searchSettings(getSettingsIndex(t), query)` ranker and a popover listbox of matches.
//

import Foundation

// MARK: - Inbound DTO (web `SettingsEntry`)

/// One user-discoverable setting in the search index — the SwiftUI parity of the web `SettingsEntry`
/// the `searchSettings` ranker scores. Carries the stable slug, the deep-link `href` (a hash anchor on
/// `/settings` or a full path on another page), the already-localized `title` + `description` shown in
/// the row and matched against the query, the `section` token, the verbatim `keywords` synonyms (never
/// translated in the web source), and an optional SF Symbol for the row glyph (native enrichment).
public struct SettingsEntry: Sendable, Equatable, Identifiable {
    /// Stable identity (web `entry.id`, e.g. `general.units.distance`).
    public var id: String
    /// Deep-link target (web `entry.href`, e.g. `/settings#general` or `/integrations/helix`).
    public var href: String
    /// The localized title shown in the row + matched against the query (web `t(titleKey, fallback)`).
    public var title: String
    /// The localized long description: the row's second line + a fuzzy-match haystack (web `description`).
    public var description: String
    /// The section token this entry belongs to (web `entry.section`, e.g. `general`).
    public var section: String
    /// Verbatim synonyms / abbreviations matched against the query (web `entry.keywords`, untranslated).
    public var keywords: [String]
    /// Optional SF Symbol name for the row glyph; the view falls back to a generic glyph when `nil`.
    public var systemImage: String?

    public init(
        id: String,
        href: String,
        section: String,
        title: String,
        description: String,
        keywords: [String] = [],
        systemImage: String? = nil
    ) {
        self.id = id
        self.href = href
        self.title = title
        self.description = description
        self.section = section
        self.keywords = keywords
        self.systemImage = systemImage
    }
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized strings the projector needs: the search field's VoiceOver label (the web `Input`
/// carries `aria-label={t('settings.search.label', 'Search settings')}`) and the role word spoken
/// before each matched setting. Injected so the projection stays Foundation-only and host-testable (the
/// view resolves the real catalog copy through the P1/S10 facade).
public struct SettingsSearchCopy: Sendable, Equatable {
    /// The search field's VoiceOver label (web `settings.search.label`).
    public var fieldLabel: String
    /// The VoiceOver role spoken before each matched setting's title (native a11y enrichment).
    public var settingRole: String

    public init(fieldLabel: String = "Search settings", settingRole: String = "Setting") {
        self.fieldLabel = fieldLabel
        self.settingRole = settingRole
    }

    /// English fallbacks — used by previews + tests.
    public static let fallback = SettingsSearchCopy()
}

// MARK: - Render phase (the result-area envelope around the web popover listbox)

/// What the result area should render. The web `SettingsSearch` shows nothing while the box is blank
/// (`showDropdown = open && query.length > 0`), the ranked listbox when matches exist, and the
/// `settings.search.noResults` line when a query matches nothing; the native surface also models the
/// catalog load + freshness (ADR-013) so every prompt state renders — never a blank box.
public enum SettingsSearchPhase: Sendable, Equatable {
    /// The box is blank (web `!query.length` → no dropdown) — a "type to search" hint, never a blank box.
    case idle
    /// The settings index is still resolving (native catalog load).
    case loading
    /// Searching with ≥1 match (web ranked listbox).
    case content
    /// Searching with no matches (web `settings.search.noResults`).
    case empty
    /// The settings index failed to build (native catalog error).
    case error(String)
}

/// The bound source's load status for the settings index (native catalog idle / loading / resolved /
/// failure). The web index is built synchronously from `t`, so production resolves to `.loaded`
/// immediately; the status exists so the envelope's loading / error branches still render + test.
public enum SettingsSearchLoadStatus: Sendable, Equatable {
    /// Nothing requested yet (the index has not arrived) — treated as loading by the resolver.
    case idle
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner. The web search
/// box has no connectivity state; `stale` / `offline` are the native additions so a cached index is
/// clearly labelled while the surface is reconnecting / offline.
public enum SettingsSearchConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `SettingsSearchSource`: the settings index + its load status, the
/// live-state connection, the in-flight flag, and the last-update timestamp (used by the stale banner's
/// age). The view-model resolves the render phase + freshness from it.
public struct SettingsSearchUpdate: Sendable, Equatable {
    public var status: SettingsSearchLoadStatus
    public var entries: [SettingsEntry]
    public var connection: SettingsSearchConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: SettingsSearchLoadStatus = .idle,
        entries: [SettingsEntry] = [],
        connection: SettingsSearchConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.entries = entries
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}
