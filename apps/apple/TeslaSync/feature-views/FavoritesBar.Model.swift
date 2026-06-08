//
//  FavoritesBar.Model.swift
//  TeslaSync — P4 feature view · 0227 · FavoritesBar (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `FavoritesBar` is a
//  controlled, presentational component — its parent command center owns the favorite-id
//  list + the command registry and passes a `renderTile` callback. The native surface
//  reproduces that contract: a `FavoritesSource` pushes the favorite ids + the registry +
//  the load / freshness status, and the model holds that state, derives the favorited
//  command list through the pure adapter, exposes the resolved `FavoritesPhase` for
//  SwiftUI to switch over, forwards the tile intents to the host through the action sink,
//  and emits the P1/S11 `view.opened` event once on first appearance. No networking lives
//  in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `FavoritesSource`, holds the
/// latest favorites + registry + freshness, exposes the derived favorited commands +
/// resolved phase, forwards execute / toggle intents, and emits the diagnostics event.
@MainActor
@Observable
public final class FavoritesBarModel {
    // Load + freshness (from the source)
    public private(set) var phase: FavoritesPhase = .loading
    public private(set) var connection: FavoritesConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var favorites: [String] = []
    public private(set) var commands: [FavoriteCommand] = []

    @ObservationIgnored private let source: any FavoritesSource
    @ObservationIgnored private let telemetry: any FavoritesTelemetry
    @ObservationIgnored private let actionSink: any FavoritesActionSink
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any FavoritesSource,
        telemetry: any FavoritesTelemetry = OSLogFavoritesTelemetry(),
        actionSink: any FavoritesActionSink = OSLogFavoritesActionSink(),
        localize: @escaping (String, String) -> String = FavoritesStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.actionSink = actionSink
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived state

    /// The favorited commands in registry order (web `commands.filter(...)`).
    public var favoriteCommands: [FavoriteCommand] {
        FavoritesProjection.favoriteCommands(favorites: favorites, commands: commands)
    }

    /// The favorited-command count (web `favCmds.length`) — drives the empty vs. content
    /// phase and the header counter.
    public var favoriteCount: Int {
        favoriteCommands.count
    }

    /// The VoiceOver summary for the bar.
    public var accessibilitySummary: String {
        FavoritesAccessibility.summary(count: favoriteCount, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FavoritesSurface.slug)
        source.start()
    }

    /// Stops observing the upstream favorites feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying favorites/registry queries (web refetch) — the error-state retry.
    public func refresh() {
        source.refresh()
    }

    // MARK: Tile intents (web `onExecute` / `onToggleFavorite`)

    /// Runs a command (web tile click → `onExecute`). Forwarded to the host sink.
    public func execute(_ command: FavoriteCommand) {
        actionSink.execute(command)
    }

    /// Pins/unpins a favorite (web `onToggleFavorite`). The bar only shows favorites, so a
    /// toggle unfavorites it: echo locally (optimistic, web parent removes from its set),
    /// re-resolve the phase so an emptied set collapses to the friendly empty, and forward
    /// to the host.
    public func toggleFavorite(_ command: FavoriteCommand) {
        favorites = favorites.filter { $0 != command.id }
        phase = FavoritesProjection.resolvePhase(.loaded, favoriteCount: favoriteCount)
        actionSink.toggleFavorite(command)
    }

    // MARK: Snapshot application

    private func apply(_ update: FavoritesBarUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        favorites = update.favorites
        commands = update.commands
        phase = FavoritesProjection.resolvePhase(update.status, favoriteCount: favoriteCount)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// favorites on screen and does not refetch.
    private func handleAutoRefresh(for connection: FavoritesConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
