//
//  SettingsSearch.Projection.swift
//  TeslaSync — P4 feature view · 0215 · SettingsSearch (Apple)
//
//  The projected output types for the settings find-as-you-type box (one matched setting row + the
//  whole result projection), the diagnostics surface slug, the deep-link destination parsed from a
//  matched entry's `href` (web `navigate(entry.href)` + the `#anchor` split), and the VoiceOver summary
//  builder. Foundation-only so it executes on a plain host and is pinned by tests.
//

import Foundation

// MARK: - Projected pieces

/// One matched setting row (web ranked listbox `<li>`): the title shown, the optional description
/// second line, the section token, the deep-link `href`, the row glyph, a stable identity (web
/// `entry.id`), and a combined VoiceOver label.
public struct SettingsMatch: Sendable, Equatable, Identifiable {
    /// Stable identity — the web `SettingsEntry.id`.
    public var id: String
    /// The localized setting title shown in the row (web `entry.title`).
    public var title: String
    /// An optional second line (web `entry.description`); `nil` when the entry has no description.
    public var description: String?
    /// The section token (web `entry.section`); shown as a chip and used for grouping.
    public var section: String
    /// The deep-link target activated on selection (web `entry.href`).
    public var href: String
    /// The row glyph (an SF Symbol name); the view falls back to a generic glyph when `nil`.
    public var systemImage: String?
    /// The combined VoiceOver label (role word + title + optional description).
    public var accessibilityLabel: String

    public init(
        id: String,
        title: String,
        description: String? = nil,
        section: String,
        href: String,
        systemImage: String? = nil,
        accessibilityLabel: String
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.section = section
        self.href = href
        self.systemImage = systemImage
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The fully projected match list (web ranked + sliced `matches`): the highest-scoring entries in
/// descending score order, capped at `SettingsSearchProjector.maxResults`. An empty list while
/// searching reproduces the web `settings.search.noResults` state.
public struct SettingsSearchProjection: Sendable, Equatable {
    public var matches: [SettingsMatch]

    public init(matches: [SettingsMatch]) {
        self.matches = matches
    }

    /// Whether the result area shows rows (vs its empty / idle / loading states).
    public var hasMatches: Bool {
        !matches.isEmpty
    }

    public static let empty = SettingsSearchProjection(matches: [])
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free core
/// so it is reachable from the projection's unit tests.
public enum SettingsSearchSurface {
    public static let slug = "SettingsSearch"
}

// MARK: - Deep-link destination (web `navigate(entry.href)` + `entry.href.split('#')`)

/// The parsed target of a selected setting — the native projection of the web `commit(entry)`:
/// `navigate(entry.href)` followed by a `entry.href.split('#')[1]` scroll-to-anchor. The host resolves
/// `path` to a route and scrolls to `fragment` (the section anchor) when present, so the view stays
/// host-free. `raw` preserves the original href for the host's analytics / fallback routing.
public struct SettingsDestination: Sendable, Equatable {
    /// The original, unmodified href (web `entry.href`).
    public var raw: String
    /// The path portion, before any `#` (web `entry.href` minus the hash).
    public var path: String
    /// The anchor after `#`, or `nil` when the href has no fragment (web `entry.href.split('#')[1]`).
    public var fragment: String?

    public init(raw: String, path: String, fragment: String?) {
        self.raw = raw
        self.path = path
        self.fragment = fragment
    }

    /// Splits an href into its path + optional `#fragment`, mirroring the web `split('#')`. An empty
    /// fragment (a trailing `#`) resolves to `nil` so the host does not scroll to an empty anchor.
    public static func from(href: String) -> SettingsDestination {
        guard let hashIndex = href.firstIndex(of: "#") else {
            return SettingsDestination(raw: href, path: href, fragment: nil)
        }
        let path = String(href[href.startIndex ..< hashIndex])
        let fragment = String(href[href.index(after: hashIndex)...])
        return SettingsDestination(raw: href, path: path, fragment: fragment.isEmpty ? nil : fragment)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly like the
/// view's P1/S10 facade.
public enum SettingsSearchAccessibility {
    /// The spoken status of the result area for the current phase. `count` is the resolved match count
    /// (only meaningful for `.content`).
    public static func resultsSummary(
        for phase: SettingsSearchPhase,
        count: Int,
        localize: (String, String) -> String
    ) -> String {
        switch phase {
        case .idle:
            return localize("settingsSearch.a11y.idle", "Type to search settings")
        case .loading:
            return localize("settingsSearch.a11y.loading", "Loading settings")
        case .content:
            let template = localize("settingsSearch.a11y.results", "%d settings match your search")
            return String(format: template, count)
        case .empty:
            return localize("settings.search.noResults", "No matching settings.")
        case .error:
            return localize("settingsSearch.a11y.error", "Couldn't load settings")
        }
    }
}
