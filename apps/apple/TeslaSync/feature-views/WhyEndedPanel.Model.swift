//
//  WhyEndedPanel.Model.swift
//  TeslaSync — P4 feature view · 0152 · WhyEndedPanel (Apple)
//
//  The seams that keep the SwiftUI surface declarative:
//    • P1/S11 telemetry contract (`view.opened`),
//    • P1/S8 state-holder seam (`WhyEndedPanelSource` → `WhyEndedPanelModel`),
//    • the web lazy-query behaviour (`useDriveWhyEnded(driveId, window, expanded)`
//      only fires when the panel is expanded), the server-validated window
//      selector, and the `DataTable` pagination.
//
//  No networking lives here. The production source wraps the shared
//  `useDriveWhyEnded` query holder (GET /drives/{id}/why-ended?window=…) at the
//  composition root; previews and tests drive `InMemoryWhyEndedPanelSource`.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared `Telemetry.track(.viewOpened(surface:…))` (consent-gated + redacted).
public protocol WhyEndedPanelTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogWhyEndedPanelTelemetry: WhyEndedPanelTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the diagnostic query, mirroring the shared
/// `LoadableState` cases the production source projects from
/// `useDriveWhyEnded`'s `Resource<DriveDiagnosticResponse>`.
public enum WhyEndedPanelLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). The web binds
/// these from the `INTERVALS.STANDARD` poll's fetch state +
/// `refetchIntervalInBackground:false`.
public enum WhyEndedPanelConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `WhyEndedPanelSource`: the resolved feeds
/// (web `why.data.fsm_transitions` / `signal_window`), the load status, and the
/// live freshness. The model turns this into the display projection.
public struct WhyEndedPanelUpdate: Sendable, Equatable {
    public var status: WhyEndedPanelLoadStatus
    public var connection: WhyEndedPanelConnection
    public var transitions: [DriveDiagnosticTransitionData]
    public var signals: [DriveDiagnosticSignalData]
    public var updatedAt: Date?

