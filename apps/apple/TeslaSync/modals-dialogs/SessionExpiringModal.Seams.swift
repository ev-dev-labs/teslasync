//
//  SessionExpiringModal.Seams.swift
//  TeslaSync — P4 modal / dialog · 0009 · SessionExpiringModal (Apple)
//
//  The dependency seams the SessionExpiringModal view-model binds through, kept apart from the
//  model for the lint length budget: the P1/S11 telemetry contract, the stay/sign-out command
//  seam (web `refresh()` + `navigateToReauth()`), the coalesced source snapshot, the P1/S8 source
//  protocol, the in-memory source for previews/tests, the P1/S10 i18n facade (web
//  `useTranslation`), and the VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol SessionExpiringTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a
/// static, non-identifying constant.
public struct OSLogSessionExpiringTelemetry: SessionExpiringTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Stay / sign-out command seam (web `refresh()` / `navigateToReauth()`)

/// The dialog's two affordances. `stay()` is the web "Stay signed in" — it awaits the session
/// monitor's `refresh()` (a re-poll of `/auth/session`; sliding-session proxies renew the cookie
/// on that authenticated GET, so the poll is itself the renewal). `signOut()` is the web "Sign out
/// now" — the explicit IdP handoff via `navigateToReauth()`. Keeps the auth plumbing out of the
/// view; the production app injects an adapter over the shared session controller, previews/tests
/// use the logging / spy defaults.
public protocol SessionExpiringController: Sendable {
    /// Re-polls the session (web `refresh()` → `query.refetch()`); the sliding-session renewal.
    func stay() async
    /// Hands off to the IdP login, preserving the current URL to resume afterwards (web
    /// `navigateToReauth()`).
    func signOut()
}

/// `os.Logger`-backed default that records the intents without performing auth navigation, so
/// previews render safely.
public struct OSLogSessionExpiringController: SessionExpiringController {
    private let logger: Logger
    private let surface = SessionExpiringSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "session")
    }

    public func stay() async {
        logger.info("session.stay surface=\(surface, privacy: .public)")
    }

    public func signOut() {
        logger.info("session.signOut surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `SessionExpiringSource`: the load status, the resolved
/// `/auth/session` snapshot, the unsaved-draft inventory, the live-state freshness, the in-flight
/// background-poll flag, and the last-updated timestamp.
public struct SessionExpiringUpdate: Sendable, Equatable {
    public var status: SessionExpiringLoadStatus
    public var session: SessionSnapshot?
    public var drafts: [SessionDraft]
    public var connection: SessionExpiringConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: SessionExpiringLoadStatus = .loading,
        session: SessionSnapshot? = nil,
        drafts: [SessionDraft] = [],
        connection: SessionExpiringConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.session = session
        self.drafts = drafts
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 session
/// monitor state holder (the `useSessionMonitor` poll) plus the form-draft registry; previews/tests
/// use `InMemorySessionExpiringSource`. The view never talks to the network or persistence.
@MainActor
public protocol SessionExpiringSource: AnyObject {
    var onUpdate: (@MainActor (SessionExpiringUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying poll (web refetch / the error-state retry / stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySessionExpiringSource: SessionExpiringSource {
    public var onUpdate: (@MainActor (SessionExpiringUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SessionExpiringUpdate?

    public init(initial: SessionExpiringUpdate? = nil) {
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
    public func push(_ update: SessionExpiringUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "SessionExpiringModal" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum SessionExpiringStrings {
    public static let table = "SessionExpiringModal"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience for body interpolation (`{{countdown}}` / `{{count}}`): resolves then substitutes.
    public static func string(
        _ key: String,
        _ fallback: String,
        _ token: String,
        _ value: String
    ) -> String {
        string(key, fallback).replacingOccurrences(of: token, with: value)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum SessionExpiringAccessibility {
    /// The dialog's region label (web `Modal` `ariaLabel` = the title).
    public static func summary(localize: (String, String) -> String) -> String {
        localize("session.expiring.title", "Your session is about to expire")
    }

    /// The countdown line read as one phrase, with the formatted countdown substituted (web body).
    public static func countdownLabel(countdown: String, localize: (String, String) -> String) -> String {
        localize("session.expiring.body", "You will be signed out in {{countdown}}.")
            .replacingOccurrences(of: "{{countdown}}", with: countdown)
    }

    /// The unsaved-drafts region label: the heading plus the total count so VoiceOver announces how
    /// many drafts would be stranded.
    public static func draftsLabel(count: Int, localize: (String, String) -> String) -> String {
        let heading = localize("session.expiring.unsavedTitle", "Unsaved drafts")
        return "\(heading), \(count)"
    }
}
