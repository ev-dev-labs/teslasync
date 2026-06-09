//
//  AlertDetailTimeline.Model.swift
//  TeslaSync — P4 feature view · 0001 · AlertDetailTimeline (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the i18n
//  facade (P1/S10) for the alert audit timeline. The view binds through
//  `AlertDetailTimelineModel`; no networking lives in the view. The web leaf
//  (AlertDetailTimeline.tsx) is a pure presentational component that receives the loaded
//  `AlertEvent[]` from its parent's `useAlertDetail`; the native source carries those cached
//  events plus their load/freshness state, and the model reproduces the web `events.map`
//  projection so the derivation is exercised end-to-end.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that forwards
/// to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and
/// redacted there.
public protocol AlertDetailTimelineTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogAlertDetailTimelineTelemetry: AlertDetailTimelineTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the alert-detail query, mirroring the shared `LoadableState` cases
/// the web parent projects from its `useAlertDetail` hook (loading skeleton / resolved rows /
/// empty / failure).
public enum AlertDetailTimelineLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the cached-data banner so cached rows are clearly
/// labeled while reconnecting / offline.
public enum AlertDetailTimelineConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `AlertDetailTimelineSource`: the cached alert events
/// plus their load status, the (shared) connection, and whether a refresh is in flight.
public struct AlertDetailTimelineUpdate: Sendable, Equatable {
    public var status: AlertDetailTimelineLoadStatus
    public var events: [AlertDetailTimelineEvent]
    public var refreshing: Bool
    public var connection: AlertDetailTimelineConnection
    public var updatedAt: Date?

    public init(
        status: AlertDetailTimelineLoadStatus = .loading,
        events: [AlertDetailTimelineEvent] = [],
        refreshing: Bool = false,
        connection: AlertDetailTimelineConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.events = events
        self.refreshing = refreshing
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The mutually-exclusive render branches the surface switches over, mirroring the web
/// `events.length ? <Timeline> : <EmptyState>` plus the loading skeleton + error retry the
/// Apple HIG states contract requires.
public enum AlertDetailTimelinePhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

/// Pure phase resolution shared by the model and the tests. The skeleton shows only on the
/// initial fetch (no rows yet); cached rows stay visible behind a refresh/failure, with the
/// banner reflecting staleness — mirroring the web shell. A resolved-but-empty result
/// surfaces the web `EmptyState` (which the web notes is only reachable mid-load, since an
/// alert always carries a synthetic `created` entry).
public enum AlertDetailTimelineProjection {
    public static func resolvePhase(
        _ status: AlertDetailTimelineLoadStatus,
        hasRows: Bool
    ) -> AlertDetailTimelinePhase {
        switch status {
        case .loading:
            hasRows ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasRows ? .content : .empty
        case let .failed(message):
            hasRows ? .content : .error(message)
        }
    }
}

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 alert-detail state holder (the `useAlertDetail` query + its refresh). Previews and
/// tests use `InMemoryAlertDetailTimelineSource`. The view never talks to the network.
@MainActor
public protocol AlertDetailTimelineSource: AnyObject {
    var onUpdate: (@MainActor (AlertDetailTimelineUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to an `AlertDetailTimelineSource`,
/// reproduces the web `events.map` projection into view-ready rows, and exposes a render
/// `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class AlertDetailTimelineModel {
    public private(set) var phase: AlertDetailTimelinePhase = .loading
    public private(set) var events: [AlertDetailTimelineEntry] = []
    public private(set) var connection: AlertDetailTimelineConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any AlertDetailTimelineSource
    @ObservationIgnored private let telemetry: any AlertDetailTimelineTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any AlertDetailTimelineSource,
        telemetry: any AlertDetailTimelineTelemetry = OSLogAlertDetailTimelineTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AlertDetailTimelineSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the alert detail (wired to the retry affordance + stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: AlertDetailTimelineUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        events = AlertDetailTimelineAdapter.project(from: update.events)
        phase = AlertDetailTimelineProjection.resolvePhase(update.status, hasRows: !events.isEmpty)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live
    /// so a later stale episode re-triggers exactly once. Offline does not refresh.
    private func handleAutoRefresh(for connection: AlertDetailTimelineConnection) {
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
public final class InMemoryAlertDetailTimelineSource: AlertDetailTimelineSource {
    public var onUpdate: (@MainActor (AlertDetailTimelineUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AlertDetailTimelineUpdate?

    public init(initial: AlertDetailTimelineUpdate? = nil) {
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
    public func push(_ update: AlertDetailTimelineUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AlertDetailTimeline" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// surface prompt owns its own strings without editing the shared catalog.
public enum AlertDetailTimelineStrings {
    public static let table = "AlertDetailTimeline"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
