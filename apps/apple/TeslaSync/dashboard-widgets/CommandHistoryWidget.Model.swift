//
//  CommandHistoryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0029 · CommandHistoryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade
//  (P1/S10). The view binds through `CommandModel`; no networking lives in the view.
//
//  SwiftUI parity of features/dashboard/widgets/CommandHistoryWidget.tsx — the
//  composable "Command History" surface that lists the recent vehicle commands
//  (lock / unlock / climate …) newest-first with their success / failed / pending
//  status, collapsing to the single latest command + a status badge when narrow.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol CommandTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogCommandTelemetry: CommandTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from the `useCommandHistory` query.
public enum CommandLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header freshness chip + the cached-data banner (web `DataFreshness` indicator
/// fed by the shell's `isStale` / `updatedAt`).
public enum CommandConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One cached command-log entry (web `CommandLogEntry`). Only the fields the web
/// `CommandHistoryWidget` reads are modeled; the production source projects these
/// from the shared commands store (web `useCommandHistory`). `command` is the raw
/// command token (web `command`, formatted for display); `status` is the raw
/// success / failed / pending token (web `status`).
public struct CommandInput: Sendable, Equatable {
    public var id: Int64?
    public var vehicleID: Int64
    public var command: String?
    public var status: String?
    public var createdAt: Date?

    public init(
        id: Int64? = nil,
        vehicleID: Int64,
        command: String? = nil,
        status: String? = nil,
        createdAt: Date? = nil
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.command = command
        self.status = status
        self.createdAt = createdAt
    }

    /// Web `cmd.created_at ?? new Date(0).toISOString()` — the timestamp the feed
    /// sorts + renders on, defaulting to the Unix epoch when the entry has none.
    public var displayTimestamp: Date {
        createdAt ?? Date(timeIntervalSince1970: 0)
    }

    /// Web feed-row `id: cmd.id`, with a `${vehicle_id}-${ts}` fallback so rows
    /// stay stable even when an entry arrives without an id.
    public var stableID: String {
        if let id { return String(id) }
        return "\(vehicleID)-\(Int(displayTimestamp.timeIntervalSince1970))"
    }
}

/// One coalesced snapshot pushed by a `CommandSource`: the cached commands plus
/// their load/connection status. The model turns this into the feed projection.
public struct CommandUpdate: Sendable, Equatable {
    public var status: CommandLoadStatus
    public var connection: CommandConnection
    public var commands: [CommandInput]
    public var updatedAt: Date?

    public init(
        status: CommandLoadStatus = .loading,
        connection: CommandConnection = .live,
        commands: [CommandInput] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.commands = commands
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the vehicles store (web `useVehicles`,
/// `id = vehicleId ?? vehicles[0].id`) with the command-history query (web
/// `useCommandHistory('/vehicles/{id}/commands/history?limit=200')`). Previews +
/// tests use `InMemoryCommandSource`. The view never talks to the network directly.
@MainActor
public protocol CommandSource: AnyObject {
    var onUpdate: (@MainActor (CommandUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `CommandSource`, recomputes
/// the `CommandFeedItem` projection (raw order, mirroring the web `feedItems` map),
/// and exposes a render `Phase` + freshness for SwiftUI to switch over. Size-agnostic:
/// the view applies the compact gate + feed cap (web `isCompact` / `maxItems`) via
/// `CommandLayout`.
@MainActor
@Observable
public final class CommandModel {
    /// The mutually-exclusive render branches (web shell loading / content / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: CommandConnection = .live
    /// The projected rows in source order (web `feedItems` map over `list`); the
    /// feed view sorts + caps them, the compact view reads `latest` (web `list[0]`).
    public private(set) var items: [CommandFeedItem] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any CommandSource
    @ObservationIgnored private let telemetry: any CommandTelemetry
    @ObservationIgnored private var started = false

    public init(source: any CommandSource, telemetry: any CommandTelemetry = OSLogCommandTelemetry()) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The latest command (web `lastEntry = list[0]`) — the source-order first row,
    /// shown by the compact (≤ 1 column) layout.
    public var latest: CommandFeedItem? {
        items.first
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CommandHistoryWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached value stays visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: CommandUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        items = CommandFeedBuilder.build(commands: update.commands)
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web only shows the shell skeleton on the
    /// initial fetch (no rows yet) and the "No commands sent" empty state when the
    /// resolved list is empty; whenever commands are known the widget renders
    /// (cached rows stay visible behind refresh/errors, with the freshness chip +
    /// banner reflecting staleness/offline/failure).
    public static func resolvePhase(_ update: CommandUpdate) -> Phase {
        let hasCommands = !update.commands.isEmpty
        switch update.status {
        case .loading:
            return hasCommands ? .content : .loading
        case .empty:
            return .empty
        case .loaded:
            return hasCommands ? .content : .empty
        case let .failed(message):
            return hasCommands ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryCommandSource: CommandSource {
    public var onUpdate: (@MainActor (CommandUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CommandUpdate?

    public init(initial: CommandUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: CommandUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/commands.ts → "command-history")

public extension CommandHistoryWidget {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static let surfaceSlug = "CommandHistoryWidget"

    /// Canonical registry metadata (registry/commands.ts → "command-history").
    static let registration = DashboardWidgetRegistration(
        id: "command-history",
        nameKey: "widget.commandHistory",
        descriptionKey: "widget.commandHistory.description",
        category: "commands",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "CommandHistoryWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum CommandStrings {
    public static let table = "CommandHistoryWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
