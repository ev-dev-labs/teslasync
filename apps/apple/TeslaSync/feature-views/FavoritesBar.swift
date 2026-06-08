//
//  FavoritesBar.swift
//  TeslaSync — P4 feature view · 0227 · FavoritesBar (Apple)
//
//  The favorites quick-actions bar — the SwiftUI parity of
//  features/system/components/FavoritesBar.tsx. Fades in on appear (web `FadeIn`), then
//  switches over the bound model's phase so every prompt-required state renders (loading /
//  error / friendly empty / content, with the stale + offline freshness branches inside
//  content) — never a blank box, unlike the web bar which returns `null` when empty. Binds
//  through `FavoritesBarModel` (P1/S8); no networking lives here. The tile renderer is
//  caller-supplied (web `renderTile`), with a production default (``FavoriteCommandTile``).
//

import SwiftUI

/// The favorites quick-actions bar, binding through `FavoritesBarModel` (P1/S8). Generic
/// over the tile view so callers can supply their own (web `renderTile`); the
/// ``init(model:)`` convenience wires the shared ``FavoriteCommandTile`` to the model.
public struct FavoritesBar<Tile: View>: View {
    @State private var model: FavoritesBarModel
    private let tile: (FavoriteCommand) -> Tile

    public init(
        model: FavoritesBarModel,
        @ViewBuilder tile: @escaping (FavoriteCommand) -> Tile
    ) {
        _model = State(initialValue: model)
        self.tile = tile
    }

    public var body: some View {
        TSFadeIn {
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The top-level branch: loading / failed without a cache map to skeleton / retry, a
    /// resolved-but-empty set maps to the friendly empty, and otherwise the favorites grid
    /// renders (with the stale + offline banner + freshness chip inside).
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            FavoritesLoadingState()
        case let .error(message):
            FavoritesErrorState(message: message) { model.refresh() }
        case .empty:
            FavoritesEmptyState()
        case .content:
            FavoritesContent(model: model, tile: tile)
        }
    }
}

// MARK: - Surface identity

public extension FavoritesBar {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        FavoritesSurface.slug
    }
}

// MARK: - Default-tile convenience

public extension FavoritesBar where Tile == FavoriteCommandTile {
    /// Builds the bar with the shared ``FavoriteCommandTile``, wiring each tile's execute +
    /// favorite-toggle intents back through the bound model (web parent's `onExecute` /
    /// `onToggleFavorite`).
    init(model: FavoritesBarModel) {
        self.init(model: model) { command in
            FavoriteCommandTile(
                command: command,
                onExecute: { model.execute(command) },
                onToggleFavorite: { model.toggleFavorite(command) }
            )
        }
    }
}
