//
//  Layout.Seams.swift
//  TeslaSync — P4 shared surface · 0169 · Layout (Apple)
//
//  The dependency seams the ``LayoutModel`` binds through, kept apart from the model for the SwiftLint
//  file-length budget: the P1/S11 telemetry seam (the `view.opened` sink), the P4 render phase, the snapshot
//  the host pushes (the web shell's live inputs — the current route, the sidebar style, the fleet/alert/stale
//  counts the sidebar badges read, the persisted pinned/recent/expanded sets, the auth mode, plus the
//  in-flight / error / connectivity axis), the P1/S8 read source seam, the production source, and the
//  in-memory source for previews + tests. The view never reads the source directly — it goes through the
//  model, which goes through these seams. No networking lives here.
//
//  Binding note: in production the source is implemented over the shared app-shell state holders — the
//  `useSidebarStyle` preference, the `useQuery(['vehicles-sidebar' | 'alerts-sidebar' | 'stale-sessions'])`
//  feeds, the `useIsForwardAuth` flag, and the localStorage-backed pin/recent/expanded stores. Route changes
//  arrive from the navigation stack; selecting an item routes back out through the model's page-supplied
//  `onSelect` closure (the native peer of the web `<NavLink to>` navigation).
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`; the
/// production app injects an adapter forwarding to the consent-gated shared-core diagnostics sink.
public protocol LayoutTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogLayoutTelemetry: LayoutTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Phase (P4 leaf contract)

/// The render phase. The web shell renders the populated chrome unconditionally; the rest are the P4
/// always-render leaf states so the surface never collapses to a blank box.
public enum LayoutPhase: Sendable, Equatable {
    /// The shell inputs are resolving (web sidebar `useQuery` feeds pending) — skeleton chrome.
    case loading
    /// The shell resolved with at least one visible section — the navigation body.
    case content
    /// Every section filtered away (e.g. an empty catalog) — friendly empty nav state.
    case empty
    /// A shell input read failed — a retry affordance (web has no peer; added so the surface never blanks).
    case error(String)
}

// MARK: - Snapshot (the web shell's live inputs)

/// The host's current shell state pushed through the source — the web `Layout` live inputs: the current
/// route, the chosen sidebar style, the sidebar badge counts (fleet / unread alerts / stale sessions), the
/// auth mode, the persisted pinned/recent paths + expanded-section set, and the in-flight / error /
/// connectivity axis.
public struct LayoutSnapshot: Sendable, Equatable {
    /// The current route (web `location.pathname`).
    public let pathname: String
    /// The chosen sidebar layout (web `useSidebarStyle()`).
    public let sidebarStyle: LayoutSidebarStyle
    /// The fleet size (web `vehicles.length`) — gates `minVehicles` items + the `/vehicles` badge.
    public let vehicleCount: Int
    /// The unread-alert count (web `unreadAlerts`) — the `/notifications/alerts` badge.
    public let unreadAlerts: Int
    /// The stale-session count (web `staleCount`) — the `/data-repair` badge.
    public let staleCount: Int
    /// Whether the deployment is behind ForwardAuth (web `useIsForwardAuth()`) — gates `requiresAuth` items.
    public let isForwardAuth: Bool
    /// The persisted pinned routes (web `pinnedNavPaths`).
    public let pinnedPaths: [String]
    /// The persisted recent routes (web `recentNavPaths`).
    public let recentPaths: [String]
    /// The persisted expanded-section titles (web `expandedSections`).
    public let expandedSections: Set<String>
    /// Whether the shell feeds are still loading (web sidebar `useQuery` pending).
    public let isLoading: Bool
    /// The shell-feed failure reason, if any — surfaced verbatim by the error state.
    public let errorMessage: String?
    /// The live-state freshness axis.
    public let connection: LayoutConnection

    public init(
        pathname: String = "/",
        sidebarStyle: LayoutSidebarStyle = .linear,
        vehicleCount: Int = 0,
        unreadAlerts: Int = 0,
        staleCount: Int = 0,
        isForwardAuth: Bool = false,
        pinnedPaths: [String] = LayoutNavLimits.defaultPinnedPaths,
        recentPaths: [String] = [],
        expandedSections: Set<String> = ["Home"],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: LayoutConnection = .live
    ) {
        self.pathname = pathname
        self.sidebarStyle = sidebarStyle
        self.vehicleCount = vehicleCount
        self.unreadAlerts = unreadAlerts
        self.staleCount = staleCount
        self.isForwardAuth = isForwardAuth
        self.pinnedPaths = pinnedPaths
        self.recentPaths = recentPaths
        self.expandedSections = expandedSections
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Read source seam (P1/S8) — the host's current shell state

/// The read seam the model binds through. The production app re-emits the host's current app-shell state
/// (`LiveLayoutSource`); previews and tests use `InMemoryLayoutSource`. The view never reads it directly.
@MainActor
public protocol LayoutSource: AnyObject {
    var onUpdate: (@MainActor (LayoutSnapshot) -> Void)? { get set }
    func start()
    func stop()
    /// Re-reads the shell feeds (web refetch) — the error-state retry + the stale auto-refresh.
    func refresh()
}

/// The production read source — holds the host's current snapshot and re-emits it whenever the host updates
/// it (a route change, a fresh badge count, a preference flip, or a connectivity transition). The production
/// app builds this over the shared shell state holders described in the file header.
@MainActor
public final class LiveLayoutSource: LayoutSource {
    public var onUpdate: (@MainActor (LayoutSnapshot) -> Void)?
    private var snapshot: LayoutSnapshot

    public init(snapshot: LayoutSnapshot) {
        self.snapshot = snapshot
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Push a fresh snapshot (the host's new route / counts / preference / connectivity) and re-emit it.
    public func update(_ snapshot: LayoutSnapshot) {
        self.snapshot = snapshot
        emit()
    }

    private func emit() {
        onUpdate?(snapshot)
    }
}

/// A fully-working in-memory source for previews + tests. Emits a fixed snapshot on `start()`, records
/// refreshes, and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryLayoutSource: LayoutSource {
    public var onUpdate: (@MainActor (LayoutSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    private let snapshot: LayoutSnapshot

    public init(snapshot: LayoutSnapshot) {
        self.snapshot = snapshot
    }

    public func start() {
        startCount += 1
        onUpdate?(snapshot)
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
        onUpdate?(snapshot)
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: LayoutSnapshot) {
        onUpdate?(update)
    }
}
