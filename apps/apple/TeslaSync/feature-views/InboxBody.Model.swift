//
//  InboxBody.Model.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  The seams the inbox view binds through — the P1/S8 state-holder source (web
//  `useNotificationLogs` + `useNotificationGroups`), the P1/S11 telemetry
//  contract (`view.opened`), the toast + screen-reader-announcer presenters (web
//  `useToast` / `useAnnouncer`), the mark-on-open/click preference seam (web
//  `localStorage`), the mutation seam (web `useMark*`/`useArchive*`/`useDelete`
//  hooks), and the P1/S10 i18n facade. The view never issues HTTP; the
//  `@Observable` store in `InboxBody.Store.swift` resolves the render phase.
//

import Foundation
import Observation
import OSLog

// MARK: - Diagnostics identity (P1/S11)

/// The surface slug emitted with `view.opened`. Kept off the SwiftUI view so the
/// store + tests reference it without importing SwiftUI.
public enum InboxDiagnostics {
    public static let surface = "InboxBody"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event. The default logs via
/// `os.Logger`; production injects an adapter forwarding to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, consent-gated + redacted there.
public protocol InboxTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogInboxTelemetry: InboxTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Toast + announcer seams (web `useToast` / `useAnnouncer`)

/// The transient-toast presenter the inbox posts bulk-action results to (web
/// `useToast`). The success-with-undo variant backs the web "Undo" affordance.
@MainActor
public protocol InboxToastPresenting: AnyObject {
    func success(title: String)
    func success(title: String, undoLabel: String, onUndo: @escaping @MainActor () -> Void)
    func error(title: String, message: String?)
}

/// The screen-reader live-region announcer (web `useAnnouncer`). Bulk archive /
/// restore post a polite announcement here.
@MainActor
public protocol InboxAnnouncing: AnyObject {
    func announce(_ message: String)
}

/// `os.Logger`-backed default presenter — production injects the shared toast hub
/// + the `UIAccessibility`/`AccessibilityNotification` announcer.
@MainActor
public final class OSLogInboxPresenter: InboxToastPresenting, InboxAnnouncing {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "inbox")
    }

    public func success(title: String) {
        logger.info("toast.success \(title, privacy: .public)")
    }

    public func success(title: String, undoLabel _: String, onUndo _: @escaping @MainActor () -> Void) {
        logger.info("toast.success+undo \(title, privacy: .public)")
    }

    public func error(title: String, message: String?) {
        logger.error("toast.error \(title, privacy: .public) \(message ?? "", privacy: .public)")
    }

    public func announce(_ message: String) {
        logger.info("announce \(message, privacy: .public)")
    }
}

// MARK: - Preference seam (web `localStorage` mark-on-open / mark-on-click)

/// The auto-mark preferences (web `PREF_MARK_ON_OPEN` / `PREF_MARK_ON_CLICK`).
/// Both default to `true` (web `readPref` returns true unless the stored value is
/// exactly `'false'`).
public protocol InboxPreferences: Sendable {
    var markOnOpen: Bool { get }
    var markOnClick: Bool { get }
}

/// `UserDefaults`-backed default mirroring the web localStorage keys + the
/// "true unless stored 'false'" rule.
public struct DefaultInboxPreferences: InboxPreferences, Sendable {
    public let markOnOpen: Bool
    public let markOnClick: Bool

    public init(defaults: UserDefaults = .standard) {
        markOnOpen = Self.read("teslasync.notifications.markOnOpen", defaults)
        markOnClick = Self.read("teslasync.notifications.markOnClick", defaults)
    }

    private static func read(_ key: String, _ defaults: UserDefaults) -> Bool {
        guard let value = defaults.string(forKey: key) else { return true }
        return value != "false"
    }
}

/// A fixed-value preference set for previews / tests.
public struct StaticInboxPreferences: InboxPreferences, Sendable {
    public let markOnOpen: Bool
    public let markOnClick: Bool