    public init(
        status: WhyEndedPanelLoadStatus = .loading,
        connection: WhyEndedPanelConnection = .live,
        transitions: [DriveDiagnosticTransitionData] = [],
        signals: [DriveDiagnosticSignalData] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.transitions = transitions
        self.signals = signals
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 drive-diagnostic state holder. `setEnabled` is the web lazy gate
/// (`enabled = expanded`); `setWindow` re-queries the server-validated window. The
/// view never performs transport. Previews + tests use `InMemoryWhyEndedPanelSource`.
@MainActor
public protocol WhyEndedPanelSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (WhyEndedPanelUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the active window (wired to the error-state retry).
    func refresh()
    /// Selects the diagnostic window, re-querying if enabled (web `windowSel`).
    func setWindow(_ window: DriveDiagnosticWindow)
    /// Toggles lazy activation — the web `enabled = expanded`; the query fires on
    /// first expand and pauses again when collapsed.
    func setEnabled(_ enabled: Bool)
}

// MARK: - View-model

/// The surface's observable view-model. Subscribes to a `WhyEndedPanelSource`,
/// owns the disclosure + window-selector + pagination state (web `useState`s),
/// recomputes the projection via `WhyEndedPanelBuilder`, and exposes a render
/// `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class WhyEndedPanelModel {
    /// The mutually-exclusive render branches inside the expanded body — the web
    /// `isLoading ? Spinner : error ? EmptyState : <sections>`. There is no
    /// top-level empty: a resolved-but-empty response still renders both sections,
    /// each with its own empty view (web FSM `EmptyState` / signal emptyMessage).
    public enum Phase: Equatable {
        case loading
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: WhyEndedPanelConnection = .live
    public private(set) var projection: WhyEndedPanelProjection = .empty
    public private(set) var updatedAt: Date?
    public private(set) var isFetching = false

    /// The disclosure state (web `expanded`, default collapsed). The query is lazy
    /// behind this — it fires only once the panel is opened.
    public private(set) var expanded = false
    /// The active diagnostic window (web `windowSel`, default `60s`).
    public private(set) var window: DriveDiagnosticWindow = .default

    /// Signal-table page size (web `pagination.defaultPageSize`).
    public private(set) var signalPageSize = WhyEndedSignalPaging.defaultPageSize
    /// Zero-based signal-table page index (web `DataTable` page state).
    public private(set) var signalPage = 0

    @ObservationIgnored private let source: any WhyEndedPanelSource
    @ObservationIgnored private let telemetry: any WhyEndedPanelTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any WhyEndedPanelSource,
        telemetry: any WhyEndedPanelTelemetry = OSLogWhyEndedPanelTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived signal pagination

    /// The signal rows on the current page (web paginated `DataTable` body).
    public var pagedSignals: [WhyEndedSignalRow] {
        WhyEndedSignalPaging.page(projection.signals, page: signalPage, pageSize: signalPageSize)
    }

    /// The total signal-table page count (≥ 1).
    public var signalPageCount: Int {
        WhyEndedSignalPaging.pageCount(total: projection.signals.count, pageSize: signalPageSize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    /// Fires on surface appear regardless of the disclosure (the panel is
    /// "opened" even while collapsed; the data query stays lazy).
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WhyEndedPanelSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh of the active window (wired to the error-state retry).
    public func refresh() {
        source.refresh()
    }

    // MARK: Disclosure + window + pagination intents

    /// Toggles the panel open/closed (web header button), firing or pausing the
    /// lazy query through the source.
    public func toggleExpanded() {
        setExpanded(!expanded)
    }

    /// Sets the disclosure state explicitly (web `setExpanded`).
    public func setExpanded(_ value: Bool) {
        guard expanded != value else { return }
        expanded = value
        source.setEnabled(value)
    }

    /// Selects a diagnostic window (web `setWindowSel`), resetting the signal page
    /// and re-querying through the source.
    public func selectWindow(_ value: DriveDiagnosticWindow) {
        guard window != value else { return }
        window = value
        signalPage = 0
        source.setWindow(value)
    }

    /// Sets the signal-table page size, clamping the current page into range.
    public func setSignalPageSize(_ size: Int) {
        guard size > 0, size != signalPageSize else { return }
        signalPageSize = size
        signalPage = WhyEndedSignalPaging.clamp(
            page: signalPage,
            total: projection.signals.count,
            pageSize: size
        )
    }

    /// Navigates the signal table to `page` (clamped into range).
    public func goToSignalPage(_ page: Int) {
        signalPage = WhyEndedSignalPaging.clamp(
            page: page,
            total: projection.signals.count,
            pageSize: signalPageSize
        )
    }

    // MARK: Snapshot application

    private func apply(_ update: WhyEndedPanelUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        isFetching = update.status == .loading
        projection = WhyEndedPanelBuilder.buildProjection(
            transitions: update.transitions,
            signals: update.signals
        )
        phase = Self.resolvePhase(status: update.status, hasData: projection.hasData)
        signalPage = WhyEndedSignalPaging.clamp(
            page: signalPage,
            total: projection.signals.count,
            pageSize: signalPageSize
        )
    }

    /// Resolves the render phase. The spinner shows only on the cold initial fetch
    /// (no rows yet); a resolved response always renders the content branch (both
    /// sections own their empties, web-faithful); a failure keeps cached rows
    /// visible behind the content, else surfaces the retryable error.
    static func resolvePhase(status: WhyEndedPanelLoadStatus, hasData: Bool) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .loaded, .empty:
            .content
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. `initial` is pushed both on
/// `start()` and on `setEnabled(true)` so the lazy-expand path is exercised; use
/// `push(_:)` to drive additional snapshots.
@MainActor
public final class InMemoryWhyEndedPanelSource: WhyEndedPanelSource {
    public var onUpdate: (@MainActor (WhyEndedPanelUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var enabledCount = 0
    public private(set) var lastEnabled: Bool?
    public private(set) var lastWindow: DriveDiagnosticWindow?

    private let initial: WhyEndedPanelUpdate?
    private let emitOnStart: Bool

    /// - Parameters:
    ///   - initial: the snapshot pushed when the lazy query activates.
    ///   - emitOnStart: when true, also push `initial` from `start()` (handy for
    ///     previews that begin expanded); production lazy behaviour is `false`.
    public init(initial: WhyEndedPanelUpdate? = nil, emitOnStart: Bool = false) {
        self.initial = initial
        self.emitOnStart = emitOnStart
    }

    public func start() {
        startCount += 1
        if emitOnStart, let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func setWindow(_ window: DriveDiagnosticWindow) {
        lastWindow = window
    }

    public func setEnabled(_ enabled: Bool) {
        enabledCount += 1
        lastEnabled = enabled
        if enabled, let initial { onUpdate?(initial) }
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: WhyEndedPanelUpdate) {
        onUpdate?(update)
    }
}
