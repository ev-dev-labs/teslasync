//
//  CommandSearch.Models.swift
//  TeslaSync — P4 feature view · 0225 · CommandSearch (Apple)
//
//  The Foundation-only value types for the vehicle-command search box: the inbound command DTO (web
//  `CommandDef`), the injected pre-localized copy, and the phase / load-status / connection enums.
//  Free of SwiftUI so the projection logic compiles and tests on a plain host. Parity target:
//  features/system/components/CommandSearch.tsx — the controlled `Input` that drives the client-side
//  `COMMANDS.filter(…)` in features/system/components/VehicleCommandCenter.tsx.
//

import Foundation

// MARK: - Inbound DTO (web `CommandDef`)

/// One searchable vehicle command — the SwiftUI parity of the web `CommandDef` the
/// `VehicleCommandCenter` filters. Only the fields the search + result row need are carried: the
/// stable id, the raw `command` token (web `c.command`, e.g. `flash_lights`), the already-localized
/// title (web `t(c.labelKey, c.labelFallback)`), an optional sub-label (web `sublabelFallback`), the
/// category token (web `c.category`, e.g. `security`), and an optional SF Symbol for the row glyph.
public struct CommandDTO: Sendable, Equatable, Identifiable {
    /// Stable identity (web `c.id`).
    public var id: String
    /// The raw command token, matched verbatim against the query (web `c.command.includes(q)`).
    public var command: String
    /// The localized, human-readable label shown in the row and matched against the query
    /// (web `t(c.labelKey, c.labelFallback).toLowerCase().includes(q)`).
    public var title: String
    /// An optional second line for the row (web `sublabelFallback`).
    public var subtitle: String?
    /// The category token, matched against the query and shown as a chip (web `c.category`).
    public var category: String
    /// Optional SF Symbol name for the row glyph (web tiles render a lucide icon); a generic glyph is
    /// used when `nil` so no per-command icon table is hardcoded here.
    public var systemImage: String?

    public init(
        id: String,
        command: String,
        title: String,
        subtitle: String? = nil,
        category: String,
        systemImage: String? = nil
    ) {
        self.id = id
        self.command = command
        self.title = title
        self.subtitle = subtitle
        self.category = category
        self.systemImage = systemImage
    }
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized strings the projector needs: the search field's VoiceOver label (the web `Input`
/// carries the placeholder `t('commands.search.placeholder', 'Search commands...')`) and the role // parity:allow ui
/// word spoken before each result. Injected so the projection stays Foundation-only and host-testable
/// (the view resolves the real catalog copy through the P1/S10 facade).
public struct CommandSearchCopy: Sendable, Equatable {
    /// The search field's VoiceOver label (the un-elided form of the web placeholder). // parity:allow ui
    public var fieldLabel: String
    /// The VoiceOver role spoken before each matched command's title (native a11y enrichment).
    public var commandRole: String

    public init(fieldLabel: String = "Search commands", commandRole: String = "Command") {
        self.fieldLabel = fieldLabel
        self.commandRole = commandRole
    }

    /// English fallbacks — used by previews + tests.
    public static let fallback = CommandSearchCopy()
}

// MARK: - Render phase (the result-area envelope around the web client-side filter)

/// What the result area should render. The web `VehicleCommandCenter` returns `null` from its
/// `filteredCommands` memo while the box is empty (showing favorites / category groups), a tile grid
/// when matches exist, and the `commands.search.noResults` line when a query matches nothing; it also
/// shows a loading affordance while the command-status query is in flight and a failure state if it
/// errors. The native surface reproduces that whole envelope so every prompt state renders.
public enum CommandSearchPhase: Sendable, Equatable {
    /// The box is empty (web `!search.trim()` → `null`) — a "type to search" hint, never a blank box.
    case idle
    /// The command catalog / status is still resolving (web `isLoading`).
    case loading
    /// Searching with ≥1 match (web tile grid).
    case content
    /// Searching with no matches (web `commands.search.noResults`).
    case empty
    /// The command catalog failed to load (web query error).
    case error(String)
}

/// The bound source's load status for the command catalog (web command-status query
/// disabled / loading / resolved / failure).
public enum CommandSearchLoadStatus: Sendable, Equatable {
    /// Nothing requested yet (the catalog has not arrived) — treated as loading by the resolver.
    case idle
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner. Mirrors the
/// web command center's `isStale` (`commands.staleData`) and `isAsleep` (wake-first) treatments so a
/// cached command list is clearly labelled while the vehicle is stale / asleep.
public enum CommandSearchConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}
