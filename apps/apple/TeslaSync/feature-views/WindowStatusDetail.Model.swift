//
//  WindowStatusDetail.Model.swift
//  TeslaSync — P4 feature view · 0049 · WindowStatusDetail (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the Window Status Detail surface. The view binds through
//  `WindowStatusModel`; no networking lives in the view. SwiftUI parity of
//  features/admin/components/security-access/WindowStatusDetail.tsx — the admin
//  security-access leaf that shows the four cabin windows' open/venting/closed state
//  from the latest `/security/latest` snapshot. The web leaf is fed `latest` by its
//  parent, so the native source carries that snapshot plus the load + live-state
//  (ADR-013) chrome the Apple HIG states contract requires.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is
/// consent-gated and redacted there.
public protocol WindowStatusTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogWindowStatusTelemetry: WindowStatusTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's query, mirroring the shared `LoadableState`
/// cases the web parent projects from its security hook (web `isLoading` skeleton /
/// resolved snapshot / empty / failure).
public enum WindowStatusLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data
/// banner so a cached snapshot is clearly labeled while reconnecting / offline.
public enum WindowStatusConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `WindowStatusSource`: the latest window event +
/// its load status + the (shared) live-state connection + when it was captured.
public struct WindowStatusInput: Sendable, Equatable {
    public var status: WindowStatusLoadStatus
    public var event: WindowStatusEvent?
    public var connection: WindowStatusConnection
    public var updatedAt: Date?

    public init(
        status: WindowStatusLoadStatus = .loading,
        event: WindowStatusEvent? = nil,
        connection: WindowStatusConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.event = event
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 security state holder (web `useSecurityLatest`); previews + tests use
/// `InMemoryWindowStatusSource`. The view never talks to the network directly.
@MainActor
public protocol WindowStatusSource: AnyObject {
    var onUpdate: (@MainActor (WindowStatusInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `WindowStatusSource`, projects
/// the snapshot into the four view-ready cells + the closed/open summary, and exposes a
/// render `WindowStatusPhase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class WindowStatusModel {
    public private(set) var phase: WindowStatusPhase = .loading
    public private(set) var cells: [WindowCell] = []
    public private(set) var connection: WindowStatusConnection = .live
    public private(set) var allClosed = false
    public private(set) var notClosedCount = 0
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any WindowStatusSource
    @ObservationIgnored private let telemetry: any WindowStatusTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any WindowStatusSource,
        telemetry: any WindowStatusTelemetry = OSLogWindowStatusTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WindowStatusDetail.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the latest snapshot (wired to the error-state retry affordance).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: WindowStatusInput) {
        connection = input.connection
        updatedAt = input.updatedAt
        let resolvedCells = WindowStatusProjection.cells(from: input.event)
        cells = resolvedCells
        allClosed = WindowStatusProjection.allClosed(resolvedCells)
        notClosedCount = WindowStatusProjection.notClosedCount(resolvedCells)
        phase = WindowStatusProjection.resolvePhase(input.status, hasEvent: input.event != nil)
        handleAutoRefresh(for: input.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline never auto-refreshes.
    private func handleAutoRefresh(for connection: WindowStatusConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryWindowStatusSource: WindowStatusSource {
    public var onUpdate: (@MainActor (WindowStatusInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: WindowStatusInput?

    public init(initial: WindowStatusInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: WindowStatusInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "WindowStatusDetail" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum WindowStatusStrings {
    public static let table = "WindowStatusDetail"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
