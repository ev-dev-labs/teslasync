//
//  ActiveSessionsSection.Seams.swift
//  TeslaSync — P4 feature view · 0197 · ActiveSessionsSection (Apple)
//
//  The dependency seams the ActiveSessionsSection view-model binds through, kept apart
//  from the model for the lint length budget: the P1/S11 telemetry contract, the
//  P1/S10 i18n facade (web `useTranslation`), the date-formatting facade (web
//  `useDateFormat`), the revoke seam (web `useRevokeSession` + `useRevokeAllOther
//  Sessions`), the coalesced source snapshot, the P1/S8 source protocol, the in-memory
//  source for previews/tests, and the VoiceOver string builder.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared
/// core `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted
/// there.
public protocol ActiveSessionsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogActiveSessionsTelemetry: ActiveSessionsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views
/// hold no hardcoded literals. Keys live in the "ActiveSessionsSection" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; kept per-surface
/// so each parallel prompt owns its own strings.
public enum ActiveSessionsStrings {
    public static let table = "ActiveSessionsSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Date-formatting facade (web `useDateFormat().formatDateTime`)

/// Formats the "Signed in" / "Last seen" timestamps (web `formatTimestamp`).
/// Production injects a settings-backed implementation (locale + 12/24h from
/// `useSettings`); previews/tests use `DefaultActiveSessionsDateFormatting`.
public protocol ActiveSessionsDateFormatting: Sendable {
    func dateTime(_ date: Date) -> String
}

/// Bundle-free default: a medium date + short time, matching the web `formatDateTime`
/// default. Stateless + `Sendable`.
public struct DefaultActiveSessionsDateFormatting: ActiveSessionsDateFormatting {
    private let localeIdentifier: String

    public init(localeIdentifier: String = "en_US") {
        self.localeIdentifier = localeIdentifier
    }

    public func dateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Revoke seam (web `useRevokeSession` + `useRevokeAllOtherSessions`)

/// The two destructive mutations the section drives. Both are RequireSudo-gated
/// upstream (the production adapter pops the re-auth dialog before the DELETE fires);
/// this seam keeps all networking out of the view. The model awaits a result, then
/// refreshes the bound source on success (web invalidates the list query).
public protocol ActiveSessionsRevoker: Sendable {
    /// Signs out one session by id (web `DELETE /auth/sessions/{id}`). Returns whether
    /// the revoke succeeded (idempotent 204 ⇒ `true`).
    func revoke(id: String) async -> Bool

    /// Signs out every session other than the current device (web
    /// `DELETE /auth/sessions/all-others`). Returns the count revoked, or a negative
    /// value on failure so the model can skip the refresh.
    func revokeAllOthers() async -> Int
}

/// `os.Logger`-backed default that records the intent without networking, so previews
/// render the destructive chrome safely. Reports success so the bound source refreshes.
public struct OSLogActiveSessionsRevoker: ActiveSessionsRevoker {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "auth-sessions")
    }

    public func revoke(id: String) async -> Bool {
        logger.info("auth.sessions.revoke id=\(id, privacy: .private)")
        return true
    }

    public func revokeAllOthers() async -> Int {
        logger.info("auth.sessions.revokeAllOthers")
        return 0
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by an `ActiveSessionsSource`: the load status, the
/// auth mode, the resolved rows, the live-state freshness, and the in-flight flag.
public struct ActiveSessionsUpdate: Sendable, Equatable {
    public var status: ActiveSessionsLoadStatus
    public var mode: ActiveSessionsMode
    public var items: [ActiveSessionItem]
    public var connection: ActiveSessionsConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ActiveSessionsLoadStatus = .loading,
        mode: ActiveSessionsMode = .session,
        items: [ActiveSessionItem] = [],
        connection: ActiveSessionsConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.mode = mode
        self.items = items
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8
/// session state holder; previews/tests use `InMemoryActiveSessionsSource`. The view
/// never talks to the network directly.
@MainActor
public protocol ActiveSessionsSource: AnyObject {
    var onUpdate: (@MainActor (ActiveSessionsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web list invalidation after a revoke / the stale
    /// auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryActiveSessionsSource: ActiveSessionsSource {
    public var onUpdate: (@MainActor (ActiveSessionsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ActiveSessionsUpdate?

    public init(initial: ActiveSessionsUpdate? = nil) {
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
    public func push(_ update: ActiveSessionsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// + date formatter so the summaries are testable without a bundle.
public enum ActiveSessionsAccessibility {
    /// The section header summary: title + active-device count.
    public static func sectionSummary(count: Int, localize: (String, String) -> String) -> String {
        let title = localize("sessions.title", "Active sessions")
        return "\(title): \(count)"
    }

    /// One row's VoiceOver label: device · This device? · IP · signed-in · last-seen,
    /// each resolved through the same facades the row renders with.
    public static func rowLabel(
        _ item: ActiveSessionItem,
        dates: ActiveSessionsDateFormatting,
        localize: (String, String) -> String
    ) -> String {
        var parts: [String] = [item.deviceLabel(localize: localize)]
        if item.current {
            parts.append(localize("sessions.current", "This device"))
        }
        parts.append("\(localize("sessions.columns.ip", "IP address")): \(item.ipDisplay)")
        parts.append("\(localize("sessions.columns.createdAt", "Signed in")): \(dates.dateTime(item.createdAt))")
        parts.append("\(localize("sessions.columns.lastSeenAt", "Last seen")): \(dates.dateTime(item.lastSeenAt))")
        return parts.joined(separator: ", ")
    }
}
