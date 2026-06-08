//
//  NotificationGroupRow.Source.swift
//  TeslaSync — P4 feature view · 0190 · NotificationGroupRow (Apple)
//
//  The P1/S8 state-holder seam for the notification-thread surface: the raw snapshot
//  inputs (web `NotificationLogGroup` / `NotificationLog`), the coalesced update
//  envelopes, the toast + mark-read result, the `NotificationGroupRowSource` protocol
//  the view-model binds through, and the in-memory implementation previews + tests
//  drive. The production app implements the protocol over the shared state holders
//  (`useNotificationGroups` / `useGroupMembers` / `useBulkMarkRead`); the view never
//  talks to the network.
//

import Foundation

// MARK: - Source inputs (raw → projected)

/// One coalesced raw notification row pushed by the source (the resolved per-row
/// display data the web parent computes through `ruleMap` / `vehicleMap`). Kept
/// raw (string severity) so the adapter's `?? 'info'` defaulting stays tested.
public struct NotificationLogInput: Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
    public var message: String
    public var severityRaw: String?
    public var createdAt: Date
    public var isRead: Bool
    public var isArchived: Bool
    public var vehicleName: String?
    public var ruleName: String?

    public init(
        id: Int,
        title: String,
        message: String,
        severityRaw: String?,
        createdAt: Date,
        isRead: Bool,
        isArchived: Bool,
        vehicleName: String? = nil,
        ruleName: String? = nil
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
    }

    /// Projects to the view-facing row (folds the web `rule?.severity ?? 'info'`).
    public func projected() -> NotificationLogProjection {
        NotificationLogProjection(
            id: id,
            title: title,
            message: message,
            severity: NotificationSeverityKind.from(severityRaw),
            createdAt: createdAt,
            isRead: isRead,
            isArchived: isArchived,
            vehicleName: vehicleName,
            ruleName: ruleName
        )
    }
}

/// One coalesced raw thread pushed by the source (web `NotificationLogGroup`).
public struct NotificationGroupInput: Sendable, Equatable {
    public var groupKey: String?
    public var latest: NotificationLogInput
    public var count: Int
    public var unreadCount: Int
    public var vehicleAffectedCount: Int

    public init(
        groupKey: String?,
        latest: NotificationLogInput,
        count: Int,
        unreadCount: Int,
        vehicleAffectedCount: Int
    ) {
        self.groupKey = groupKey
        self.latest = latest
        self.count = count
        self.unreadCount = unreadCount
        self.vehicleAffectedCount = vehicleAffectedCount
    }

    /// Projects to the view-facing thread, folding in the parent inbox's archived mode.
    public func projected(archived: Bool) -> NotificationGroupProjection {
        NotificationGroupProjection(
            groupKey: groupKey,
            latest: latest.projected(),
            count: count,
            unreadCount: unreadCount,
            vehicleAffectedCount: vehicleAffectedCount,
            archived: archived
        )
    }
}

// MARK: - Source snapshots

/// One coalesced thread snapshot: the raw group + its load status + the live-state
/// connection + the parent inbox's archived mode + the last-update timestamp.
public struct NotificationGroupUpdate: Sendable, Equatable {
    public var status: NotificationLoadStatus
    public var group: NotificationGroupInput?
    public var connection: NotificationConnection
    public var archived: Bool
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: NotificationLoadStatus = .loading,
        group: NotificationGroupInput? = nil,
        connection: NotificationConnection = .live,
        archived: Bool = false,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.group = group
        self.connection = connection
        self.archived = archived
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// One coalesced member-list snapshot for the expanded region (web `useGroupMembers`).
public struct NotificationMembersUpdate: Sendable, Equatable {
    public var status: NotificationLoadStatus
    public var members: [NotificationLogInput]

    public init(status: NotificationLoadStatus = .loading, members: [NotificationLogInput] = []) {
        self.status = status
        self.members = members
    }
}

// MARK: - Toast (web `useToast`)

/// A transient toast the surface raises after a group-scoped action (web `toast`).
public struct NotificationGroupToast: Sendable, Equatable, Identifiable {
    public enum Kind: Sendable, Equatable { case success, error }

    public var id = UUID()
    public var kind: Kind
    public var message: String

    public init(kind: Kind, message: String) {
        self.kind = kind
        self.message = message
    }
}

/// The result of the group-scoped "mark read" mutation (web `useBulkMarkRead`).
public enum NotificationGroupMarkReadResult: Sendable, Equatable {
    /// The backend updated `count` thread members (web `res.updated`).
    case success(updated: Int)
    /// The mutation failed; `message` is the optional detail (web error toast detail).
    case failure(message: String?)
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the parent inbox's group query
/// (`useNotificationGroups`), the lazy member query (`useGroupMembers`), and the
/// group mark-read mutation (`useBulkMarkRead`). Previews + tests use
/// `InMemoryNotificationGroupRowSource`. The view never talks to the network.
@MainActor
public protocol NotificationGroupRowSource: AnyObject {
    /// Pushes a coalesced thread snapshot (status + group + freshness).
    var onUpdate: (@MainActor (NotificationGroupUpdate) -> Void)? { get set }
    /// Pushes a coalesced member-list snapshot for the expanded region.
    var onMembersUpdate: (@MainActor (NotificationMembersUpdate) -> Void)? { get set }

    func start()
    func stop()
    /// Re-runs the underlying group query (web parent refetch / the stale auto-refresh).
    func refresh()
    /// Lazily loads the thread members (web `useGroupMembers` enabled on expand).
    func loadMembers()
    /// Runs the group-scoped mark-read mutation (web `bulkMarkRead.mutateAsync`).
    func markGroupRead() async -> NotificationGroupMarkReadResult
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial thread
/// snapshot on `start()`, serves a scripted member list on `loadMembers()`, and a
/// scripted mark-read result; tests can push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryNotificationGroupRowSource: NotificationGroupRowSource {
    public var onUpdate: (@MainActor (NotificationGroupUpdate) -> Void)?
    public var onMembersUpdate: (@MainActor (NotificationMembersUpdate) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var loadMembersCount = 0
    public private(set) var markReadCount = 0

    private let initial: NotificationGroupUpdate?
    private let membersResult: NotificationMembersUpdate?
    private let markReadResult: NotificationGroupMarkReadResult

    public init(
        initial: NotificationGroupUpdate? = nil,
        membersResult: NotificationMembersUpdate? = nil,
        markReadResult: NotificationGroupMarkReadResult = .success(updated: 0)
    ) {
        self.initial = initial
        self.membersResult = membersResult
        self.markReadResult = markReadResult
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

    public func loadMembers() {
        loadMembersCount += 1
        if let membersResult { onMembersUpdate?(membersResult) }
    }

    public func markGroupRead() async -> NotificationGroupMarkReadResult {
        markReadCount += 1
        return markReadResult
    }

    /// Pushes a thread snapshot to the bound model (test / preview affordance).
    public func push(_ update: NotificationGroupUpdate) {
        onUpdate?(update)
    }

    /// Pushes a member snapshot to the bound model (test / preview affordance).
    public func pushMembers(_ update: NotificationMembersUpdate) {
        onMembersUpdate?(update)
    }
}

// MARK: - Surface identity

public extension NotificationGroupRow {
    /// Diagnostics surface slug (P1/S11 `view.opened`). `nonisolated` so it is
    /// reachable off the main actor (SwiftUI `View` is `@MainActor` by default).
    nonisolated static var surfaceSlug: String {
        NotificationGroupRowSurface.slug
    }
}
