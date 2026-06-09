//
//  LiveVehicleState.Model.swift
//  TeslaSync — P4 feature view · 0044 · LiveVehicleState (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the
//  i18n facade (P1/S10) for the Live Vehicle State surface. The view binds through
//  `LiveVehicleStateModel`; no networking lives in the view. SwiftUI parity of
//  features/admin/components/security-access/LiveVehicleState.tsx — a presentational
//  leaf fed by its parent's security-latest query (web prop `{ latest }`), here
//  extended with the live-state freshness the Apple HIG states contract requires
//  (loading / empty / error / stale / offline chrome over cached values).
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is
/// consent-gated and redacted there.
public protocol LiveVehicleStateTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogLiveVehicleStateTelemetry: LiveVehicleStateTelemetry {
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
/// cases the production source projects from the security-latest query (web parent
/// loading skeleton / resolved event / empty / failure).
public enum LiveVehicleStateLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-
/// data banner so the last-known grid stays visible but clearly labeled while
/// reconnecting (stale) or offline.
public enum LiveVehicleStateConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `LiveVehicleStateSource`: the cached latest
/// event plus its load + connection status. The model turns this into the live grid.
public struct LiveVehicleStateUpdate: Sendable, Equatable {
    public var status: LiveVehicleStateLoadStatus
    public var connection: LiveVehicleStateConnection
    public var latest: LiveVehicleStateLatest?
    public var updatedAt: Date?

    public init(
        status: LiveVehicleStateLoadStatus = .loading,
        connection: LiveVehicleStateConnection = .live,
        latest: LiveVehicleStateLatest? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.latest = latest
        self.updatedAt = updatedAt
    }
}

/// The render branch the view switches over (web shell loading / content, plus the
/// resolved-with-no-event empty state and the no-cached-data failure state).
public enum LiveVehicleStatePhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the `security/latest` query store); previews and
/// tests use `InMemoryLiveVehicleStateSource`. The view never talks to the network.
@MainActor
public protocol LiveVehicleStateSource: AnyObject {
    var onUpdate: (@MainActor (LiveVehicleStateUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `LiveVehicleStateSource`,
/// recomputes the live-signal-grid projection, and exposes a render
/// `LiveVehicleStatePhase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class LiveVehicleStateModel {
    public private(set) var phase: LiveVehicleStatePhase = .loading
    public private(set) var connection: LiveVehicleStateConnection = .live
    public private(set) var signals: [LiveSignalViewModel] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any LiveVehicleStateSource
    @ObservationIgnored private let telemetry: any LiveVehicleStateTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any LiveVehicleStateSource,
        telemetry: any LiveVehicleStateTelemetry = OSLogLiveVehicleStateTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// True once a live event has resolved (render phase `.content`). Drives the web
    /// green "Live" pill, which renders only when `latest` is present.
    public var hasLatest: Bool {
        phase == .content
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LiveVehicleState.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached signals stay visible). Wired to the retry affordance.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: LiveVehicleStateUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        signals = LiveVehicleStateProjection.signals(
            latest: update.latest,
            localize: LiveVehicleStateStrings.string
        )
        phase = Self.resolvePhase(update)
        handleAutoRefresh(for: update.connection)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and renders the grid otherwise; once an event is known the signals stay
    /// visible (cached values persist behind refresh / errors, with the freshness
    /// chip reflecting staleness or failure). With no cached event the surface falls
    /// back to the empty grid (resolved) or the error state (failed).
    public nonisolated static func resolvePhase(_ update: LiveVehicleStateUpdate) -> LiveVehicleStatePhase {
        let hasData = update.latest != nil
        switch update.status {
        case .loading:
            return hasData ? .content : .loading
        case .empty:
            return .empty
        case .loaded:
            return hasData ? .content : .empty
        case let .failed(message):
            return hasData ? .content : .error(message)
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline does not
    /// auto-refresh (there is no connectivity to retry over).
    private func handleAutoRefresh(for connection: LiveVehicleStateConnection) {
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

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryLiveVehicleStateSource: LiveVehicleStateSource {
    public var onUpdate: (@MainActor (LiveVehicleStateUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LiveVehicleStateUpdate?

    public init(initial: LiveVehicleStateUpdate? = nil) {
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
    public func push(_ update: LiveVehicleStateUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "LiveVehicleState" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum LiveVehicleStateStrings {
    public static let table = "LiveVehicleState"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
