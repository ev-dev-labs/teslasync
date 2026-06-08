//
//  FavoritesBar.Seams.swift
//  TeslaSync — P4 feature view · 0227 · FavoritesBar (Apple)
//
//  The dependency seams the FavoritesBar view-model binds through, kept apart from the
//  model for the lint length budget: the P1/S11 telemetry contract, the P1/S10 i18n
//  facade (web `useTranslation`), the action sink (web `onExecute` + `onToggleFavorite`
//  the parent wires into each tile), the coalesced source snapshot, the P1/S8 source
//  protocol, and the in-memory source for previews/tests. Foundation + OSLog only (no
//  SwiftUI / no network).
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted.
public protocol FavoritesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug
/// is a static, non-identifying constant logged verbatim; no payload is ever recorded.
public struct OSLogFavoritesTelemetry: FavoritesTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold
/// no hardcoded literals. Keys live in the "FavoritesBar" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// prompt owns its own strings.
public enum FavoritesStrings {
    public static let table = "FavoritesBar"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Action sink (web `onExecute` / `onToggleFavorite`)

/// Receives the tile intents the bar produces — running a command (web `onExecute`) and
/// pinning/unpinning a favorite (web `onToggleFavorite`) — so the host command center can
/// adopt them. The production app injects a sink wired to its command mutation +
/// favorites store; the default logs so the view stays I/O-free.
public protocol FavoritesActionSink: Sendable {
    func execute(_ command: FavoriteCommand)
    func toggleFavorite(_ command: FavoriteCommand)
}

/// `os.Logger`-backed default that records each tile intent for diagnostics. The command
/// id is a stable, non-identifying slug (e.g. `lock_doors`), so it is safe to log public.
public struct OSLogFavoritesActionSink: FavoritesActionSink {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "commands-favorites")
    }

    public func execute(_ command: FavoriteCommand) {
        logger.debug("commands.favorites.execute id=\(command.id, privacy: .public)")
    }

    public func toggleFavorite(_ command: FavoriteCommand) {
        logger.debug("commands.favorites.toggle id=\(command.id, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `FavoritesSource`: the favorite command ids (web
/// controlled prop), the full command registry, the load status, the live-state
/// freshness, the in-flight flag, and the last update time.
public struct FavoritesBarUpdate: Sendable, Equatable {
    public var status: FavoritesLoadStatus
    public var favorites: [String]
    public var commands: [FavoriteCommand]
    public var connection: FavoritesConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: FavoritesLoadStatus = .loading,
        favorites: [String] = [],
        commands: [FavoriteCommand] = [],
        connection: FavoritesConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.favorites = favorites
        self.commands = commands
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8
/// command + favorites state holder; previews/tests use `InMemoryFavoritesSource`. The
/// view never talks to the network directly.
@MainActor
public protocol FavoritesSource: AnyObject {
    var onUpdate: (@MainActor (FavoritesBarUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying favorites/registry queries (web refetch / stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryFavoritesSource: FavoritesSource {
    public var onUpdate: (@MainActor (FavoritesBarUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FavoritesBarUpdate?

    public init(initial: FavoritesBarUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial {
            onUpdate?(initial)
        }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: FavoritesBarUpdate) {
        onUpdate?(update)
    }
}
