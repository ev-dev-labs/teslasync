//
//  RequiresAuth.Seams.swift
//  TeslaSync — P4 shared surface · 0137 · RequiresAuth (Apple)
//
//  The dependency seams the RequiresAuth view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S11 telemetry contract, the coalesced contract snapshot, the P1/S8
//  source protocol (the `useAuthMode` poll), the in-memory source for previews/tests, the P1/S10
//  i18n facade (web `useTranslation`), and the VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol RequiresAuthTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a
/// static, non-identifying constant.
public struct OSLogRequiresAuthTelemetry: RequiresAuthTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `RequiresAuthSource`: the load status, the resolved
/// `/system/auth-mode` snapshot, the live-state freshness, and the last-updated timestamp. The view
/// never talks to the network — it consumes these.
public struct RequiresAuthUpdate: Sendable, Equatable {
    public var status: RequiresAuthLoadStatus
    public var snapshot: AuthModeSnapshot?
    public var connection: RequiresAuthConnection
    public var updatedAt: Date?

    public init(
        status: RequiresAuthLoadStatus = .loading,
        snapshot: AuthModeSnapshot? = nil,
        connection: RequiresAuthConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.snapshot = snapshot
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 auth-mode state
/// holder (the `useAuthMode` query); previews/tests use `InMemoryRequiresAuthSource`. The view never
/// reads the contract endpoint directly.
@MainActor
public protocol RequiresAuthSource: AnyObject {
    var onUpdate: (@MainActor (RequiresAuthUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying contract poll (the error-state retry / stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryRequiresAuthSource: RequiresAuthSource {
    public var onUpdate: (@MainActor (RequiresAuthUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RequiresAuthUpdate?

    public init(initial: RequiresAuthUpdate? = nil) {
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
    public func push(_ update: RequiresAuthUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "RequiresAuth" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum RequiresAuthStrings {
    public static let table = "RequiresAuth"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum RequiresAuthAccessibility {
    /// The lock notice's combined region label: the title sentence then the explanatory body, read
    /// as one phrase (web `role="status"` block).
    public static func lockNoticeSummary(
        feature: String,
        providerHint: String?,
        localize: (String, String) -> String
    ) -> String {
        let title = RequiresAuthCopy.title(feature: feature, localize: localize)
        let body = RequiresAuthCopy.body(feature: feature, providerHint: providerHint, localize: localize)
        return "\(title). \(body)"
    }

    /// The loading-chrome label (native pre-resolution state).
    public static func loadingLabel(localize: (String, String) -> String) -> String {
        localize("requiresAuth.loading", "Checking access…")
    }

    /// The error-chrome label: the failure title plus the transport message when present.
    public static func errorLabel(message: String, localize: (String, String) -> String) -> String {
        let title = localize("requiresAuth.errorTitle", "Couldn't check access")
        return message.isEmpty ? title : "\(title). \(message)"
    }
}
