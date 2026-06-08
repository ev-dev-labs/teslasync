//
//  LiveSignalsTable.Model.swift
//  TeslaSync — P4 feature view · 0036 · LiveSignalsTable (Apple)
//
//  The seams that keep the SwiftUI surface declarative:
//    • P1/S11 telemetry contract (`view.opened`),
//    • P1/S8 state-holder seam (`LiveSignalsTableSource` → `LiveSignalsTableModel`),
//    • P1/S10 localization facade (`LiveSignalsTableStrings`),
//    • the testable accessibility summary.
//
//  No networking lives here. The production source is wired over the shared live
//  signal store (web `useVehicleLiveSignals` polling `GET /signals/{id}/live`) at
//  the composition root; previews and tests drive `InMemoryLiveSignalsTableSource`.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted).
public protocol LiveSignalsTableTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogLiveSignalsTableTelemetry: LiveSignalsTableTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the snapshot, mirroring the shared `LoadableState`
/// cases the production source projects from the live-signals query `Resource<T>`.
public enum LiveSignalsTableLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). The web binds
/// these from the 1 s poll's fetch state + `refetchIntervalInBackground:false`.
public enum LiveSignalsTableConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `LiveSignalsTableSource`: the cached signal
/// entries (web `VehicleLiveSignalsResponse.signals`), the load status, and the
/// live-stream freshness. The model turns this into the display projection.
public struct LiveSignalsTableUpdate: Sendable, Equatable {
    public var status: LiveSignalsTableLoadStatus
    public var connection: LiveSignalsTableConnection
    public var entries: [LiveSignalEntry]
    public var updatedAt: Date?

    public init(
        status: LiveSignalsTableLoadStatus = .loading,
        connection: LiveSignalsTableConnection = .live,
        entries: [LiveSignalEntry] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.entries = entries
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 live signal store (web `useVehicleLiveSignals`); the view never
/// performs transport. Previews and tests use `InMemoryLiveSignalsTableSource`.
@MainActor
public protocol LiveSignalsTableSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (LiveSignalsTableUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - View-model

/// The surface's observable view-model. Subscribes to a `LiveSignalsTableSource`,
/// recomputes the projection via `LiveSignalsTableBuilder`, and owns the live
/// filter + sort (web `useState`/`useSortToggle`) the table renders.
@MainActor
@Observable
public final class LiveSignalsTableModel {
    /// The mutually-exclusive render branches.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: LiveSignalsTableConnection = .live
    public private(set) var projection: LiveSignalsTableProjection = .empty
    public private(set) var updatedAt: Date?
    public private(set) var isFetching = false

    /// Live name filter (web `filter` state, bound to the search field).
    public var filterText: String = ""
    /// Active sort column (web `useSortToggle` key).
    public private(set) var sortKey: LiveSignalSortKey = .name
    /// Active sort direction (web `useSortToggle` dir).
    public private(set) var sortDirection: LiveSignalSortDirection = .ascending

    @ObservationIgnored private let source: any LiveSignalsTableSource
    @ObservationIgnored private let telemetry: any LiveSignalsTableTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any LiveSignalsTableSource,
        telemetry: any LiveSignalsTableTelemetry = OSLogLiveSignalsTableTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The filtered + sorted rows to render (web `filtered` → `sorted` `useMemo`).
    public var displayedRows: [LiveSignalRow] {
        let filtered = LiveSignalsTableBuilder.filter(projection.rows, query: filterText)
        return LiveSignalsTableBuilder.sort(filtered, key: sortKey, direction: sortDirection)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LiveSignalsTable.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached rows stay visible). Wired to retry / pull.
    public func refresh() {
        source.refresh()
    }

    /// Toggles the sort for a column — the web `useSortToggle` behaviour: re-tapping
    /// the active column flips direction, a new column starts ascending.
    public func toggleSort(_ key: LiveSignalSortKey) {
        if sortKey == key {
            sortDirection = sortDirection.toggled
        } else {
            sortKey = key
            sortDirection = .ascending
        }
    }

    private func apply(_ update: LiveSignalsTableUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        isFetching = update.status == .loading
        projection = LiveSignalsTableBuilder.buildProjection(from: update.entries)
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
    }

    /// Resolves the render phase. The web shows the empty state only when no signal
    /// is cached and the fetch has settled; once any row exists the table renders
    /// and cached rows stay visible behind a refresh or error.
    static func resolvePhase(status: LiveSignalsTableLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            hasData ? .content : .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryLiveSignalsTableSource: LiveSignalsTableSource {
    public var onUpdate: (@MainActor (LiveSignalsTableUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LiveSignalsTableUpdate?

    public init(initial: LiveSignalsTableUpdate? = nil) {
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
    public func push(_ update: LiveSignalsTableUpdate) {
        onUpdate?(update)
    }
}
