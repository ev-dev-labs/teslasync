//
//  FavoritesBar.Core.swift
//  TeslaSync — P4 feature view · 0227 · FavoritesBar (Apple)
//
//  Pure, dependency-free support types for the favorites quick-actions bar — the
//  SwiftUI parity of features/system/components/FavoritesBar.tsx. The web bar is a
//  controlled, presentational component: its parent command center owns the favorite
//  command-id list + the command registry and passes them down with a `renderTile`
//  callback. These Foundation-only types model that contract (a favorited command, the
//  render phase / load status / freshness, and the diagnostics slug) so the projection +
//  state-holder stay unit-testable without a rendered view or a bundle.
//

import Foundation

// MARK: - Command variant (web `CommandDef.variant`)

/// The accent intent a command tile carries (web `'default' | 'danger' | 'success'`).
/// Resolved to a semantic design token at the render boundary (never a raw hue here).
public enum FavoriteCommandVariant: String, Sendable, Equatable, CaseIterable {
    case `default`
    case danger
    case success
}

// MARK: - Favorited command (web `CommandDef`, narrowed to the tile inputs)

/// One favorited command — the native projection of the web `CommandDef`, narrowed to
/// exactly the fields the favorites bar needs to filter (web `id`) and render a tile
/// (icon, label, optional sublabel, variant, dangerous flag). The web Lucide `icon`
/// becomes an SF Symbol name so the native tile stays HIG-idiomatic.
public struct FavoriteCommand: Sendable, Equatable, Identifiable {
    public let id: String
    public let command: String
    public let labelKey: String
    public let labelFallback: String
    public let sublabelKey: String?
    public let sublabelFallback: String?
    public let systemImage: String
    public let category: String
    public let variant: FavoriteCommandVariant
    public let dangerous: Bool

    public init(
        id: String,
        command: String,
        labelKey: String,
        labelFallback: String,
        sublabelKey: String? = nil,
        sublabelFallback: String? = nil,
        systemImage: String,
        category: String = "",
        variant: FavoriteCommandVariant = .default,
        dangerous: Bool = false
    ) {
        self.id = id
        self.command = command
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.sublabelKey = sublabelKey
        self.sublabelFallback = sublabelFallback
        self.systemImage = systemImage
        self.category = category
        self.variant = variant
        self.dangerous = dangerous
    }
}

// MARK: - Render phase / load status / freshness

/// What the surface renders at the top level. The web bar renders the favorites grid
/// when there are favorites and returns `null` when there are none; the native surface
/// reproduces every prompt-required state instead — loading / error / friendly empty /
/// content — so a resolved-but-empty set is a labeled empty rather than a blank box.
public enum FavoritesPhase: Sendable, Equatable {
    case loading
    case error(String)
    case empty
    case content
}

/// The bound source's load status for the favorites + command registry (web `isLoading`
/// / resolved / failure).
public enum FavoritesLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner
/// so a cached favorites set is clearly labeled while reconnecting / offline.
public enum FavoritesConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `FavoritesBar` feature view. The slug is the
/// value emitted with the P1/S11 `view.opened` diagnostics contract and is referenced by
/// both the view-model and its tests so the two never drift.
public enum FavoritesSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "FavoritesBar"

    /// Reports the surface becoming visible. Factored out so it is unit-testable without
    /// a rendering host (the model runs this exact path from `start()`).
    public static func reportOpen(to telemetry: any FavoritesTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}
