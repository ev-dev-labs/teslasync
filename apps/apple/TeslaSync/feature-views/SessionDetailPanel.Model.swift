//
//  SessionDetailPanel.Model.swift
//  TeslaSync — P4 feature view · 0091 · SessionDetailPanel (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10)
//  for the Session Details surface. The view binds through `SessionDetailModel`; no
//  networking lives in the view. SwiftUI parity of
//  features/charging/components/charging-curve/SessionDetailPanel.tsx — the charging-curve
//  leaf that shows a single selected charging session's metadata. The web leaf is fed its
//  `session` by the page, so the native source carries that snapshot (plus the formatting
//  context the web `useFormatting`/`useTranslation` hooks supply) together with the load +
//  live-state (ADR-013) chrome the Apple HIG states contract requires.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that forwards
/// to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and
/// redacted there.
public protocol SessionDetailTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogSessionDetailTelemetry: SessionDetailTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's query, mirroring the shared `LoadableState` cases
/// the web page projects from its charging hook (web `isLoading` skeleton / resolved session
/// / empty / failure).
public enum SessionDetailLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner
/// so a cached session is clearly labeled while reconnecting / offline.
public enum SessionDetailConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SessionDetailSource`: the selected session + its load
/// status + the user formatting context + the (shared) live-state connection + when it was
/// captured.
public struct SessionDetailInput: Sendable, Equatable {
    public var status: SessionDetailLoadStatus
    public var session: ChargingSessionSnapshot?
    public var formatting: SessionFormatting
    public var connection: SessionDetailConnection
    public var updatedAt: Date?

    public init(
        status: SessionDetailLoadStatus = .loading,
        session: ChargingSessionSnapshot? = nil,
        formatting: SessionFormatting = SessionFormatting(),
        connection: SessionDetailConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.session = session
        self.formatting = formatting
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// charging state holder + the units/settings holders (web `useCharging` + `useFormatting`);
/// previews + tests use `InMemorySessionDetailSource`. The view never talks to the network.
@MainActor
public protocol SessionDetailSource: AnyObject {
    var onUpdate: (@MainActor (SessionDetailInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `SessionDetailSource`, projects the
/// snapshot into the view-ready rows, and exposes a render `SessionDetailPhase` + freshness
/// for SwiftUI to switch over.
@MainActor
@Observable
public final class SessionDetailModel {
    public private(set) var phase: SessionDetailPhase = .loading
    public private(set) var rows: [SessionDetailRow] = []
    public private(set) var connection: SessionDetailConnection = .live
    public private(set) var hasSession = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SessionDetailSource
    @ObservationIgnored private let telemetry: any SessionDetailTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SessionDetailSource,
        telemetry: any SessionDetailTelemetry = OSLogSessionDetailTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SessionDetailPanel.surfaceSlug)
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

    private func apply(_ input: SessionDetailInput) {
        connection = input.connection
        updatedAt = input.updatedAt
        hasSession = input.session != nil
        if let session = input.session {
            rows = SessionDetailProjection.rows(for: session, formatting: input.formatting)
        } else {
            rows = []
        }
        phase = SessionDetailProjection.resolvePhase(input.status, hasSession: hasSession)
        handleAutoRefresh(for: input.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so
    /// a later stale episode re-triggers exactly once. Offline never auto-refreshes.
    private func handleAutoRefresh(for connection: SessionDetailConnection) {
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
public final class InMemorySessionDetailSource: SessionDetailSource {
    public var onUpdate: (@MainActor (SessionDetailInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SessionDetailInput?

    public init(initial: SessionDetailInput? = nil) {
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
    public func push(_ input: SessionDetailInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "SessionDetailPanel" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum SessionDetailStrings {
    public static let table = "SessionDetailPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
