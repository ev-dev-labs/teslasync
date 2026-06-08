//
//  CommandSearch.Projection.swift
//  TeslaSync — P4 feature view · 0225 · CommandSearch (Apple)
//
//  The projected output types for the vehicle-command search (one matched command row + the whole
//  result projection), the diagnostics surface slug, and the VoiceOver summary builder. Foundation-
//  only so it executes on a plain host and is pinned by tests.
//

import Foundation

// MARK: - Projected pieces

/// One matched command row (web filtered tile): the title shown, the optional sub-label, the category
/// chip token, the row glyph, a stable identity (web `c.id`), and a combined VoiceOver label.
public struct CommandMatch: Sendable, Equatable, Identifiable {
    /// Stable identity — the web `CommandDef.id`.
    public var id: String
    /// The localized command title shown in the row (web `t(labelKey, labelFallback)`).
    public var title: String
    /// An optional second line (web `sublabelFallback`).
    public var subtitle: String?
    /// The category token shown as a chip + matched against the query (web `c.category`).
    public var category: String
    /// The row glyph (an SF Symbol name); the view falls back to a generic glyph when `nil`.
    public var systemImage: String?
    /// The combined VoiceOver label (role word + title + optional sub-label).
    public var accessibilityLabel: String

    public init(
        id: String,
        title: String,
        subtitle: String? = nil,
        category: String,
        systemImage: String? = nil,
        accessibilityLabel: String
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.category = category
        self.systemImage = systemImage
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The fully projected match list (web resolved `filteredCommands`): the commands whose title,
/// category, or command token contains the query, in catalog order. An empty list while searching
/// reproduces the web `commands.search.noResults` state.
public struct CommandSearchProjection: Sendable, Equatable {
    public var matches: [CommandMatch]

    public init(matches: [CommandMatch]) {
        self.matches = matches
    }

    /// Whether the result area shows rows (vs its empty / idle / loading states).
    public var hasMatches: Bool {
        !matches.isEmpty
    }

    public static let empty = CommandSearchProjection(matches: [])
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free core
/// so it is reachable from the projection's unit tests.
public enum CommandSearchSurface {
    public static let slug = "CommandSearch"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly like the
/// view's P1/S10 facade.
public enum CommandSearchAccessibility {
    /// The spoken status of the result area for the current phase. `count` is the resolved match
    /// count (only meaningful for `.content`).
    public static func resultsSummary(
        for phase: CommandSearchPhase,
        count: Int,
        localize: (String, String) -> String
    ) -> String {
        switch phase {
        case .idle:
            return localize("commandSearch.a11y.idle", "Type to search vehicle commands")
        case .loading:
            return localize("commandSearch.a11y.loading", "Loading commands")
        case .content:
            let template = localize("commandSearch.a11y.results", "%d commands match your search")
            return String(format: template, count)
        case .empty:
            return localize("commandSearch.a11y.empty", "No commands match your search")
        case .error:
            return localize("commandSearch.a11y.error", "Couldn't load commands")
        }
    }
}
