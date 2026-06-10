//
//  NotificationRow.Source.swift
//  TeslaSync — P4 feature view · 0191 · NotificationRow (Apple)
//
//  The P1/S8 state-holder seam for the inbox notification-row surface: the raw
//  snapshot input (web `NotificationLog` + its resolved `rule` / `vehicle`), the
//  coalesced update envelope, the per-row action capabilities + result + toast, the
//  `NotificationRowSource` protocol the view-model binds through, and the in-memory
//  implementation previews + tests drive. The production app implements the protocol
//  over the shared inbox state holders (the `useNotificationLogs` row query plus the
//  read / archive mutations); the view never talks to the network.

//

import Foundation

// MARK: - Source input (raw → projected)

/// One coalesced raw notification row pushed by the source (the resolved per-row
/// display data the web parent computes through `ruleMap` / `vehicleMap`). Kept raw
/// (string severity, raw ISO timestamp) so the adapter's `?? 'info'` defaulting +
/// drill-through resolution stay tested.
public struct NotificationRowInput: Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
    public var message: String
    public var severityRaw: String?
    public var createdAt: Date
    public var isRead: Bool
    public var isArchived: Bool
    public var vehicleName: String?
    public var ruleName: String?
    /// Whether a rule is resolved (web `rule ? … : null`): gates the drill-through.
    public var hasRule: Bool
    /// The rule's telemetry signal (web `rule?.signal_name`), drives the destination.
    public var ruleSignal: String?
    /// The resolved drill-through vehicle id (web `vehicle?.id ?? rule?.vehicle_id ?? 0`).
    public var drillVehicleID: Int
    /// The raw ISO created-at (web `log.created_at`) forwarded as the `t` param.
    public var createdAtISO: String

    public init(
        id: Int,
        title: String,
        message: String,
        severityRaw: String?,
        createdAt: Date,
        isRead: Bool,
        isArchived: Bool,
        vehicleName: String? = nil,
        ruleName: String? = nil,
        hasRule: Bool = false,
        ruleSignal: String? = nil,
        drillVehicleID: Int = 0,
        createdAtISO: String = ""
    ) {
        self.id = id
        self.title = title
        self.message = message
        self.severityRaw = severityRaw
        self.createdAt = createdAt
        self.isRead = isRead
        self.isArchived = isArchived
        self.vehicleName = vehicleName
        self.ruleName = ruleName
        self.hasRule = hasRule
        self.ruleSignal = ruleSignal
        self.drillVehicleID = drillVehicleID
        self.createdAtISO = createdAtISO
    }

    /// Projects to the view-facing row (folds the web `rule?.severity ?? 'info'` and
    /// the `rule ? getAlertDrillthroughHref(synthetic) : null` drill-through gate).
    public func projected() -> NotificationRowProjection {
        NotificationRowProjection(
            id: id,
            title: title,
            message: message,
            severity: NotificationRowSeverityKind.from(severityRaw),
            createdAt: createdAt,
            isRead: isRead,
            isArchived: isArchived,
            vehicleName: vehicleName,
            ruleName: ruleName,
            drillthrough: hasRule
                ? NotificationRowDrillthrough.resolve(
                    signal: ruleSignal,
                    vehicleID: drillVehicleID,
                    createdAtISO: createdAtISO
                )
                : nil
        )
    }
}

// MARK: - Action capabilities (web optional callbacks)

/// Which per-row actions the parent inbox supplies (web optional `onMarkRead` /
/// `onMarkUnread` / `onArchive` / `onUnarchive` / `onActivate` props). A button only
/// renders when its capability is enabled AND the row state matches (web e.g.
/// `!isRead && onMarkRead`). Defaults match the real inbox, which supplies them all.
public struct NotificationRowCapabilities: Sendable, Equatable {
    public var markRead: Bool
    public var markUnread: Bool
    public var archive: Bool
    public var unarchive: Bool
    public var activate: Bool

    public init(
        markRead: Bool = true,
        markUnread: Bool = true,
        archive: Bool = true,
        unarchive: Bool = true,
        activate: Bool = true
    ) {
        self.markRead = markRead
        self.markUnread = markUnread
        self.archive = archive
        self.unarchive = unarchive
        self.activate = activate
    }
}

// MARK: - Source snapshot

