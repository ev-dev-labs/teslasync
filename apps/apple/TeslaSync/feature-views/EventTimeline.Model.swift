//
//  EventTimeline.Model.swift
//  TeslaSync — P4 feature view · 0043 · EventTimeline (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the i18n
//  facade (P1/S10) for the Security Event Timeline. The view binds through
//  `EventTimelineModel`; no networking lives in the view. The web leaf
//  (EventTimeline.tsx) receives an already-derived `timelineEvents` prop from its parent
//  (the Security & Access page, which calls `deriveTimeline(history)`); the native source
//  carries the cached security history + its load/freshness state, and the model
//  reproduces `deriveTimeline` so the derivation is exercised end-to-end.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is
/// consent-gated and redacted there.
public protocol EventTimelineTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogEventTimelineTelemetry: EventTimelineTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the timeline query, mirroring the shared `LoadableState` cases
/// the web source projects from its security-history hook (loading skeleton / resolved
/// rows / empty / failure).
public enum EventTimelineLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data
/// banner so cached rows are clearly labeled while reconnecting / offline.
public enum EventTimelineConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `EventTimelineSource`: the cached security history
/// + its load status + the (shared) connection + whether a refresh is in flight.
public struct EventTimelineUpdate: Sendable, Equatable {
    public var status: EventTimelineLoadStatus
    public var events: [EventTimelineSecurityEvent]
    public var refreshing: Bool
    public var connection: EventTimelineConnection
    public var updatedAt: Date?

    public init(
        status: EventTimelineLoadStatus = .loading,
        events: [EventTimelineSecurityEvent] = [],
        refreshing: Bool = false,
        connection: EventTimelineConnection = .live,
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
/// `timelineEvents.length > 0 ? list : EmptyState` plus the loading skeleton + error
/// retry the Apple HIG states contract requires.
public enum EventTimelinePhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

/// Pure phase resolution shared by the model and the tests. The skeleton shows only on
/// the initial fetch (no rows yet); cached rows stay visible behind a refresh/failure,
/// with the freshness chip + banner reflecting staleness — mirroring the web shell. A
/// resolved-but-empty derivation surfaces the web `EmptyState`.
public enum EventTimelineProjection {
    public static func resolvePhase(_ status: EventTimelineLoadStatus, hasRows: Bool) -> EventTimelinePhase {
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
/// P1/S8 security-access state holders (the security-history query + its Tesla-refresh
/// mutation). Previews + tests use `InMemoryEventTimelineSource`. The view never talks to
/// the network directly.
@MainActor
public protocol EventTimelineSource: AnyObject {
    var onUpdate: (@MainActor (EventTimelineUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to an `EventTimelineSource`, reproduces
/// the web `deriveTimeline(history)` into view-ready rows, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class EventTimelineModel {
    public private(set) var phase: EventTimelinePhase = .loading
    public private(set) var events: [EventTimelineEntry] = []
    public private(set) var connection: EventTimelineConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any EventTimelineSource
    @ObservationIgnored private let telemetry: any EventTimelineTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any EventTimelineSource,
        telemetry: any EventTimelineTelemetry = OSLogEventTimelineTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EventTimelineSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the security history (wired to the retry affordance + stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: EventTimelineUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        events = EventTimelineAdapter.deriveTimeline(from: update.events)
        phase = EventTimelineProjection.resolvePhase(update.status, hasRows: !events.isEmpty)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline does not refresh.
    private func handleAutoRefresh(for connection: EventTimelineConnection) {
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
public final class InMemoryEventTimelineSource: EventTimelineSource {
    public var onUpdate: (@MainActor (EventTimelineUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: EventTimelineUpdate?

    public init(initial: EventTimelineUpdate? = nil) {
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
    public func push(_ update: EventTimelineUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "EventTimeline" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// surface prompt owns its own strings without editing the shared catalog.
public enum EventTimelineStrings {
    public static let table = "EventTimeline"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
