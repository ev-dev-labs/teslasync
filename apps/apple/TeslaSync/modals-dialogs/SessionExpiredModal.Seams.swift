//
//  SessionExpiredModal.Seams.swift
//  TeslaSync — P4 modal/dialog · 0008 · SessionExpiredModal (Apple)
//
//  The dependency seams the SessionExpiredModal view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S11 telemetry contract, the re-auth control seam (web
//  `navigateToReauth`), the coalesced source snapshot, the P1/S8 source protocol, the in-memory
//  source for previews/tests, the P1/S10 i18n facade (web `useTranslation`), and the VoiceOver
//  string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted there.
public protocol SessionExpiredTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSessionExpiredTelemetry: SessionExpiredTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Re-auth control seam (web `navigateToReauth`)

/// The surface's only command seam. `signIn` is the web `navigateToReauth()` — the explicit IdP
/// handoff that hard-blocks until the user re-authenticates. Keeps window/navigation out of the
/// view; the production app injects an adapter that opens the configured IdP entry point (e.g. via
/// `ASWebAuthenticationSession` / restarting the auth flow), previews/tests use the logging / spy
/// defaults.
public protocol SessionReauthController: Sendable {
    func signIn()
}

/// `os.Logger`-backed default that records the re-auth intent without navigating, so previews run
/// safely.
public struct OSLogSessionReauthController: SessionReauthController {
    private let logger: Logger
    private let surface = SessionExpiredSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "auth")
    }

    public func signIn() {
        logger.info("session.reauth surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `SessionExpiredSource`: the poll load status, the resolved
/// session slice (mode + expiry + the latched 401 event), the live-state freshness, and the
/// in-flight flag.
public struct SessionExpiredUpdate: Sendable, Equatable {
    public var status: SessionLoadStatus
    public var context: SessionContext?
    public var connection: SessionConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: SessionLoadStatus = .loading,
        context: SessionContext? = nil,
        connection: SessionConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.context = context
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders —
/// polling `/auth/session` for the session slice, folding in the `teslasync:session-expired` 401
/// signal, and reporting live-state freshness — plus a refresh affordance. Previews/tests use
/// `InMemorySessionExpiredSource`. The view never reads persistence or the network directly.
@MainActor
public protocol SessionExpiredSource: AnyObject {
    var onUpdate: (@MainActor (SessionExpiredUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-polls `/auth/session` (web refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySessionExpiredSource: SessionExpiredSource {
    public var onUpdate: (@MainActor (SessionExpiredUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SessionExpiredUpdate?

    public init(initial: SessionExpiredUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { push(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: SessionExpiredUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "SessionExpiredModal" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum SessionExpiredStrings {
    public static let table = "SessionExpiredModal"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum SessionExpiredAccessibility {
    /// The dialog summary for the active state (web Modal `ariaLabel` — the title).
    public static func summary(localize: (String, String) -> String) -> String {
        localize("session.expired.title", "Session expired")
    }

    /// The summary for a non-blocking phase, so VoiceOver announces what the surface is conveying
    /// (loading / open-mode / healthy / poll-failure) rather than the block title.
    public static func summary(
        for phase: SessionExpiredPhase,
        localize: (String, String) -> String
    ) -> String {
        switch phase {
        case .loading:
            localize("session.expired.loading", "Checking your session…")
        case .empty:
            localize("session.expired.openTitle", "No sign-in required")
        case .dormant:
            localize("session.expired.activeTitle", "Session active")
        case .error:
            localize("session.expired.errorTitle", "Couldn't check your session")
        case .expired:
            summary(localize: localize)
        }
    }
}
