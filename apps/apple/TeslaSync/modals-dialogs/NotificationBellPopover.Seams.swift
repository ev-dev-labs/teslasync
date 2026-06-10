//
//  NotificationBellPopover.Seams.swift
//  TeslaSync — P4 modal / dialog · 0010 · NotificationBellPopover (Apple)
//
//  The dependency seams the NotificationBellPopover view-model binds through, kept apart from the
//  model for the lint length budget: the P1/S11 telemetry contract, the P1/S10 i18n facade (web
//  `useTranslation`), the relative/absolute date facade (web `formatRelative`), the action seam
//  (web `useBulkMarkRead({ all: true })` + the `/notifications/inbox` navigation), the coalesced
//  source snapshot, the P1/S8 source protocol (badge count always live + the on-open list mount),
//  the in-memory source for previews/tests, and the VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol NotificationBellTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a
/// static, non-identifying constant.
public struct OSLogNotificationBellTelemetry: NotificationBellTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Action seam (web `useBulkMarkRead` + navigation)

/// The two commands the popover drives — marking every unread notification read (web
/// `useBulkMarkRead({ all: true })`) and the escape-hatch navigation to the full inbox (web
/// `navigate('/notifications/inbox')`, fired by a row tap, "View all", and the mobile trigger
/// fallback). The default logs the intent without networking / routing so previews render safely;
/// the production app injects an adapter over the real mutation + router.
public protocol NotificationBellActions: Sendable {
    func markAllRead()
    func openInbox()
}

/// `os.Logger`-backed default that records the intents without networking or routing.
public struct OSLogNotificationBellActions: NotificationBellActions {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "notifications")
    }

    public func markAllRead() {
        logger.info("notifications.markAllRead surface=\(NotificationBellSurface.slug, privacy: .public)")
    }

    public func openInbox() {
        logger.info("notifications.openInbox surface=\(NotificationBellSurface.slug, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "NotificationBellPopover" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum NotificationBellStrings {
    public static let table = "NotificationBellPopover"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience for body interpolation (`{{count}}` etc.): resolves then substitutes one token.
    public static func string(
        _ key: String,
        _ fallback: String,
        _ token: String,
        _ value: String
    ) -> String {
        string(key, fallback).replacingOccurrences(of: token, with: value)
    }
}

// MARK: - Date facade (web `formatRelative` + absolute fallback)

/// Resolves a structured `NotificationBellRelative` into display copy. Production injects a
/// settings-backed implementation (locale + 12/24h from `useSettings`); previews/tests use
/// `DefaultNotificationBellDateFormatting`.
public protocol NotificationBellDateFormatting: Sendable {
    func relative(_ value: NotificationBellRelative) -> String
}

/// Bundle-resolving default: the relative buckets resolve through the P1/S10 facade (so the copy is
/// translatable) and the absolute fallback uses a medium date, matching the web `formatRelative`
/// tail. Stateless + `Sendable`.
public struct DefaultNotificationBellDateFormatting: NotificationBellDateFormatting {
    private let localeIdentifier: String

    public init(localeIdentifier: String = "en_US") {
        self.localeIdentifier = localeIdentifier
    }

    public func relative(_ value: NotificationBellRelative) -> String {
        switch value {
        case .empty:
            "—"
        case .justNow:
            NotificationBellStrings.string("notifications.bellPopover.relative.justNow", "just now")
        case let .minutes(count):
            NotificationBellStrings.string(
                "notifications.bellPopover.relative.minutes", "{{count}}m ago", "{{count}}", String(count)
            )
        case let .hours(count):
            NotificationBellStrings.string(
                "notifications.bellPopover.relative.hours", "{{count}}h ago", "{{count}}", String(count)
            )
        case let .days(count):
            NotificationBellStrings.string(
                "notifications.bellPopover.relative.days", "{{count}}d ago", "{{count}}", String(count)
            )
        case let .absolute(date):
            absolute(date)
        }
    }

    private func absolute(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `NotificationBellSource`: the unread badge count (web
/// `useUnreadCount`, always live), the list load status + the joined preview rows (web
/// `useUnreadNotifications`, mounted on open), the live-state freshness, the in-flight refresh flag,
/// and the last-updated timestamp.
public struct NotificationBellUpdate: Sendable, Equatable {
    public var status: NotificationBellLoadStatus
    public var count: Int
    public var entries: [NotificationBellEntry]
    public var connection: NotificationBellConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: NotificationBellLoadStatus = .loading,
        count: Int = 0,
        entries: [NotificationBellEntry] = [],
        connection: NotificationBellConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.count = count
        self.entries = entries
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 notification
/// state holders — the always-live unread count plus the on-open unread-list query (mounted /
/// unmounted via `setOpen`, mirroring the web hook only mounting while the popover is open) — and
/// performs the join (logs × rules × vehicles) before pushing. Previews/tests use
/// `InMemoryNotificationBellSource`. The view never talks to the network.
@MainActor
public protocol NotificationBellSource: AnyObject {
    var onUpdate: (@MainActor (NotificationBellUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Mounts (true) / unmounts (false) the unread-list query, mirroring the web hook that is only
    /// mounted while the popover is open. The badge count stream is unaffected.
    func setOpen(_ open: Bool)
    /// Re-runs the unread-list query (web refetch on re-open / the error-state retry / stale
    /// refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryNotificationBellSource: NotificationBellSource {
    public var onUpdate: (@MainActor (NotificationBellUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var openStates: [Bool] = []

    private let initial: NotificationBellUpdate?

    public init(initial: NotificationBellUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func setOpen(_ open: Bool) {
        openStates.append(open)
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: NotificationBellUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum NotificationBellAccessibility {
    /// The bell trigger's label (web `aria-label`): "{{count}} unread notifications" when unread,
    /// else "Notifications".
    public static func triggerLabel(count: Int, localize: (String, String) -> String) -> String {
        guard count > 0 else {
            return localize("nav.notifications", "Notifications")
        }
        return localize("nav.notificationsUnread", "{{count}} unread notifications")
            .replacingOccurrences(of: "{{count}}", with: String(count))
    }

    /// One row's VoiceOver label: the severity word, the title, the relative time, and any vehicle.
    public static func rowLabel(
        severity: String,
        title: String,
        relative: String,
        vehicle: String?
    ) -> String {
        var parts = [severity, title, relative]
        if let vehicle, !vehicle.isEmpty {
            parts.append(vehicle)
        }
        return parts.joined(separator: ", ")
    }
}
