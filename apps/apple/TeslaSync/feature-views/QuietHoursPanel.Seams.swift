//
//  QuietHoursPanel.Seams.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  The dependency seams the QuietHoursPanel view-model binds through, kept apart from
//  the model for the lint length budget: the P1/S11 telemetry contract, the P1/S10 i18n
//  facade (web `useTranslation`), the toast type (web `useToast`), the read source
//  snapshot + P1/S8 source protocol (web `useQuietHours`), the write seam (web
//  `useSaveQuietHours` + `useDeleteQuietHours`) with its payload + result, and the in-
//  memory source/writer used by previews + tests. No networking lives in the view.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted there.
public protocol QuietHoursTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogQuietHoursTelemetry: QuietHoursTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views
/// hold no hardcoded literals. Keys live in the "QuietHoursPanel" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time; kept per-surface so each
/// parallel prompt owns its own strings. The web keys (`quietHours.*` / `toast.quiet
/// Hours.*`) are preserved verbatim.
public enum QuietHoursStrings {
    public static let table = "QuietHoursPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Toast (web `useToast`)

/// The two toast tones the web surface raises (`toast.success` after a save/delete,
/// `toast.error` on a failed mutation).
public enum QuietHoursToastKind: Sendable, Equatable {
    case success
    case error
}

/// A transient toast raised after a save/delete — the native projection of the web
/// `useToast` calls. Holds pre-resolved copy (already run through the i18n facade) so
/// the renderer prints it verbatim.
public struct QuietHoursToast: Sendable, Equatable, Identifiable {
    public let id = UUID()
    public let kind: QuietHoursToastKind
    public let title: String
    public let message: String

    public init(kind: QuietHoursToastKind, title: String, message: String = "") {
        self.kind = kind
        self.title = title
        self.message = message
    }
}

// MARK: - Read source snapshot + P1/S8 source protocol (web `useQuietHours`)

/// One coalesced snapshot pushed by a `QuietHoursSource`: the load status, the resolved
/// rows, the live-state freshness, the in-flight flag, and the last-updated time.
public struct QuietHoursUpdate: Sendable, Equatable {
    public var status: QuietHoursLoadStatus
    public var items: [QuietHoursWindowItem]
    public var connection: QuietHoursConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: QuietHoursLoadStatus = .loading,
        items: [QuietHoursWindowItem] = [],
        connection: QuietHoursConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.items = items
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The read seam the view binds through. Production implements this over the shared
/// P1/S8 notifications state holder (the `useQuietHours` query); previews/tests use
/// `InMemoryQuietHoursSource`. The view never talks to the network directly.
@MainActor
public protocol QuietHoursSource: AnyObject {
    var onUpdate: (@MainActor (QuietHoursUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web list invalidation after a save/delete + the
    /// stale auto-refresh).
    func refresh()
}

// MARK: - Write seam (web `useSaveQuietHours` + `useDeleteQuietHours`)

/// The create/update payload — the native mirror of the web `QuietHoursSavePayload`
/// (`QuietHoursWindowInput & { id? }`). A non-nil `id` routes to PATCH; nil routes to
/// POST (web `isUpdate = typeof id === 'number' && id > 0`).
public struct QuietHoursSavePayload: Sendable, Equatable {
    public let id: Int?
    public let enabled: Bool
    public let startLocal: String
    public let endLocal: String
    public let timezone: String
    public let weekdays: Int
    public let bypassSeverities: [String]

    public init(
        id: Int?,
        enabled: Bool,
        startLocal: String,
        endLocal: String,
        timezone: String,
        weekdays: Int,
        bypassSeverities: [String]
    ) {
        self.id = id
        self.enabled = enabled
        self.startLocal = startLocal
        self.endLocal = endLocal
        self.timezone = timezone
        self.weekdays = weekdays
        self.bypassSeverities = bypassSeverities
    }

    /// Whether this payload updates an existing row (web `id > 0`).
    public var isUpdate: Bool {
        (id ?? 0) > 0
    }

    /// Builds a save payload from the live draft (web `submit` body assembly).
    public static func from(draft: QuietHoursDraft) -> QuietHoursSavePayload {
        QuietHoursSavePayload(
            id: draft.id,
            enabled: draft.enabled,
            startLocal: draft.startLocal,
            endLocal: draft.endLocal,
            timezone: draft.timezone,
            weekdays: draft.weekdays,
            bypassSeverities: draft.bypassSeverities
        )
    }
}

/// The outcome of a save/delete mutation — success, or a failure carrying the backend's
/// human-readable message (web `onError(err) → toast.error(…, err.message)`).
public enum QuietHoursWriteResult: Sendable, Equatable {
    case success
    case failure(String)
}

/// The two mutations the surface drives. Both are kept off the view so all networking
/// lives behind the seam; the model awaits a result, raises the matching toast, and
/// refreshes the bound source on success (web invalidates the list query).
public protocol QuietHoursWriter: Sendable {
    /// Creates or updates a window (web `useSaveQuietHours` → POST/PATCH).
    func save(_ payload: QuietHoursSavePayload) async -> QuietHoursWriteResult

    /// Deletes a window by id (web `useDeleteQuietHours` → DELETE).
    func delete(id: Int) async -> QuietHoursWriteResult
}

/// `os.Logger`-backed default that records the intent without networking, so previews
/// render the write chrome safely. Reports success so the bound source refreshes.
public struct OSLogQuietHoursWriter: QuietHoursWriter {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "quiet-hours")
    }

    public func save(_ payload: QuietHoursSavePayload) async -> QuietHoursWriteResult {
        logger.info("quietHours.save isUpdate=\(payload.isUpdate, privacy: .public)")
        return .success
    }

    public func delete(id: Int) async -> QuietHoursWriteResult {
        logger.info("quietHours.delete id=\(id, privacy: .public)")
        return .success
    }
}

// MARK: - In-memory source (previews + tests; the view never performs I/O)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryQuietHoursSource: QuietHoursSource {
    public var onUpdate: (@MainActor (QuietHoursUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: QuietHoursUpdate?

    public init(initial: QuietHoursUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: QuietHoursUpdate) {
        onUpdate?(update)
    }
}