/// One coalesced row snapshot: the raw row + its load status + the live-state
/// connection + the current selection + the parent-supplied action capabilities +
/// the last-update timestamp.
public struct NotificationRowUpdate: Sendable, Equatable {
    public var status: NotificationRowLoadStatus
    public var row: NotificationRowInput?
    public var connection: NotificationRowConnection
    public var selected: Bool
    public var capabilities: NotificationRowCapabilities
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: NotificationRowLoadStatus = .loading,
        row: NotificationRowInput? = nil,
        connection: NotificationRowConnection = .live,
        selected: Bool = false,
        capabilities: NotificationRowCapabilities = NotificationRowCapabilities(),
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.row = row
        self.connection = connection
        self.selected = selected
        self.capabilities = capabilities
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - Per-row actions

/// A per-row mutation (web quick-action button). Drives the in-flight spinner so the
/// pressed button is disabled while its mutation runs.
public enum NotificationRowActionKind: String, Sendable, Equatable, CaseIterable, Identifiable {
    case markRead
    case markUnread
    case archive
    case unarchive

    public var id: String {
        rawValue
    }
}

/// The result of a per-row mutation (web mark-read / archive mutations). On success
/// the source pushes an updated snapshot (the read/archived flag flips); on failure
/// the surface raises an inline error toast rather than silently swallowing it.
public enum NotificationRowActionResult: Sendable, Equatable {
    case success
    case failure(message: String?)
}

// MARK: - Toast (web inline action feedback)

/// A transient toast the surface raises after a per-row action fails (so an error is
/// never silently dropped — the project error-handling contract).
public struct NotificationRowToast: Sendable, Equatable, Identifiable {
    public enum Kind: Sendable, Equatable { case success, error }

    public var id = UUID()
    public var kind: Kind
    public var message: String

    public init(kind: Kind, message: String) {
        self.kind = kind
        self.message = message
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 inbox state holders — the row's query plus the mark-read / archive
/// mutations and the selection + activation + drill-through navigation intents.
/// Previews + tests use `InMemoryNotificationRowSource`. The view never talks to the
/// network.
@MainActor
public protocol NotificationRowSource: AnyObject {
    /// Pushes a coalesced row snapshot (status + row + freshness + selection).
    var onUpdate: (@MainActor (NotificationRowUpdate) -> Void)? { get set }

    func start()
    func stop()
    /// Re-runs the underlying row query (web parent refetch / the stale auto-refresh).
    func refresh()
    /// Records the selection toggle (web `onSelectionChange(id, selected)`).
    func setSelected(_ selected: Bool)
    /// Fires the row-body activation intent (web `onActivate(log)`).
    func activate()
    /// Navigates to the drill-through context page (web `<Link to={drillHref}>`).
    func openContext(_ target: NotificationRowDrillthrough)
    /// Web `onMarkRead(log.id)` — runs the mark-read mutation.
    func markRead() async -> NotificationRowActionResult
    /// Web `onMarkUnread(log.id)` — runs the mark-unread mutation.
    func markUnread() async -> NotificationRowActionResult
    /// Web `onArchive(log.id)` — runs the archive mutation.
    func archive() async -> NotificationRowActionResult
    /// Web `onUnarchive(log.id)` — runs the restore mutation.
    func unarchive() async -> NotificationRowActionResult
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()`, records the selection / activation / drill-through intents, and serves
/// a scripted action result; tests can push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryNotificationRowSource: NotificationRowSource {
    public var onUpdate: (@MainActor (NotificationRowUpdate) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var activateCount = 0
    public private(set) var lastSelection: Bool?
    public private(set) var openedContext: NotificationRowDrillthrough?
    public private(set) var actionCounts: [NotificationRowActionKind: Int] = [:]

    private let initial: NotificationRowUpdate?
    private let actionResult: NotificationRowActionResult

    public init(
        initial: NotificationRowUpdate? = nil,
        actionResult: NotificationRowActionResult = .success
    ) {
        self.initial = initial
        self.actionResult = actionResult
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

    public func setSelected(_ selected: Bool) {
        lastSelection = selected
    }

    public func activate() {
        activateCount += 1
    }

    public func openContext(_ target: NotificationRowDrillthrough) {
        openedContext = target
    }

    public func markRead() async -> NotificationRowActionResult {
        record(.markRead)
    }

    public func markUnread() async -> NotificationRowActionResult {
        record(.markUnread)
    }

    public func archive() async -> NotificationRowActionResult {
        record(.archive)
    }

    public func unarchive() async -> NotificationRowActionResult {
        record(.unarchive)
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: NotificationRowUpdate) {
        onUpdate?(update)
    }

    private func record(_ kind: NotificationRowActionKind) -> NotificationRowActionResult {
        actionCounts[kind, default: 0] += 1
        return actionResult
    }
}
