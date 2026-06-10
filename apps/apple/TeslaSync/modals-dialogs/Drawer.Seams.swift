//
//  Drawer.Seams.swift
//  TeslaSync — P4 modal / dialog · 0013 · Drawer (Apple)
//
//  The dependency seams the Drawer view-model binds through, kept apart from the model for the lint
//  length budget: the P1/S11 telemetry contract (web — none; the native diagnostics `view.opened`),
//  the coalesced source snapshot, the P1/S8 source protocol (the hosted body's data feed), the
//  in-memory source for previews/tests, the P1/S10 i18n facade (web `useTranslation`), and the
//  VoiceOver summary builders. No view reads HTTP or persistence directly — it only ever talks to
//  these seams.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol DrawerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogDrawerTelemetry: DrawerTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `DrawerSource`: the load status, the resolved body rows, the
/// live-state freshness, the in-flight refresh flag, and the last-updated timestamp.
public struct DrawerUpdate: Sendable, Equatable {
    public var status: DrawerLoadStatus
    public var items: [DrawerContentItem]
    public var connection: DrawerConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: DrawerLoadStatus = .loading,
        items: [DrawerContentItem] = [],
        connection: DrawerConnection = .live,
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

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders
/// (the `LoadableState` / `Resource` freshness envelope, ADR-013) that feed the hosted body; previews/
/// tests use `InMemoryDrawerSource`. The view never talks to the network.
@MainActor
public protocol DrawerSource: AnyObject {
    var onUpdate: (@MainActor (DrawerUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (the error-state retry / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryDrawerSource: DrawerSource {
    public var onUpdate: (@MainActor (DrawerUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DrawerUpdate?

    public init(initial: DrawerUpdate? = nil) {
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
    public func push(_ update: DrawerUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "Drawer" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; kept per-surface so each parallel prompt owns its own strings.
public enum DrawerStrings {
    public static let table = "Drawer"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum DrawerAccessibility {
    /// A per-state VoiceOver hint for the dialog: the body phase, suffixed with the freshness when the
    /// stream is not live, so the reader announces both what is shown and how current it is.
    public static func summary(
        phase: DrawerPhase,
        connection: DrawerConnection,
        localize: (String, String) -> String
    ) -> String {
        let base = phaseSummary(phase, localize: localize)
        guard let freshness = freshnessSuffix(connection, localize: localize) else { return base }
        return "\(base), \(freshness)"
    }

    /// The close affordance's VoiceOver label (web close `aria-label="Close"`).
    public static func closeLabel(localize: (String, String) -> String) -> String {
        localize("drawer.close", "Close")
    }

    /// The VoiceOver-escape / dismiss action label.
    public static func dismissLabel(localize: (String, String) -> String) -> String {
        localize("drawer.dismiss", "Dismiss")
    }

    private static func phaseSummary(_ phase: DrawerPhase, localize: (String, String) -> String) -> String {
        switch phase {
        case .loading:
            localize("drawer.a11y.loading", "Loading content")
        case .empty:
            localize("drawer.a11y.empty", "No content")
        case .error:
            localize("drawer.a11y.error", "Failed to load content")
        case .content:
            localize("drawer.a11y.content", "Content loaded")
        }
    }

    private static func freshnessSuffix(
        _ connection: DrawerConnection,
        localize: (String, String) -> String
    ) -> String? {
        switch connection {
        case .live:
            nil
        case .stale:
            localize("drawer.stale", "Stale")
        case .offline:
            localize("drawer.offline", "Offline")
        }
    }
}
