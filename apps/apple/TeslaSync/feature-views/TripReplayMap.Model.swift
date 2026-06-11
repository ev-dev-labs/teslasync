//
//  TripReplayMap.Model.swift
//  TeslaSync — P4 feature view · 0274 · TripReplayMap (Apple)
//
//  The state-holder seams the map binds through: the P1/S11 telemetry contract
//  (`view.opened`), the P1/S10 i18n facade (web `useTranslation`), the P1/S8 source
//  that pushes the resolved `positions` + `currentIndex` slice + freshness, and the
//  `@Observable` view-model that resolves the render phase and memoises the route
//  projection. The web `TripReplayMap` is a presentational leaf fed by its drive-detail
//  page via props (`positions`, `currentIndex`, `onSeekToIndex`, `reduceMotion`), which
//  owns the loading / error / freshness lifecycle and stays the single source of truth
//  so scrubber / chart cursor / map marker stay in lockstep; the native surface
//  reproduces that whole contract through a `TripReplayMapSource`. No networking lives
//  in the view — a seek is delegated upstream, never mutated locally.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there. `Sendable` so a default sink can be an
/// `init` default.
public protocol TripReplayMapTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// Default sink: a redaction-safe `view.opened` `os_log` event. The slug is a static,
/// non-identifying constant logged verbatim; no VIN, route geometry, or location is
/// ever recorded.
public struct OSLogTripReplayMapTelemetry: TripReplayMapTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "TripReplayMap" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time; the per-surface table keeps
/// each parallel surface prompt self-contained. `string` is Foundation-only so the
/// pure label builders can use it; the SwiftUI `text(_:_:)` helper lives in the view
/// file.
public enum TripReplayMapStrings {
    public static let table = "TripReplayMap"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Freshness axis (ADR-013)

/// Live-stream freshness: `live`, `stale` (older than the freshness window), `offline`
/// (no connectivity — the last-loaded route stays on screen). Drives the freshness chip
/// + the guarded stale auto-refresh.
public enum TripReplayMapConnection: Sendable, Equatable {
    case live
    case stale
    case offline

    /// Whether the route is a fresh live read.
    public var isLive: Bool {
        self == .live
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `TripReplayMapSource`: the replay `positions` +
/// the page-owned `currentIndex` (web props), the reduce-motion preference, plus the
/// load status, the live connection, the in-flight flag, and the last-update timestamp.
/// The model turns this into the render phase + the route projection.
public struct TripReplayMapInput: Sendable, Equatable {
    public var status: TripReplayMapLoadStatus
    public var positions: [TripReplayPosition]
    public var currentIndex: Int
    public var reduceMotion: Bool
    public var connection: TripReplayMapConnection
    public var isFetching: Bool
    public var updatedAt: Date?

    public init(
        status: TripReplayMapLoadStatus = .loading,
        positions: [TripReplayPosition] = [],
        currentIndex: Int = 0,
        reduceMotion: Bool = false,
        connection: TripReplayMapConnection = .live,
        isFetching: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.positions = positions
        self.currentIndex = currentIndex
        self.reduceMotion = reduceMotion
        self.connection = connection
        self.isFetching = isFetching
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders — composing the drive-detail query the web page reads and the
/// scrubber's `currentIndex` — and routes `seek(to:)` back to the page (web
/// `onSeekToIndex`), which re-publishes a snapshot with the new index so the page stays
/// the single source of truth. Previews + tests use `InMemoryTripReplayMapSource`. The
/// view never talks to the network.
@MainActor
public protocol TripReplayMapSource: AnyObject {
    var onUpdate: (@MainActor (TripReplayMapInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web refetch / the stale auto-refresh).
    func refresh()
    /// Routes a polyline-tap seek upstream (web `onSeekToIndex`). The page owns the
    /// index and re-publishes a snapshot; the view never mutates it locally.
    func seek(to index: Int)
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `TripReplayMapSource`, memoises
/// each snapshot into the route projection (trail + segments + pins + playhead + camera
/// inputs), exposes a render `TripReplayMapPhase` + freshness for SwiftUI to switch
/// over, emits the `view.opened` diagnostics event once on first appearance, and
/// delegates a polyline-tap seek to the source.
@MainActor
@Observable
public final class TripReplayMapModel {
    public private(set) var phase: TripReplayMapPhase = .loading
    public private(set) var connection: TripReplayMapConnection = .live
    public private(set) var isFetching = false
    public private(set) var route = TripReplayRoute.empty
    /// The raw positions retained for the polyline-tap → nearest-sample resolve (web
    /// `nearestSampleIndex(positions, …)`).
    public private(set) var positions: [TripReplayPosition] = []
    public private(set) var currentIndex = 0
    public private(set) var reduceMotion = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any TripReplayMapSource
    @ObservationIgnored private let telemetry: any TripReplayMapTelemetry
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TripReplayMapSource,
        telemetry: any TripReplayMapTelemetry = OSLogTripReplayMapTelemetry(),
        localize: @escaping (String, String) -> String = TripReplayMapStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TripReplayMapSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry + the
    /// freshness-chip refresh action.
    public func refresh() {
        source.refresh()
    }

    /// Routes a polyline-tap seek upstream (web `onSeekToIndex`). The page re-publishes
    /// the snapshot with the new `currentIndex`; the model never mutates it locally so
    /// scrubber / chart cursor / map marker stay in lockstep.
    public func seek(to index: Int) {
        source.seek(to: index)
    }

    /// Auto-refreshes once when the data has gone stale and is not already being
    /// fetched — the native parity of the web stale-query self-refresh (prompt "stale
    /// chip + auto-refresh"). Re-arms once the feed returns live; offline never
    /// refetches (the last-loaded route stays on screen).
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching, !didAutoRefreshForStale else { return }
        didAutoRefreshForStale = true
        source.refresh()
    }

    private func apply(_ update: TripReplayMapInput) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        reduceMotion = update.reduceMotion
        positions = update.positions
        currentIndex = update.currentIndex
        route = TripReplayRoute.make(positions: update.positions, currentIndex: update.currentIndex)
        phase = Self.resolvePhase(update.status, hasPositions: route.hasPositions)
        if update.connection == .live { didAutoRefreshForStale = false }
    }

    /// Resolves the render phase from the bound load status + whether there are any
    /// positions (web `positions.length > 0 ? <map> : <EmptyState>`). A cached route
    /// stays on screen behind a transient failure / re-fetch so an offline or stale pod
    /// still shows the last-known map; the skeleton shows only on the initial fetch.
    ///
    /// `nonisolated` because it is pure (touches no actor state), so the phase logic is
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(
        _ status: TripReplayMapLoadStatus,
        hasPositions: Bool
    ) -> TripReplayMapPhase {
        switch status {
        case .loading:
            hasPositions ? .data : .loading
        case let .failed(message):
            hasPositions ? .data : .error(message)
        case .loaded:
            hasPositions ? .data : .empty
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()`, records the lifecycle + the delegated seek indices, and lets a test push
/// further snapshots via `push(_:)`.
@MainActor
public final class InMemoryTripReplayMapSource: TripReplayMapSource {
    public var onUpdate: (@MainActor (TripReplayMapInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var seekedIndices: [Int] = []

    private let initial: TripReplayMapInput?

    public init(initial: TripReplayMapInput? = nil) {
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

    public func seek(to index: Int) {
        seekedIndices.append(index)
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: TripReplayMapInput) {
        onUpdate?(update)
    }
}
