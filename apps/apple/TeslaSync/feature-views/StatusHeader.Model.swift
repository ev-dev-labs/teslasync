//
//  StatusHeader.Model.swift
//  TeslaSync — P4 feature view · 0028 · StatusHeader (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10).
//  The view binds through `StatusHeaderModel`; no networking lives in the view. SwiftUI parity
//  of web/src/features/admin/components/dlq-inspector/StatusHeader.tsx — the DLQ Inspector
//  status header that summarises `count` / `replayable` / `replay_enabled` from the parent
//  `useDLQList` query as three `StatCard`s and surfaces a warning `AlertBanner` when replay is
//  disabled. The production app composes the query into the `StatusHeaderSource` seam below.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol StatusHeaderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogStatusHeaderTelemetry: StatusHeaderTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's DLQ-list query, mirroring the shared `LoadableState`
/// cases the web parent projects from `useDLQList` (web `isLoading` skeleton / resolved list /
/// failure). The resolved-but-empty (`count == 0`) state is derived from the payload, not a
/// separate status.
public enum StatusHeaderLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner so
/// cached counts are clearly labeled while reconnecting / offline.
public enum StatusHeaderConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The DLQ summary fields the web `StatusHeader` reads from its `data` prop (`DLQListResponse`).
/// `replayableCount` is the already-filtered `entries.filter(e => e.replayable).length`, which
/// the production adapter derives once via `StatusHeaderProjection.replayableCount(in:)`.
public struct StatusHeaderInput: Sendable, Equatable {
    /// `data.count` — total dead-lettered entries.
    public var totalCount: Int
    /// `entries.filter(e => e.replayable).length` — entries with a parsed source topic.
    public var replayableCount: Int
    /// `data.replay_enabled` — the server `DLQ_REPLAY_ENABLED` flag.
    public var replayEnabled: Bool

    public init(totalCount: Int = 0, replayableCount: Int = 0, replayEnabled: Bool = false) {
        self.totalCount = totalCount
        self.replayableCount = replayableCount
        self.replayEnabled = replayEnabled
    }
}

/// One coalesced snapshot pushed by a `StatusHeaderSource`: the query load status + the DLQ
/// summary + the (shared) connection + the in-flight refresh flag + the freshness timestamp.
public struct StatusHeaderUpdate: Sendable, Equatable {
    public var status: StatusHeaderLoadStatus
    public var input: StatusHeaderInput?
    public var refreshing: Bool
    public var connection: StatusHeaderConnection
    public var updatedAt: Date?

    public init(
        status: StatusHeaderLoadStatus = .loading,
        input: StatusHeaderInput? = nil,
        refreshing: Bool = false,
        connection: StatusHeaderConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.input = input
        self.refreshing = refreshing
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders — wrapping the DLQ-list query (web `useDLQList`) plus a refresh affordance.
/// Previews + tests use `InMemoryStatusHeaderSource`. The view never talks to the network
/// directly.
@MainActor
public protocol StatusHeaderSource: AnyObject {
    var onUpdate: (@MainActor (StatusHeaderUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-fetches the DLQ-list query from the backend (web `refetch()`).
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `StatusHeaderSource`, projects the DLQ
/// summary into the three view-ready cards, and exposes a render `StatusHeaderPhase` + freshness
/// + the disabled-banner gate for SwiftUI to switch over.
@MainActor
@Observable
public final class StatusHeaderModel {
    public private(set) var connection: StatusHeaderConnection = .live
    public private(set) var phase: StatusHeaderPhase = .loading
    public private(set) var cards: [StatusHeaderCardItem] = []
    public private(set) var disabledBannerVisible = false
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any StatusHeaderSource
    @ObservationIgnored private let telemetry: any StatusHeaderTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any StatusHeaderSource,
        telemetry: any StatusHeaderTelemetry = OSLogStatusHeaderTelemetry(),
        locale: Locale = Locale(identifier: "en-US")
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: StatusHeader.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-fetches the DLQ-list query (web `refetch()`), used by the error-state retry.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: StatusHeaderUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        refreshing = update.refreshing
        cards = StatusHeaderProjection.cards(from: update.input, locale: locale)
        phase = StatusHeaderProjection.resolvePhase(update.status, input: update.input)
        disabledBannerVisible = StatusHeaderProjection.showsDisabledBanner(phase: phase, input: update.input)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh of the DLQ-list query (prompt "stale chip + auto-
    /// refresh"); reset once live so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: StatusHeaderConnection) {
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
public final class InMemoryStatusHeaderSource: StatusHeaderSource {
    public var onUpdate: (@MainActor (StatusHeaderUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: StatusHeaderUpdate?

    public init(initial: StatusHeaderUpdate? = nil) {
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
    public func push(_ update: StatusHeaderUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

public extension StatusHeader {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static let surfaceSlug = "StatusHeader"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "StatusHeader" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum StatusHeaderStrings {
    public static let table = "StatusHeader"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