    public init(markOnOpen: Bool = true, markOnClick: Bool = true) {
        self.markOnOpen = markOnOpen
        self.markOnClick = markOnClick
    }
}

// MARK: - Mutation seam (web mark/archive/delete hooks)

/// A bulk-mark-read request (web `bulkMarkReadMut.mutateAsync` payloads): an
/// explicit id list, the fleet-wide `all`, or a `groupKey` thread.
public struct InboxBulkMarkReadRequest: Equatable, Sendable {
    public var ids: [Int]?
    public var all: Bool
    public var groupKey: String?

    public init(ids: [Int]? = nil, all: Bool = false, groupKey: String? = nil) {
        self.ids = ids
        self.all = all
        self.groupKey = groupKey
    }
}

/// The mutation seam the store calls — production wires it to the shared
/// notification mutation holders; previews/tests use a recording double. The
/// fire-and-forget single mutations mirror the web `.mutate([id])`; the awaited
/// ones back the bulk flows that announce / toast a result count.
@MainActor
public protocol InboxActionsPerforming: AnyObject {
    func markRead(_ ids: [Int])
    func markUnread(_ ids: [Int])
    func archive(_ ids: [Int]) async
    func unarchive(_ ids: [Int]) async
    func delete(_ ids: [Int]) async
    func bulkMarkRead(_ request: InboxBulkMarkReadRequest) async throws -> Int
}

// MARK: - Source seam (P1/S8) — web `useNotificationLogs` + `useNotificationGroups`

/// The load lifecycle for one query (web TanStack `isLoading` / `data` / `error`
/// projected into the cache-then-network states).
public enum InboxLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013): `live`, `stale` (older than the freshness
/// window — stale chip + auto-refresh), `offline` (cached values shown).
public enum InboxConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `InboxSource` — both the flat-list and the
/// grouped-thread results with their independent load status (the web runs the
/// two queries with `enabled` gating on `isGrouped`), plus freshness + timestamp.
public struct InboxUpdate: Sendable, Equatable {
    public var flatStatus: InboxLoadStatus
    public var groupStatus: InboxLoadStatus
    public var rows: [InboxNotification]
    public var groups: [InboxGroup]
    public var rules: [InboxRule]
    public var vehicles: [InboxVehicle]
    public var connection: InboxConnection
    public var updatedAt: Date?

    public init(
        flatStatus: InboxLoadStatus = .loading,
        groupStatus: InboxLoadStatus = .loading,
        rows: [InboxNotification] = [],
        groups: [InboxGroup] = [],
        rules: [InboxRule] = [],
        vehicles: [InboxVehicle] = [],
        connection: InboxConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.flatStatus = flatStatus
        self.groupStatus = groupStatus
        self.rows = rows
        self.groups = groups
        self.rules = rules
        self.vehicles = vehicles
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements it over the shared
/// notification-log + group state holders, re-issuing the active query on
/// `setFilters`; previews/tests use `InMemoryInboxSource`.
@MainActor
public protocol InboxSource: AnyObject {
    var onUpdate: (@MainActor (InboxUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func setFilters(_ filters: InboxFilters)
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryInboxSource: InboxSource {
    public var onUpdate: (@MainActor (InboxUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var lastFilters: InboxFilters?

    private let initial: InboxUpdate?

    public init(initial: InboxUpdate? = nil) {
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

    public func setFilters(_ filters: InboxFilters) {
        lastFilters = filters
    }

    /// Pushes a snapshot to the bound store (test/preview affordance).
    public func push(_ update: InboxUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback so the
/// view holds no literals. Keys live in the "InboxBody" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time.
public enum InboxStrings {
    public static let table = "InboxBody"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `{{count}}`-templated string (web i18next interpolation) by
    /// substituting the count into the localized template.
    public static func count(_ key: String, _ fallback: String, count: Int) -> String {
        string(key, fallback).replacingOccurrences(of: "{{count}}", with: String(count))
    }
}
