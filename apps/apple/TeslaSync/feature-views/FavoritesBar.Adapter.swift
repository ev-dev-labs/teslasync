//
//  FavoritesBar.Adapter.swift
//  TeslaSync — P4 feature view · 0227 · FavoritesBar (Apple)
//
//  The testable projection core for the favorites quick-actions bar — the faithful port
//  of features/system/components/FavoritesBar.tsx. Everything here is pure and
//  dependency-free (Foundation only) so it can be unit-tested without a bundle or a
//  rendered view.
//
//  Web parity notes:
//    • The web bar computes `favCmds = commands.filter(c => favorites.includes(c.id))`
//      and returns `null` when that list is empty. The native projection reproduces the
//      filter exactly (registry order preserved, each command at most once) and exposes
//      the count; the empty branch maps to the prompt-mandated friendly empty phase
//      rather than a hidden surface.
//    • Cached favorites survive a refresh / failure (freshness shown by the chip +
//      banner), exactly like the reference list surfaces — only a resolved-but-empty set
//      collapses to `.empty`.
//

import Foundation

// MARK: - Projection core (pure)

/// The dependency-free derivations the surface needs: the favorited-command list (web
/// `commands.filter(...)`) and the top-level phase from the load status + favorite count.
public enum FavoritesProjection {
    /// Web `commands.filter(c => favorites.includes(c.id))`: keeps the registry order
    /// (not the favorites order) and yields each command at most once, since the source
    /// of truth is the de-duplicated command list.
    public static func favoriteCommands(
        favorites: [String],
        commands: [FavoriteCommand]
    ) -> [FavoriteCommand] {
        let favoriteSet = Set(favorites)
        return commands.filter { favoriteSet.contains($0.id) }
    }

    /// Resolves the render phase. Cached favorites survive a refresh/failure (freshness
    /// shown by the banner); only an empty resolved set maps to the friendly empty.
    public static func resolvePhase(
        _ status: FavoritesLoadStatus,
        favoriteCount: Int
    ) -> FavoritesPhase {
        let hasData = favoriteCount > 0
        switch status {
        case .loading:
            return hasData ? .content : .loading
        case .loaded:
            return hasData ? .content : .empty
        case let .failed(message):
            return hasData ? .content : .error(message)
        }
    }
}

// MARK: - Accessibility (VoiceOver summary)

/// Builds the surface's VoiceOver summary. Copy resolves through an injected localizer so
/// the summary is testable without a bundle, exactly like the views' P1/S10 facade.
public enum FavoritesAccessibility {
    /// The bar summary: the "Quick Actions" title (web `commands.cat.quickActions`) plus
    /// how many favorites are currently pinned.
    public static func summary(count: Int, localize: (String, String) -> String) -> String {
        let title = localize("commands.cat.quickActions", "Quick Actions")
        guard count > 0 else {
            let none = localize("commands.favorites.a11yNone", "no favorites yet")
            return "\(title): \(none)"
        }
        let template = localize("commands.favorites.a11yCount", "{{count}} favorites")
        let detail = template.replacingOccurrences(of: "{{count}}", with: "\(count)")
        return "\(title): \(detail)"
    }
}
